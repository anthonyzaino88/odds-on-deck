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
    
    // Step 2: Query all teams
    const { data: allTeams, error: teamError } = await supabase
      .from('Team')
      .select('id, name, abbr, sport')
    
    if (teamError) {
      console.error('❌ Team query error:', teamError)
    }
    
    // Step 3: Create a map of team IDs to teams
    const teamById = {}
    if (allTeams) {
      allTeams.forEach(team => {
        if (team.id) {
          teamById[team.id] = team
        }
      })
    }
    
    console.log(`🎯 Loaded ${Object.keys(teamById).length} teams`)
    
    // Step 4: Enrich games with team data using homeId/awayId
    const enrichedGames = allGames.map(game => {
      const homeTeam = teamById[game.homeId]
      const awayTeam = teamById[game.awayId]
      
      if (!homeTeam) {
        console.warn(`⚠️ Home team not found for ID: ${game.homeId}`)
      }
      if (!awayTeam) {
        console.warn(`⚠️ Away team not found for ID: ${game.awayId}`)
      }
      
      return {
        id: game.id,
        sport: game.sport,
        date: game.date,
        status: game.status,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        home: homeTeam || { id: game.homeId, name: 'Unknown', abbr: '?' },
        away: awayTeam || { id: game.awayId, name: 'Unknown', abbr: '?' },
        week: game.week,
        season: game.season,
        inning: game.inning,
        inningHalf: game.inningHalf
      }
    })
    
    // Step 5: Group by sport
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
