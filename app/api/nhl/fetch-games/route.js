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
    
    // Fetch and upsert NHL games
    console.log('🏒 Fetching NHL schedule...')
    const games = await fetchNHLSchedule()
    
    console.log(`Found ${games.length} NHL games from ESPN`)
    
    for (const game of games) {
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
      message: `Fetched ${gamesAdded} NHL games and ${teamsAdded} teams`
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

