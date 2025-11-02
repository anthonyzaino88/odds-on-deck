// API endpoint to get today's games and upcoming games
// Using Supabase client instead of Prisma (no build-time dependency!)

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase.js'

export async function GET(req) {
  try {
    console.log('📅 API: Fetching games from Supabase...')
    
    // Query all games from database
    const { data: allGames, error } = await supabase
      .from('game')
      .select('*')
      .limit(100)
    
    if (error) {
      console.error('❌ Supabase error:', error)
      throw error
    }
    
    console.log(`✅ Retrieved ${allGames?.length || 0} total games`)
    
    if (!allGames || allGames.length === 0) {
      console.log('⚠️ No games found in database')
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
    console.error('❌ API error:', {
      message: error.message,
      code: error.code
    })
    
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to fetch games',
      details: {
        code: error.code
      },
      data: { mlb: [], nfl: [], nhl: [] },
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}
