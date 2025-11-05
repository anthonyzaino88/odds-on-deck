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
    
    // Calculate date ranges
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // NFL: Current week (Thursday to Monday)
    // NFL week runs Thursday Night Football → Sunday slate → Monday Night Football
    // If we're on Tuesday/Wednesday, show the upcoming week (next Thu-Mon)
    const dayOfWeek = now.getDay() // 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
    let weekStart, weekEnd
    
    if (dayOfWeek === 2 || dayOfWeek === 3) {
      // Tuesday or Wednesday - show upcoming week (next Thursday to next Monday)
      const daysUntilThursday = dayOfWeek === 2 ? 2 : 1 // Tuesday: 2 days, Wednesday: 1 day
      weekStart = new Date(today)
      weekStart.setDate(today.getDate() + daysUntilThursday)
      weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 5) // Thursday + 5 days = Tuesday at 00:00
      weekEnd.setDate(weekEnd.getDate() - 1) // Go back to Monday
      weekEnd.setHours(23, 59, 59, 999)
    } else {
      // Thursday through Monday - show current week
      // Find the most recent Thursday
      if (dayOfWeek === 4) {
        // Today is Thursday
        weekStart = new Date(today)
      } else if (dayOfWeek === 0) {
        // Today is Sunday
        weekStart = new Date(today)
        weekStart.setDate(today.getDate() - 3) // Go back 3 days to Thursday
      } else if (dayOfWeek === 1) {
        // Today is Monday
        weekStart = new Date(today)
        weekStart.setDate(today.getDate() - 4) // Go back 4 days to Thursday
      } else if (dayOfWeek === 5) {
        // Today is Friday
        weekStart = new Date(today)
        weekStart.setDate(today.getDate() - 1) // Go back 1 day to Thursday
      } else if (dayOfWeek === 6) {
        // Today is Saturday
        weekStart = new Date(today)
        weekStart.setDate(today.getDate() - 2) // Go back 2 days to Thursday
      }
      
      // Week ends on Monday (inclusive, so Monday 23:59:59)
      weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 5) // Thursday + 5 days = Tuesday at 00:00
      weekEnd.setDate(weekEnd.getDate() - 1) // Go back to Monday
      weekEnd.setHours(23, 59, 59, 999)
    }
    
    console.log(`📅 Date ranges: MLB/NHL today (${today.toISOString()}), NFL week (${weekStart.toISOString()} - ${weekEnd.toISOString()})`)
    
    // Step 1: Query games with date filtering
    // MLB: Today only
    const { data: mlbGames, error: mlbError } = await supabase
      .from('Game')
      .select('*')
      .eq('sport', 'mlb')
      .gte('date', today.toISOString())
      .lt('date', tomorrow.toISOString())
    
    // NFL: Current week (Sunday to Sunday) - exclude games that are final and older than current week
    const { data: nflGames, error: nflError } = await supabase
      .from('Game')
      .select('*')
      .eq('sport', 'nfl')
      .gte('date', weekStart.toISOString())
      .lt('date', weekEnd.toISOString())
      .order('date', { ascending: true })
    
    // NHL: Today only
    const { data: nhlGames, error: nhlError } = await supabase
      .from('Game')
      .select('*')
      .eq('sport', 'nhl')
      .gte('date', today.toISOString())
      .lt('date', tomorrow.toISOString())
    
    if (mlbError || nflError || nhlError) {
      console.error('❌ Game query error:', { mlbError, nflError, nhlError })
      throw mlbError || nflError || nhlError
    }
    
    // Combine all games
    const allGames = [
      ...(mlbGames || []),
      ...(nflGames || []),
      ...(nhlGames || [])
    ]
    
    console.log(`✅ Retrieved ${allGames.length} games (MLB: ${mlbGames?.length || 0}, NFL: ${nflGames?.length || 0}, NHL: ${nhlGames?.length || 0})`)
    
    if (!allGames || allGames.length === 0) {
      console.log('⚠️ No games found in database for today/this week')
      return NextResponse.json({
        success: true,
        data: { mlb: [], nfl: [], nhl: [] },
        debug: 'No games in database for current date range',
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
    
    // Step 5: Group by sport and apply additional filtering
    const mlbFinal = enrichedGames.filter(g => g.sport === 'mlb')
    
    // NFL: Additional filtering - only show current week's games (Thu-Mon)
    // Exclude: games from previous weeks, final games from before today
    // Include: games scheduled for today or future, live games from today, final games from today
    const nflFiltered = enrichedGames.filter(g => {
      if (g.sport !== 'nfl') return false
      
      const gameDate = new Date(g.date)
      const gameDay = new Date(gameDate.getFullYear(), gameDate.getMonth(), gameDate.getDate())
      const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      
      // Game must be in the current week range (Sunday to Sunday)
      if (gameDate < weekStart || gameDate >= weekEnd) {
        return false
      }
      
      // Exclude final games from previous days (keep only today's final games)
      if (g.status === 'final' && gameDay < todayDay) {
        return false
      }
      
      // Include all other games (scheduled, live, today's finals, future games)
      return true
    })
    const nflFinal = nflFiltered
    
    const nhlFinal = enrichedGames.filter(g => g.sport === 'nhl')
    
    console.log(`✅ Final counts - MLB: ${mlbFinal.length}, NFL: ${nflFinal.length}, NHL: ${nhlFinal.length}`)
    
    return NextResponse.json({
      success: true,
      data: {
        mlb: mlbFinal,
        nfl: nflFinal,
        nhl: nhlFinal
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
