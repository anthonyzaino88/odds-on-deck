// Fetch fresh NHL games for TODAY (Oct 31, 2025) and clear old ones

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function POST(request) {
  try {
    console.log('🔄 Refreshing NHL games for TODAY (Oct 31, 2025)...')
    
    // Delete ALL old NHL games to start fresh
    const deleted = await prisma.game.deleteMany({
      where: { sport: 'nhl' }
    })
    console.log(`🗑️ Deleted ${deleted.count} old NHL games`)
    
    // Fetch fresh NHL schedule from ESPN
    const { fetchNHLSchedule, fetchNHLTeams } = await import('../../../../lib/vendors/nhl-stats.js')
    
    // Ensure teams exist first
    console.log('📋 Ensuring NHL teams exist...')
    const teams = await fetchNHLTeams()
    let teamsAdded = 0
    
    for (const team of teams) {
      try {
        await prisma.team.upsert({
          where: { id: team.id },
          update: {
            name: team.name,
            abbr: team.abbr,
            sport: team.sport,
            league: team.league,
            division: team.division
          },
          create: {
            id: team.id,
            name: team.name,
            abbr: team.abbr,
            sport: team.sport,
            league: team.league,
            division: team.division
          }
        })
        teamsAdded++
      } catch (error) {
        console.error(`Failed to upsert team ${team.id}:`, error.message)
      }
    }
    console.log(`✅ ${teamsAdded} teams ready`)
    
    // Fetch games for Oct 30, 31, and Nov 1 (to catch all relevant games)
    const dates = ['2025-10-30', '2025-10-31', '2025-11-01']
    let allGames = []
    
    for (const date of dates) {
      try {
        console.log(`📅 Fetching games for ${date}...`)
        const games = await fetchNHLSchedule(date)
        console.log(`  Found ${games.length} games`)
        allGames = [...allGames, ...games]
      } catch (error) {
        console.error(`  Error fetching ${date}:`, error.message)
      }
    }
    
    // Remove duplicates
    const uniqueGames = Array.from(
      new Map(allGames.map(game => [game.id, game])).values()
    )
    
    console.log(`📊 Total unique games found: ${uniqueGames.length}`)
    
    // Insert games
    let gamesAdded = 0
    const errors = []
    
    for (const game of uniqueGames) {
      try {
        await prisma.game.upsert({
          where: { id: game.id },
          update: {
            date: game.date,
            status: game.status,
            homeScore: game.homeScore,
            awayScore: game.awayScore,
            espnGameId: game.espnGameId,
            season: game.season
          },
          create: {
            id: game.id,
            sport: game.sport,
            date: game.date,
            homeId: game.homeId,
            awayId: game.awayId,
            status: game.status,
            homeScore: game.homeScore,
            awayScore: game.awayScore,
            espnGameId: game.espnGameId,
            season: game.season
          }
        })
        gamesAdded++
        
        const gameDate = new Date(game.date).toLocaleString('en-US', { timeZone: 'America/New_York' })
        console.log(`  ✅ ${game.id} - ${gameDate} - ${game.status}`)
      } catch (error) {
        console.error(`  ❌ Failed ${game.id}:`, error.message)
        errors.push({ game: game.id, error: error.message })
      }
    }
    
    // Now show what we have for Oct 31 specifically
    const oct31Start = new Date('2025-10-31T00:00:00-04:00') // Oct 31 midnight ET
    const oct31End = new Date('2025-10-31T23:59:59-04:00')   // Oct 31 11:59 PM ET
    
    const oct31Games = await prisma.game.findMany({
      where: {
        sport: 'nhl',
        date: {
          gte: oct31Start,
          lte: oct31End
        }
      },
      include: {
        home: true,
        away: true
      },
      orderBy: { date: 'asc' }
    })
    
    console.log(`\n🎯 Games specifically for Oct 31: ${oct31Games.length}`)
    oct31Games.forEach(g => {
      const time = new Date(g.date).toLocaleString('en-US', { timeZone: 'America/New_York' })
      console.log(`  - ${g.away?.abbr} @ ${g.home?.abbr} at ${time} (${g.status})`)
    })
    
    return NextResponse.json({
      success: true,
      deleted: deleted.count,
      teamsAdded,
      totalGamesFound: uniqueGames.length,
      gamesAdded,
      oct31GamesCount: oct31Games.length,
      oct31Games: oct31Games.map(g => ({
        id: g.id,
        time: new Date(g.date).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        matchup: `${g.away?.abbr} @ ${g.home?.abbr}`,
        status: g.status
      })),
      errors: errors.length > 0 ? errors : undefined,
      message: `Refreshed NHL data. ${oct31Games.length} games for Oct 31.`
    })
    
  } catch (error) {
    console.error('❌ Critical error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}

export async function GET(request) {
  return POST(request)
}

