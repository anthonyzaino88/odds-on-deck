// Manually trigger NHL game fetch
// Useful for testing and manual refreshes

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

export async function POST(request) {
  try {
    console.log('🏒 Manually fetching NHL games...')
    
    const { fetchNHLSchedule, fetchNHLTeams } = await import('../../../../lib/vendors/nhl-stats.js')
    const { upsertTeam, upsertGame } = await import('../../../../lib/db.js')
    
    let gamesAdded = 0
    let teamsAdded = 0
    
    // Fetch and upsert NHL teams first
    console.log('🏒 Fetching NHL teams...')
    const teams = await fetchNHLTeams()
    for (const team of teams) {
      try {
        await upsertTeam(team)
        teamsAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    console.log(`✅ Upserted ${teamsAdded} NHL teams`)
    
    // Try multiple dates to handle timezone issues
    // Fetch today, yesterday, and tomorrow to ensure we get games
    const dates = []
    const today = new Date()
    
    // Yesterday (in case server is ahead)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    dates.push(yesterday.toISOString().split('T')[0])
    
    // Today
    dates.push(today.toISOString().split('T')[0])
    
    // Tomorrow (in case server is behind)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    dates.push(tomorrow.toISOString().split('T')[0])
    
    console.log(`🏒 Fetching NHL schedule for dates: ${dates.join(', ')}`)
    
    // Fetch games for all three dates
    let allGames = []
    for (const date of dates) {
      try {
        const games = await fetchNHLSchedule(date)
        console.log(`Found ${games.length} NHL games for ${date}`)
        allGames = [...allGames, ...games]
      } catch (error) {
        console.error(`Error fetching games for ${date}:`, error.message)
      }
    }
    
    // Remove duplicates by game ID
    const uniqueGames = Array.from(
      new Map(allGames.map(game => [game.id, game])).values()
    )
    
    console.log(`Total unique NHL games found: ${uniqueGames.length}`)
    
    // Upsert all unique games
    for (const game of uniqueGames) {
      try {
        console.log(`Upserting NHL game: ${game.id}`)
        await upsertGame(game)
        gamesAdded++
      } catch (error) {
        console.error(`Error upserting game ${game.id}:`, error.message)
      }
    }
    
    console.log(`✅ Added ${gamesAdded} NHL games`)
    
    return NextResponse.json({
      success: true,
      gamesAdded,
      teamsAdded,
      datesChecked: dates,
      message: `Fetched ${gamesAdded} NHL games and ${teamsAdded} teams (checked ${dates.length} dates)`
    })
    
  } catch (error) {
    console.error('❌ Error fetching NHL games:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

export async function GET(request) {
  return POST(request)
}

