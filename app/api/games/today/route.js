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
    
    // Query all games with team data using foreign key relationships
    const { data: allGames, error: gameError } = await supabase
      .from('Game')
      .select(`
        *,
        home:homeId (id, name, abbr, sport),
        away:awayId (id, name, abbr, sport)
      `)
      .limit(100)
    
    if (gameError) {
      console.error('❌ Game query error:', gameError)
      throw gameError
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
    
    // Group by sport and enrich with team data
    const mlbGames = allGames
      .filter(g => g.sport === 'mlb')
      .map(enrichGame)
    
    const nflGames = allGames
      .filter(g => g.sport === 'nfl')
      .map(enrichGame)
    
    const nhlGames = allGames
      .filter(g => g.sport === 'nhl')
      .map(enrichGame)
    
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

// Helper to normalize game data for display
function enrichGame(game) {
  return {
    id: game.id,
    sport: game.sport,
    date: game.date,
    status: game.status,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    home: {
      id: game.home?.id,
      name: game.home?.name,
      abbr: game.home?.abbr
    },
    away: {
      id: game.away?.id,
      name: game.away?.name,
      abbr: game.away?.abbr
    },
    // Include optional sport-specific fields
    week: game.week,
    season: game.season,
    inning: game.inning,
    inningHalf: game.inningHalf
  }
}
