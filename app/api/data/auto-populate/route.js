// Auto-populate endpoint - Call this every hour via Vercel cron or external scheduler
// This loads data INTO the database so the homepage just needs to READ it
// No timeouts because heavy work happens here, not on page load

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/db.js'
import { fetchSchedule, fetchTeams } from '../../../lib/vendors/stats.js'
import { fetchOdds } from '../../../lib/vendors/odds.js'
import { fetchEventPlayerProps } from '../../../lib/vendors/player-props-odds.js'

const MAX_DURATION = 60 // 60 seconds max duration

export async function POST() {
  const startTime = Date.now()
  
  try {
    console.log('🔄 [AUTO-POPULATE] Starting background data population...')
    
    const results = {
      success: true,
      timestamp: new Date().toISOString(),
      duration: 0,
      stats: {
        teamsUpserted: 0,
        gamesUpserted: 0,
        oddsCreated: 0,
        propsProcessed: 0,
        errors: []
      }
    }
    
    // Step 1: Populate Teams (quick)
    console.log('📋 Step 1: Populating teams...')
    try {
      const teams = await fetchTeams()
      for (const team of teams) {
        await prisma.team.upsert({
          where: { id: team.id },
          update: { name: team.name, abbr: team.abbr },
          create: { id: team.id, name: team.name, abbr: team.abbr }
        })
      }
      results.stats.teamsUpserted = teams.length
      console.log(`✅ Upserted ${teams.length} teams`)
    } catch (error) {
      const msg = `Error populating teams: ${error.message}`
      console.error(msg)
      results.stats.errors.push(msg)
    }
    
    // Step 2: Populate Games (quick)
    console.log('📅 Step 2: Populating games...')
    try {
      const games = await fetchSchedule({ useLocalDate: true, noCache: true })
      
      for (const game of games) {
        try {
          // Find teams by abbreviation (more reliable than ID)
          const [homeTeam, awayTeam] = await Promise.all([
            prisma.team.findFirst({ where: { abbr: game.home.abbr } }),
            prisma.team.findFirst({ where: { abbr: game.away.abbr } })
          ])
          
          if (homeTeam && awayTeam) {
            await prisma.game.upsert({
              where: { id: game.id },
              update: {
                date: game.date,
                status: game.status,
                sport: 'mlb'
              },
              create: {
                id: game.id,
                mlbGameId: game.mlbGameId,
                date: game.date,
                homeId: homeTeam.id,
                awayId: awayTeam.id,
                sport: 'mlb',
                status: game.status
              }
            })
            results.stats.gamesUpserted++
          }
        } catch (gameError) {
          console.error(`Error upserting game ${game.id}:`, gameError.message)
        }
      }
      console.log(`✅ Upserted ${results.stats.gamesUpserted} games`)
    } catch (error) {
      const msg = `Error populating games: ${error.message}`
      console.error(msg)
      results.stats.errors.push(msg)
    }
    
    // Step 3: Populate Odds (medium - Odds API)
    console.log('💰 Step 3: Populating odds...')
    try {
      const oddsData = await fetchOdds()
      
      for (const odds of oddsData) {
        try {
          // Check if game exists
          const game = await prisma.game.findUnique({ where: { id: odds.gameId } })
          if (game) {
            await prisma.odds.create({
              data: {
                gameId: odds.gameId,
                book: odds.book,
                market: odds.market,
                priceHome: odds.priceHome,
                priceAway: odds.priceAway
              }
            }).catch(() => {
              // Duplicate odds are OK - just skip
            })
            results.stats.oddsCreated++
          }
        } catch (oddsError) {
          // Skip individual odds errors
        }
      }
      console.log(`✅ Created odds for games`)
    } catch (error) {
      const msg = `Error populating odds: ${error.message}`
      console.error(msg)
      results.stats.errors.push(msg)
    }
    
    // Step 4: Populate Player Props (slow - The Odds API)
    console.log('🏟️ Step 4: Populating player props...')
    try {
      const allGames = await prisma.game.findMany({
        where: { sport: 'mlb', date: { gte: new Date() } },
        select: { id: true, mlbGameId: true }
      })
      
      for (const game of allGames) {
        if (!game.mlbGameId) continue
        
        try {
          const props = await fetchEventPlayerProps(game.mlbGameId, 'mlb')
          results.stats.propsProcessed += (props?.length || 0)
        } catch (propError) {
          // Props can fail for individual games - continue
        }
      }
      console.log(`✅ Processed player props`)
    } catch (error) {
      const msg = `Error populating player props: ${error.message}`
      console.error(msg)
      results.stats.errors.push(msg)
    }
    
    results.duration = Math.round((Date.now() - startTime) / 1000)
    
    console.log(`✅ [AUTO-POPULATE] Completed in ${results.duration}s`)
    console.log(JSON.stringify(results, null, 2))
    
    return NextResponse.json(results)
    
  } catch (error) {
    console.error('❌ [AUTO-POPULATE] Fatal error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      duration: Math.round((Date.now() - startTime) / 1000)
    }, { status: 500 })
  }
}

// Allow GET for testing - will act like POST
export async function GET() {
  return POST()
}
