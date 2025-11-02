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
    
    // Step 1: Query all games
    const { data: allGames, error: gameError } = await supabase
      .from('Game')
      .select('*')
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
    
    // Step 2: Get all unique team IDs
    const teamIds = new Set()
    allGames.forEach(game => {
      if (game.homeId) teamIds.add(game.homeId)
      if (game.awayId) teamIds.add(game.awayId)
    })
    
    console.log(`🔍 Found ${teamIds.size} unique team IDs`)
    
    // Step 3: Query all teams we need
    const { data: allTeams, error: teamError } = await supabase
      .from('Team')
      .select('id, name, abbr')
      .in('id', Array.from(teamIds))
    
    if (teamError) {
      console.error('❌ Team query error:', teamError)
      // Don't throw - continue without team data
    }
    
    // Step 4: Create a map for easy lookup
    const teamMap = {}
    if (allTeams) {
      allTeams.forEach(team => {
        teamMap[team.id] = team
      })
    }
    
    console.log(`🎯 Loaded ${Object.keys(teamMap).length} teams`)
    
    // Step 5: Enrich games with team data
    const enrichedGames = allGames.map(game => ({
      id: game.id,
      sport: game.sport,
      date: game.date,
      status: game.status,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      home: teamMap[game.homeId] || { id: game.homeId, name: 'Unknown', abbr: '?' },
      away: teamMap[game.awayId] || { id: game.awayId, name: 'Unknown', abbr: '?' },
      week: game.week,
      season: game.season,
      inning: game.inning,
      inningHalf: game.inningHalf
    }))
    
    // Step 6: Group by sport
    const mlbGames = enrichedGames.filter(g => g.sport === 'mlb')
    const nflGames = enrichedGames.filter(g => g.sport === 'nfl')
    const nhlGames = enrichedGames.filter(g => g.sport === 'nhl')
    
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
