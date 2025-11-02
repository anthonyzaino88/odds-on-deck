// API endpoint to get today's games and upcoming games

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET() {
  try {
    console.log('📅 API: Fetching games...')
    
    // TEST: Fetch ALL games with NO filters
    console.log('🔍 Testing: Fetch all games...')
    const allGames = await prisma.game.findMany({
      take: 100
    })
    console.log(`✅ Total games found: ${allGames.length}`)
    
    if (allGames.length === 0) {
      console.log('❌ No games found at all!')
      return NextResponse.json({
        success: true,
        data: { mlb: [], nfl: [], nhl: [] },
        debug: 'No games in database',
        timestamp: new Date().toISOString()
      })
    }
    
    // Group by sport
    const mlbGames = allGames.filter(g => g.sport === 'mlb')
    const nflGames = allGames.filter(g => g.sport === 'nfl')
    const nhlGames = allGames.filter(g => g.sport === 'nhl')
    
    console.log(`✅ MLB: ${mlbGames.length}, NFL: ${nflGames.length}, NHL: ${nhlGames.length}`)
    
    return NextResponse.json({
      success: true,
      data: {
        mlb: mlbGames,
        nfl: nflGames,
        nhl: nhlGames
      },
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('❌ API error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      data: { mlb: [], nfl: [], nhl: [] },
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}
