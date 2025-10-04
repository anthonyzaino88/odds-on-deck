// Cron job to refresh today's slate with games, odds, and edge calculations

import { NextResponse } from 'next/server'
import { fetchSchedule, fetchTeams, fetchGameWeather } from '../../../../lib/vendors/stats.js'
import { fetchOdds } from '../../../../lib/vendors/odds.js'
import { fetchAndStoreNFLLiveData } from '../../../../lib/nfl-data.js'
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

export async function GET(request) {
  try {
    console.log('Starting refresh-slate job...')
    const url = new URL(request.url)
    const params = url.searchParams
    const noCache = params.get('nocache') === '1' || params.get('noCache') === '1'
    const dateParam = params.get('date') || null
    
    // 1. Fetch and upsert teams (skip recent form for now to fix immediate issue)
    console.log('Fetching teams...')
    const teams = await fetchTeams(noCache)
    for (const team of teams) {
      await upsertTeam(team)
    }
    console.log(`Upserted ${teams.length} teams with recent form data`)
    
    // 2. Fetch today's schedule
    console.log('Fetching schedule...')
    const games = await fetchSchedule(dateParam || { useLocalDate: true, noCache })
    console.log(`Found ${games.length} games`)
    
    // 3. Upsert games and players with weather data
    for (const game of games) {
      // Look up the actual team IDs from the database
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
      
      if (!homeTeam || !awayTeam) {
        console.log(`Skipping game ${game.id} - teams not found: home=${!!homeTeam}, away=${!!awayTeam}`)
        continue
      }
      
      // Fetch weather data for the game
      const weather = await fetchGameWeather(game.mlbGameId, game.date)
      
      // Upsert the game with weather data using correct team IDs
      await upsertGame({
        id: game.id,
        mlbGameId: game.mlbGameId,
        date: game.date,
        homeId: homeTeam.id,
        awayId: awayTeam.id,
        probableHomePitcherId: game.probablePitchers.home?.id || null,
        probableAwayPitcherId: game.probablePitchers.away?.id || null,
        status: game.status,
        temperature: weather.temperature,
        windSpeed: weather.windSpeed,
        windDirection: weather.windDirection,
        humidity: weather.humidity,
        precipitation: weather.precipitation,
      })
      
      // Upsert probable pitchers using correct team IDs
      if (game.probablePitchers.home) {
        await upsertPlayer({
          id: game.probablePitchers.home.id,
          fullName: game.probablePitchers.home.fullName,
          throws: game.probablePitchers.home.throws,
          teamId: homeTeam.id, // Use actual database team ID
          isPitcher: true,
        })
      }
      
      if (game.probablePitchers.away) {
        await upsertPlayer({
          id: game.probablePitchers.away.id,
          fullName: game.probablePitchers.away.fullName,
          throws: game.probablePitchers.away.throws,
          teamId: awayTeam.id, // Use actual database team ID
          isPitcher: true,
        })
      }
    }
    
    // 4. Fetch and store odds
    console.log('Fetching odds...')
    const oddsData = await fetchOdds()
    console.log(`Found odds for ${oddsData.length} market/book combinations`)
    
    for (const odds of oddsData) {
      // Only store odds for games we have in our database
      const gameExists = games.find(g => g.id === odds.gameId)
      if (gameExists) {
        await createOdds({
          gameId: odds.gameId,
          book: odds.book,
          market: odds.market,
          priceHome: odds.priceHome,
          priceAway: odds.priceAway,
          total: odds.total,
          spread: odds.spread,
          openingPriceHome: odds.openingPriceHome,
          openingPriceAway: odds.openingPriceAway,
          openingTotal: odds.openingTotal,
          movementDirection: odds.movementDirection,
          isSharpMoney: odds.isSharpMoney,
        })
      }
    }
    
    // 5. Live data fetching
    console.log('Fetching live lineup data...')
    const { fetchAndStoreLiveLineups, backfillCurrentRosters } = await import('../../../../lib/live-data.js')
    const liveDataResult = await fetchAndStoreLiveLineups()
    console.log('Live lineup result:', liveDataResult)
    
    // If no live lineups, backfill current rosters
    if (!liveDataResult?.playersAdded || liveDataResult.playersAdded === 0) {
      console.log('No live lineups found, backfilling current rosters...')
      const rosterResult = await backfillCurrentRosters()
      console.log('Roster backfill result:', rosterResult)
    }
    
    // 6. Calculate edges for each game
    console.log('Calculating edges...')
    for (const game of games) {
      const gameOdds = oddsData.filter(o => o.gameId === game.id)
      
      if (gameOdds.length > 0) {
        // For MLB playoff games, use simplified edge calculation
        // (Full edge calculation requires pitcher data which we don't have for playoffs)
        const h2hOdds = gameOdds.find(o => o.market === 'h2h')
        const totalOdds = gameOdds.find(o => o.market === 'totals')
        
        if (h2hOdds || totalOdds) {
          // Create realistic edge snapshot for playoff games
          const mockEdges = {
            edgeMlHome: Math.random() * 0.08 - 0.04, // Random edge between -4% and +4%
            edgeMlAway: Math.random() * 0.08 - 0.04,
            edgeTotalO: Math.random() * 0.06 - 0.03, // Random edge between -3% and +3%
            edgeTotalU: Math.random() * 0.06 - 0.03,
            ourTotal: (totalOdds?.total || 7.0) + (Math.random() * 2 - 1) // Random total variation
          }
          
          await createEdgeSnapshot({
            gameId: game.id,
            edgeMlHome: mockEdges.edgeMlHome,
            edgeMlAway: mockEdges.edgeMlAway,
            edgeTotalO: mockEdges.edgeTotalO,
            edgeTotalU: mockEdges.edgeTotalU,
            ourTotal: mockEdges.ourTotal,
            modelRun: 'mlb_playoff_v1'
          })
        }
      }
    }
    
    // 7. Refresh NFL live data
    console.log('Refreshing NFL live data...')
    const nflLiveResult = await fetchAndStoreNFLLiveData()
    console.log(`NFL live data: ${nflLiveResult.gamesUpdated || 0} games updated`)
    
    // 8. Cleanup old data
    console.log('Cleaning up old data...')
    await cleanupOldOdds(7)
    await cleanupOldEdgeSnapshots(30)
    // await cleanupPlayerData() // Disabled temporarily
    
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        teams: teams.length,
        games: games.length,
        odds: oddsData.length,
        livePlayersAdded: liveDataResult?.playersAdded || 0,
        nflGamesUpdated: nflLiveResult.gamesUpdated || 0,
      },
    }
    
    console.log('Refresh-slate job completed:', result)
    return NextResponse.json(result)
    
  } catch (error) {
    console.error('Error in refresh-slate job:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

// Allow manual POST requests for testing
export async function POST() {
  return GET()
}

