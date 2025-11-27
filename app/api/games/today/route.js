// Simple API endpoint to get today's games
// Using Supabase client instead of Prisma (no build-time dependency!)

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase.js'

// Helper to get NFL week boundaries (Thursday to Monday)
// Shows UPCOMING games: Thu-Mon of current NFL week
function getNFLWeekBounds(now) {
  const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dayOfWeek = estDate.getDay() // 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat
  
  // Calculate days until next Thursday
  // If today is Tue(2) or Wed(3), show upcoming Thu-Mon
  // If today is Thu(4)-Mon(1), show current Thu-Mon
  let thursday = new Date(estDate)
  
  if (dayOfWeek === 2 || dayOfWeek === 3) {
    // Tuesday or Wednesday - show upcoming Thursday
    const daysUntilThursday = (4 - dayOfWeek + 7) % 7 || 7
    thursday.setDate(estDate.getDate() + daysUntilThursday)
  } else if (dayOfWeek >= 4) {
    // Thursday, Friday, Saturday - find this week's Thursday
    thursday.setDate(estDate.getDate() - (dayOfWeek - 4))
  } else {
    // Sunday (0) or Monday (1) - find last Thursday
    thursday.setDate(estDate.getDate() - (dayOfWeek + 3))
  }
  
  thursday.setHours(0, 0, 0, 0)
  
  // Monday is 4 days after Thursday
  const monday = new Date(thursday)
  monday.setDate(thursday.getDate() + 4)
  monday.setHours(23, 59, 59, 999)
  
  return { thursday, monday }
}

export async function GET(req) {
  try {
    console.log('📅 API: Fetching today\'s games...')

    // Get current time
    const now = new Date()
    
    // Get today's date in EST using proper formatting
    const estFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    const estDateStr = estFormatter.format(now) // Format: YYYY-MM-DD

    console.log(`📅 Today (EST): ${estDateStr}`)

    // Get NFL week bounds (Thursday-Monday)
    const nflWeek = getNFLWeekBounds(now)
    console.log(`🏈 NFL week: ${nflWeek.thursday.toISOString()} to ${nflWeek.monday.toISOString()}`)

    // Query games - combine today's games (NHL/MLB) + NFL week (Thu-Mon)
    // windowStart = min of (today - 1 day, NFL Thursday - 1 day)
    // windowEnd = max of (today + 2 days, NFL Monday + 1 day)
    const todayStart = new Date(now)
    todayStart.setDate(now.getDate() - 1)
    todayStart.setHours(0, 0, 0, 0)
    
    const todayEnd = new Date(now)
    todayEnd.setDate(now.getDate() + 2)
    todayEnd.setHours(23, 59, 59, 999)
    
    const nflStart = new Date(nflWeek.thursday)
    nflStart.setDate(nflStart.getDate() - 1)
    
    const nflEnd = new Date(nflWeek.monday)
    nflEnd.setDate(nflEnd.getDate() + 1)
    
    const windowStart = new Date(Math.min(todayStart.getTime(), nflStart.getTime()))
    const windowEnd = new Date(Math.max(todayEnd.getTime(), nflEnd.getTime()))

    const { data: allGames, error } = await supabase
      .from('Game')
      .select('*')
      .gte('date', windowStart.toISOString())
      .lte('date', windowEnd.toISOString())
      .order('date', { ascending: true })

    if (error) {
      console.error('❌ Database error:', error.message)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // Get all unique team IDs from games
    const teamIds = new Set()
    allGames?.forEach(game => {
      if (game.homeId) teamIds.add(game.homeId)
      if (game.awayId) teamIds.add(game.awayId)
    })

    // Fetch team data
    const { data: teams } = await supabase
      .from('Team')
      .select('id, name, abbr')
      .in('id', Array.from(teamIds))

    // Create team lookup map
    const teamMap = {}
    teams?.forEach(team => {
      teamMap[team.id] = team
    })

    // Filter and enrich games
    const mlbGames = []
    const nflGames = []
    const nhlGames = []

    for (const game of allGames || []) {
      // IMPORTANT: Add 'Z' suffix if missing to ensure UTC parsing
      const dateStr = game.date?.endsWith('Z') ? game.date : game.date + 'Z'
      const gameDate = new Date(dateStr)
      
      // Get game's EST date
      const gameEstDate = estFormatter.format(gameDate) // Format: YYYY-MM-DD

      // Enrich game with team names (nested format for frontend compatibility)
      const homeTeam = teamMap[game.homeId] || { name: 'Unknown', abbr: '?' }
      const awayTeam = teamMap[game.awayId] || { name: 'Unknown', abbr: '?' }
      
      const enrichedGame = {
        ...game,
        date: dateStr,
        home: homeTeam,  // Nested object: { abbr, name }
        away: awayTeam   // Nested object: { abbr, name }
      }

      if (game.sport === 'nfl') {
        // NFL: Show entire week (Thursday-Monday)
        if (gameDate >= nflWeek.thursday && gameDate <= nflWeek.monday) {
          nflGames.push(enrichedGame)
        }
      } else if (gameEstDate === estDateStr) {
        // MLB/NHL: Show today only
        if (game.sport === 'mlb') mlbGames.push(enrichedGame)
        else if (game.sport === 'nhl') nhlGames.push(enrichedGame)
      }
    }

    console.log(`📊 Games: MLB=${mlbGames.length}, NFL=${nflGames.length} (week), NHL=${nhlGames.length}`)

    // Return response
    return NextResponse.json({
      success: true,
      data: {
        mlb: mlbGames,
        nfl: nflGames,
        nhl: nhlGames
      },
      timestamp: now.toISOString(),
      debug: {
        estDate: estDateStr,
        serverTime: now.toISOString(),
        nflWeekStart: nflWeek.thursday.toISOString(),
        nflWeekEnd: nflWeek.monday.toISOString(),
        totalGames: allGames?.length || 0
      }
    })

  } catch (error) {
    console.error('❌ API Error:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}