// Fetch NHL games for a specific date
// Useful when server timezone doesn't match your local timezone

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') // Format: YYYY-MM-DD or YYYYMMDD
    
    if (!date) {
      return NextResponse.json({
        success: false,
        error: 'Date parameter required. Use ?date=2025-10-30 or ?date=20251030'
      }, { status: 400 })
    }
    
    console.log(`🏒 Fetching NHL games for date: ${date}`)
    
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
    
    // Fetch and upsert NHL games for specified date
    console.log(`🏒 Fetching NHL schedule for ${date}...`)
    const games = await fetchNHLSchedule(date)
    
    console.log(`Found ${games.length} NHL games from ESPN for ${date}`)
    
    for (const game of games) {
      try {
        console.log(`Upserting NHL game: ${game.id}`)
        await upsertGame(game)
        gamesAdded++
      } catch (error) {
        console.error(`Error upserting game ${game.id}:`, error.message)
      }
    }
    
    console.log(`✅ Added ${gamesAdded} NHL games for ${date}`)
    
    return NextResponse.json({
      success: true,
      date,
      gamesAdded,
      teamsAdded,
      message: `Fetched ${gamesAdded} NHL games for ${date}`
    })
    
  } catch (error) {
    console.error('❌ Error fetching NHL games:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

