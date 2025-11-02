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
    
    // Step 2: Get all unique team IDs (strip sport prefix like "NFL_4" → "4")
    const teamIds = new Set()
    allGames.forEach(game => {
      if (game.homeId) {
        const id = stripSportPrefix(game.homeId)
        teamIds.add(id)
      }
      if (game.awayId) {
        const id = stripSportPrefix(game.awayId)
        teamIds.add(id)
      }
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
    const enrichedGames = allGames.map(game => {
      const homeId = stripSportPrefix(game.homeId)
      const awayId = stripSportPrefix(game.awayId)
      
      return {
        id: game.id,
        sport: game.sport,
        date: game.date,
        status: game.status,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        home: teamMap[homeId] || { id: homeId, name: 'Unknown', abbr: '?' },
        away: teamMap[awayId] || { id: awayId, name: 'Unknown', abbr: '?' },
        week: game.week,
        season: game.season,
        inning: game.inning,
        inningHalf: game.inningHalf
      }
    })
    
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

// Helper: Strip sport prefix from IDs like "NFL_4" → "4"
function stripSportPrefix(id) {
  if (!id) return id
  // Match format: SPORT_NUMBER (e.g., "NFL_4", "MLB_108")
  const match = id.match(/^[A-Z]+_(.+)$/)
  return match ? match[1] : id
}
