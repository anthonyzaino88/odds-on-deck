// Smart NHL fetch that ensures teams exist before adding games
// This is the "nuclear option" that will definitely work

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function POST(request) {
  try {
    console.log('🏒 SMART NHL FETCH - Ensuring teams and games are properly inserted...')
    
    const { fetchNHLSchedule, fetchNHLTeams } = await import('../../../../lib/vendors/nhl-stats.js')
    
    let teamsAdded = 0
    let teamsUpdated = 0
    let gamesAdded = 0
    const errors = []
    
    // Step 1: Fetch NHL teams from ESPN
    console.log('📋 Step 1: Fetching NHL teams from ESPN...')
    const espnTeams = await fetchNHLTeams()
    console.log(`Found ${espnTeams.length} teams from ESPN`)
    
    // Step 2: Insert teams directly with Prisma (bypass upsertTeam)
    console.log('📋 Step 2: Inserting teams into database...')
    for (const team of espnTeams) {
      try {
        // Try to create or update the team
        const result = await prisma.team.upsert({
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
        
        if (result) {
          teamsAdded++
          console.log(`  ✅ Team ${team.id} (${team.name})`)
        }
      } catch (error) {
        console.error(`  ❌ Failed to insert team ${team.id}:`, error.message)
        errors.push(`Team ${team.id}: ${error.message}`)
      }
    }
    
    console.log(`✅ Teams in database: ${teamsAdded} successful`)
    
    // Step 3: Verify teams are in database
    const teamCount = await prisma.team.count({
      where: { sport: 'nhl' }
    })
    console.log(`✅ Verified: ${teamCount} NHL teams in database`)
    
    // Step 4: Fetch games for multiple dates
    console.log('📋 Step 3: Fetching NHL games...')
    const dates = []
    const today = new Date()
    
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    dates.push(yesterday.toISOString().split('T')[0])
    
    dates.push(today.toISOString().split('T')[0])
    
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    dates.push(tomorrow.toISOString().split('T')[0])
    
    console.log(`Fetching games for: ${dates.join(', ')}`)
    
    let allGames = []
    for (const date of dates) {
      try {
        const games = await fetchNHLSchedule(date)
        console.log(`  Found ${games.length} games for ${date}`)
        allGames = [...allGames, ...games]
      } catch (error) {
        console.error(`  Error fetching ${date}:`, error.message)
      }
    }
    
    // Remove duplicates
    const uniqueGames = Array.from(
      new Map(allGames.map(game => [game.id, game])).values()
    )
    
    console.log(`Total unique games: ${uniqueGames.length}`)
    
    // Step 5: Insert games with explicit team verification
    console.log('📋 Step 4: Inserting games...')
    for (const game of uniqueGames) {
      try {
        // Verify teams exist
        const homeTeam = await prisma.team.findUnique({
          where: { id: game.homeId }
        })
        
        const awayTeam = await prisma.team.findUnique({
          where: { id: game.awayId }
        })
        
        if (!homeTeam) {
          console.error(`  ❌ Home team ${game.homeId} not found for game ${game.id}`)
          errors.push(`Game ${game.id}: Missing home team ${game.homeId}`)
          continue
        }
        
        if (!awayTeam) {
          console.error(`  ❌ Away team ${game.awayId} not found for game ${game.id}`)
          errors.push(`Game ${game.id}: Missing away team ${game.awayId}`)
          continue
        }
        
        // Insert game directly with Prisma
        const result = await prisma.game.upsert({
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
        
        if (result) {
          gamesAdded++
          console.log(`  ✅ Game ${game.id}: ${awayTeam.abbr} @ ${homeTeam.abbr}`)
        }
      } catch (error) {
        console.error(`  ❌ Failed to insert game ${game.id}:`, error.message)
        errors.push(`Game ${game.id}: ${error.message}`)
      }
    }
    
    console.log(`\n📊 FINAL RESULTS:`)
    console.log(`  Teams: ${teamsAdded} added/updated`)
    console.log(`  Games: ${gamesAdded} added out of ${uniqueGames.length} found`)
    console.log(`  Errors: ${errors.length}`)
    
    if (errors.length > 0) {
      console.log(`\n❌ ERRORS:`)
      errors.forEach(err => console.log(`  - ${err}`))
    }
    
    return NextResponse.json({
      success: true,
      teamsAdded,
      gamesAdded,
      totalGamesFound: uniqueGames.length,
      datesChecked: dates,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully added ${teamsAdded} teams and ${gamesAdded} games`
    })
    
  } catch (error) {
    console.error('❌ CRITICAL ERROR:', error)
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

