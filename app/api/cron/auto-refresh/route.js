// Automatic refresh endpoint to keep data current
// This can be called by a cron job or scheduled task

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { fetchSchedule, fetchTeams } from '../../../../lib/vendors/stats.js'
import { fetchOdds } from '../../../../lib/vendors/odds.js'
import { fetchAndStoreNFLLiveData } from '../../../../lib/nfl-data.js'
import { fetchLiveGameData } from '../../../../lib/vendors/stats.js'
import {
  upsertTeam,
  upsertPlayer,
  upsertGame,
  createOdds,
  createEdgeSnapshot,
  cleanupOldOdds,
  cleanupOldEdgeSnapshots,
  prisma,
} from '../../../../lib/db.js'

export async function GET() {
  try {
    console.log('🔄 Starting automatic refresh...')
    
    const results = {
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        teamsUpdated: 0,
        gamesUpdated: 0,
        oddsUpdated: 0,
        edgesCalculated: 0,
        liveScoresUpdated: 0,
        nflGamesUpdated: 0,
        validationsChecked: 0
      }
    }
    
    // 1. Refresh MLB schedule and teams
    console.log('📅 Refreshing MLB schedule and teams...')
    const [teams, games] = await Promise.all([
      fetchTeams(),
      fetchSchedule({ useLocalDate: true, noCache: true })
    ])
    
    // Update teams
    for (const team of teams) {
      await upsertTeam(team)
      results.stats.teamsUpdated++
    }
    
    // Update games
    for (const game of games) {
      // Look up actual team IDs
      const homeTeam = await prisma.team.findFirst({
        where: { 
          OR: [
            { id: game.home.id },
            { abbr: game.home.abbr }
          ]
        }
      })
      
      const awayTeam = await prisma.team.findFirst({
        where: { 
          OR: [
            { id: game.away.id },
            { abbr: game.away.abbr }
          ]
        }
      })
      
      if (homeTeam && awayTeam) {
        try {
          await upsertGame({
            id: game.id,
            mlbGameId: game.mlbGameId,
            date: game.date,
            homeId: homeTeam.id,
            awayId: awayTeam.id,
            probableHomePitcherId: game.probablePitchers?.home?.id || null,
            probableAwayPitcherId: game.probablePitchers?.away?.id || null,
            status: game.status,
          })
          results.stats.gamesUpdated++
        } catch (error) {
          console.error(`Error updating game ${game.id}:`, error.message)
        }
      }
    }
    
    // 2. Refresh odds
    console.log('💰 Refreshing odds...')
    try {
      const oddsData = await fetchOdds('mlb', { noCache: true })
      
      for (const odds of oddsData) {
        try {
          await createOdds(odds)
          results.stats.oddsUpdated++
        } catch (error) {
          console.error(`Error creating odds for game ${odds.gameId}:`, error.message)
        }
      }
    } catch (error) {
      console.error('Error fetching odds:', error.message)
    }
    
    // 3. Calculate edges
    console.log('📊 Calculating edges...')
    const gamesWithOdds = await prisma.game.findMany({
      where: {
        sport: 'mlb',
        date: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lt: new Date(new Date().setHours(23, 59, 59, 999))
        }
      },
      include: {
        odds: {
          orderBy: { ts: 'desc' },
          take: 10
        }
      }
    })
    
    for (const game of gamesWithOdds) {
      const h2hOdds = game.odds.find(o => o.market === 'h2h')
      const totalOdds = game.odds.find(o => o.market === 'totals')
      
      if (h2hOdds || totalOdds) {
        // HONEST: No fake edges - use 0 when we don't have real analysis
        const honestEdges = {
          edgeMlHome: 0,
          edgeMlAway: 0,
          edgeTotalO: 0,
          edgeTotalU: 0,
          ourTotal: totalOdds?.total || 7.0 // Use market total, no fake variation
        }
        
        await createEdgeSnapshot({
          gameId: game.id,
          edgeMlHome: honestEdges.edgeMlHome,
          edgeMlAway: honestEdges.edgeMlAway,
          edgeTotalO: honestEdges.edgeTotalO,
          edgeTotalU: honestEdges.edgeTotalU,
          ourTotal: honestEdges.ourTotal,
          modelRun: 'mlb_playoff_v1'
        })
        results.stats.edgesCalculated++
      }
    }
    
    // 4. Update live scores for active games
    console.log('⚾ Updating live scores...')
    const activeGames = await prisma.game.findMany({
      where: {
        sport: 'mlb',
        status: { in: ['in_progress', 'pre_game', 'final', 'Bottom'] },
        mlbGameId: { not: null }
      }
    })
    
    for (const game of activeGames) {
      try {
        const liveData = await fetchLiveGameData(game.mlbGameId, true)
        
        if (liveData) {
          await prisma.game.update({
            where: { id: game.id },
            data: {
              homeScore: liveData.homeScore,
              awayScore: liveData.awayScore,
              status: liveData.status,
              inning: liveData.inning,
              inningHalf: liveData.inningHalf
            }
          })
          results.stats.liveScoresUpdated++
        }
      } catch (error) {
        console.error(`Error updating live data for game ${game.id}:`, error.message)
      }
    }
    
    // 5. Refresh NFL data
    console.log('🏈 Refreshing NFL data...')
    const nflResult = await fetchAndStoreNFLLiveData()
    results.stats.nflGamesUpdated = nflResult.gamesUpdated || 0
    
    // 6. Check and update completed prop validations
    console.log('✅ Checking prop validations...')
    try {
      const { getPlayerGameStat: getMLBStat } = await import('../../../../lib/vendors/mlb-game-stats.js')
      const { getPlayerGameStat: getNFLStat } = await import('../../../../lib/vendors/nfl-game-stats.js')
      
      const pendingValidations = await prisma.propValidation.findMany({
        where: { status: 'pending' }
      })
      
      for (const validation of pendingValidations) {
        try {
          const game = await prisma.game.findFirst({
            where: {
              OR: [
                { id: validation.gameIdRef },
                { mlbGameId: validation.gameIdRef }
              ]
            }
          })
          
          if (!game) continue
          
          // Check if game is final (by status OR by date)
          const gameDate = new Date(game.date || game.ts || game.commence_time)
          const yesterday = new Date()
          yesterday.setDate(yesterday.getDate() - 1)
          yesterday.setHours(23, 59, 59, 999)
          
          const isFinal = 
            ['final', 'completed', 'f', 'closed'].includes(game.status?.toLowerCase()) ||
            (gameDate < yesterday)
          
          if (!isFinal) continue
          
          const sport = validation.sport || game.sport || 'mlb'
          let actualValue = null
          
          if (sport === 'mlb' && game.mlbGameId) {
            actualValue = await getMLBStat(game.mlbGameId, validation.playerName, validation.propType)
          } else if (sport === 'nfl' && game.espnGameId) {
            actualValue = await getNFLStat(game.espnGameId, validation.playerName, validation.propType)
          }
          
          if (actualValue === null || actualValue === undefined) {
            await prisma.propValidation.update({
              where: { id: validation.id },
              data: {
                status: 'needs_review',
                notes: `Game finished but stat not available. Manual verification needed.`,
                completedAt: new Date()
              }
            })
            results.stats.validationsChecked++
            continue
          }
          
          let result = 'incorrect'
          if (actualValue === validation.threshold) {
            result = 'push'
          } else if (
            (validation.prediction === 'over' && actualValue > validation.threshold) ||
            (validation.prediction === 'under' && actualValue < validation.threshold)
          ) {
            result = 'correct'
          }
          
          await prisma.propValidation.update({
            where: { id: validation.id },
            data: {
              actualValue,
              result,
              status: 'completed',
              completedAt: new Date(),
              notes: `Auto-validated: ${validation.prediction.toUpperCase()} ${validation.threshold} → Actual: ${actualValue}`
            }
          })
          
          results.stats.validationsChecked++
        } catch (error) {
          console.error(`Error processing validation ${validation.id}:`, error.message)
        }
      }
    } catch (error) {
      console.error('Error checking validations:', error.message)
    }
    
    // 7. Cleanup old data
    console.log('🧹 Cleaning up old data...')
    await cleanupOldOdds()
    await cleanupOldEdgeSnapshots()
    
    console.log('✅ Automatic refresh complete!')
    console.log(`   Teams: ${results.stats.teamsUpdated}`)
    console.log(`   Games: ${results.stats.gamesUpdated}`)
    console.log(`   Odds: ${results.stats.oddsUpdated}`)
    console.log(`   Edges: ${results.stats.edgesCalculated}`)
    console.log(`   Live Scores: ${results.stats.liveScoresUpdated}`)
    console.log(`   NFL Games: ${results.stats.nflGamesUpdated}`)
    console.log(`   Validations Checked: ${results.stats.validationsChecked}`)
    
    return NextResponse.json(results)
    
  } catch (error) {
    console.error('❌ Error in automatic refresh:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}
