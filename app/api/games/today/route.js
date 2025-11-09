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
    
    // Calculate date ranges - Use EST/EDT for "today" since games are scheduled in Eastern time
    const now = new Date()
    
    // Get today in Eastern timezone (America/New_York)
    // This ensures we show games for the current day in EST/EDT, not UTC
    const estDateStr = now.toLocaleDateString('en-US', { 
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    // Parse MM/DD/YYYY format
    const [month, day, year] = estDateStr.split('/')
    const today = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)))
    const tomorrow = new Date(today)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    
    // Convert to date strings for queries (YYYY-MM-DD format)
    const todayStr = today.toISOString().split('T')[0] // YYYY-MM-DD
    const tomorrowStr = tomorrow.toISOString().split('T')[0] // YYYY-MM-DD
    
    console.log(`📅 EST Date Calculation: ${estDateStr} → Today: ${todayStr}, Tomorrow: ${tomorrowStr}`)
    
    // NFL: Current week (Thursday to Monday)
    // NFL week runs Thursday Night Football → Sunday slate → Monday Night Football
    // If we're on Tuesday/Wednesday, show the upcoming week (next Thu-Mon)
    // Use EST day of week for consistency (reuse the already-calculated `today` date)
    // getUTCDay() returns 0-6 (Sunday=0, Monday=1, ..., Saturday=6)
    const dayOfWeek = today.getUTCDay()
    let weekStart, weekEnd
    
    if (dayOfWeek === 2 || dayOfWeek === 3) {
      // Tuesday or Wednesday - show upcoming week (next Thursday to next Monday)
      const daysUntilThursday = dayOfWeek === 2 ? 2 : 1 // Tuesday: 2 days, Wednesday: 1 day
      weekStart = new Date(today)
      weekStart.setUTCDate(today.getUTCDate() + daysUntilThursday)
      weekEnd = new Date(weekStart)
      weekEnd.setUTCDate(weekStart.getUTCDate() + 5) // Thursday + 5 days = Tuesday at 00:00
      weekEnd.setUTCDate(weekEnd.getUTCDate() - 1) // Go back to Monday
      weekEnd.setUTCHours(23, 59, 59, 999)
    } else {
      // Thursday through Monday - show current week
      // Find the most recent Thursday
      if (dayOfWeek === 4) {
        // Today is Thursday
        weekStart = new Date(today)
      } else if (dayOfWeek === 0) {
        // Today is Sunday
        weekStart = new Date(today)
        weekStart.setUTCDate(today.getUTCDate() - 3) // Go back 3 days to Thursday
      } else if (dayOfWeek === 1) {
        // Today is Monday
        weekStart = new Date(today)
        weekStart.setUTCDate(today.getUTCDate() - 4) // Go back 4 days to Thursday
      } else if (dayOfWeek === 5) {
        // Today is Friday
        weekStart = new Date(today)
        weekStart.setUTCDate(today.getUTCDate() - 1) // Go back 1 day to Thursday
      } else if (dayOfWeek === 6) {
        // Today is Saturday
        weekStart = new Date(today)
        weekStart.setUTCDate(today.getUTCDate() - 2) // Go back 2 days to Thursday
      }
      
      // Week ends on Monday (inclusive, so Monday 23:59:59)
      weekEnd = new Date(weekStart)
      weekEnd.setUTCDate(weekStart.getUTCDate() + 5) // Thursday + 5 days = Tuesday at 00:00
      weekEnd.setUTCDate(weekEnd.getUTCDate() - 1) // Go back to Monday
      weekEnd.setUTCHours(23, 59, 59, 999)
    }
    
    console.log(`📅 Date ranges (EST): MLB/NHL today (${todayStr}), NFL week (${weekStart.toISOString()} - ${weekEnd.toISOString()})`)
    
    // Step 1: Query games with date filtering
    // MLB: Today only (use date string format)
    const mlbTodayStart = `${todayStr}T00:00:00`
    const mlbTomorrowStart = `${tomorrowStr}T00:00:00`
    const { data: mlbGames, error: mlbError } = await supabase
      .from('Game')
      .select('*')
      .eq('sport', 'mlb')
      .gte('date', mlbTodayStart)
      .lt('date', mlbTomorrowStart)
    
    // NFL: Current week (Thursday to Monday)
    const { data: nflGames, error: nflError } = await supabase
      .from('Game')
      .select('*')
      .eq('sport', 'nfl')
      .gte('date', weekStart.toISOString())
      .lt('date', weekEnd.toISOString())
      .order('date', { ascending: true })
    
    // NHL: Today only (filter by EST date, not UTC date)
    // Problem: Games at 8 PM EST on Nov 6 = 1 AM UTC on Nov 7, so UTC-based queries include them
    // Solution: Query a wider range (yesterday to tomorrow in UTC), then filter by EST date
    
    // Query NHL games from yesterday EST (to catch late games) to tomorrow EST
    const yesterday = new Date(today)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]
    const dayAfterTomorrow = new Date(tomorrow)
    dayAfterTomorrow.setUTCDate(dayAfterTomorrow.getUTCDate() + 1)
    const dayAfterTomorrowStr = dayAfterTomorrow.toISOString().split('T')[0]
    
    const queryStart = `${yesterdayStr}T00:00:00Z`
    const queryEnd = `${dayAfterTomorrowStr}T23:59:59Z`
    
    console.log(`🔍 NHL Query: date >= ${queryStart} AND date < ${queryEnd} (then filter by EST date)`)
    const { data: nhlGamesRaw, error: nhlError } = await supabase
      .from('Game')
      .select('*')
      .eq('sport', 'nhl')
      .gte('date', queryStart)
      .lt('date', queryEnd)
      .order('date', { ascending: true })
    
    // Filter by EST date - only include games where the EST date matches today
    const nhlGames = nhlGamesRaw ? nhlGamesRaw.filter(game => {
      // Parse the game date (could be with or without Z)
      const gameDateStr = game.date || ''
      const gameDate = new Date(gameDateStr.includes('Z') || gameDateStr.includes('+') || gameDateStr.match(/[+-]\d{2}:\d{2}$/)
        ? gameDateStr
        : gameDateStr + 'Z')
      
      // Get EST date string for this game
      const gameEstDateStr = gameDate.toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
      const [gameMonth, gameDay, gameYear] = gameEstDateStr.split('/')
      const gameEstDateFormatted = `${gameYear}-${gameMonth.padStart(2, '0')}-${gameDay.padStart(2, '0')}`
      
      // Only include if EST date matches today
      const matches = gameEstDateFormatted === todayStr
      if (!matches) {
        console.log(`   ❌ Filtered out ${game.id}: EST date ${gameEstDateFormatted} !== today ${todayStr}`)
      }
      return matches
    }) : null
    
    if (nhlGamesRaw) {
      console.log(`📊 NHL Query returned ${nhlGamesRaw.length} games before EST filtering`)
      if (nhlGames) {
        console.log(`📊 NHL Filtered to ${nhlGames.length} games for today (EST date: ${todayStr})`)
        if (nhlGames.length > 0) {
          console.log(`   First game: ${nhlGames[0].id} - ${nhlGames[0].date}`)
          console.log(`   Last game: ${nhlGames[nhlGames.length - 1].id} - ${nhlGames[nhlGames.length - 1].date}`)
          console.log(`   All game IDs: ${nhlGames.map(g => g.id).join(', ')}`)
        }
        if (nhlGamesRaw.length > nhlGames.length) {
          const filteredOut = nhlGamesRaw.filter(g => !nhlGames.includes(g))
          console.log(`   Filtered out ${filteredOut.length} games from other dates:`)
          filteredOut.forEach(g => {
            const gameDateStr = g.date || ''
            const gameDate = new Date(gameDateStr.includes('Z') || gameDateStr.includes('+') || gameDateStr.match(/[+-]\d{2}:\d{2}$/)
              ? gameDateStr
              : gameDateStr + 'Z')
            const gameEstDateStr = gameDate.toLocaleDateString('en-US', {
              timeZone: 'America/New_York',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            })
            console.log(`     - ${g.id} (EST: ${gameEstDateStr}, UTC: ${g.date})`)
          })
        }
      }
    } else {
      console.log(`⚠️  NHL Query returned null/undefined`)
    }
    
    if (nhlError) {
      console.error(`❌ NHL Query error:`, nhlError)
    }
    
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
    
    // Debug: Check NHL games specifically
    const nhlInAllGames = allGames.filter(g => g.sport === 'nhl')
    console.log(`🔍 Debug: NHL games check`)
    console.log(`   Query returned: ${nhlGames?.length || 0} games`)
    console.log(`   In allGames array: ${nhlInAllGames.length} games`)
    if (nhlInAllGames.length !== (nhlGames?.length || 0)) {
      console.log(`⚠️  NHL games mismatch!`)
      console.log(`   Query game IDs: ${nhlGames?.map(g => g.id).join(', ') || 'none'}`)
      console.log(`   allGames NHL IDs: ${nhlInAllGames.map(g => g.id).join(', ') || 'none'}`)
    } else {
      console.log(`   ✅ NHL games match: ${nhlInAllGames.length} games`)
    }
    
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
        homeScore: game.homeScore ?? null,
        awayScore: game.awayScore ?? null,
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
    
    // NHL: Filter by EST date - only show games from today (EST)
    // This ensures we don't show games from tomorrow or yesterday
    // Note: We already filtered nhlGamesRaw above, but we filter again here to be safe
    const nhlFiltered = enrichedGames.filter(g => {
      if (g.sport !== 'nhl') return false
      
      // Parse the game date and convert to EST date string
      const gameDateStr = g.date || ''
      const gameDate = new Date(gameDateStr.includes('Z') || gameDateStr.includes('+') || gameDateStr.match(/[+-]\d{2}:\d{2}$/)
        ? gameDateStr
        : gameDateStr + 'Z')
      
      // Get EST date string for this game
      const gameEstDateStr = gameDate.toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
      const [gameMonth, gameDay, gameYear] = gameEstDateStr.split('/')
      const gameEstDateFormatted = `${gameYear}-${gameMonth.padStart(2, '0')}-${gameDay.padStart(2, '0')}`
      
      // Only include games from today (EST date matches todayStr)
      const matches = gameEstDateFormatted === todayStr
      if (!matches) {
        console.log(`   ❌ Final filter: Removed ${g.id} (${g.away?.abbr} @ ${g.home?.abbr}): EST ${gameEstDateFormatted} !== today ${todayStr}`)
      }
      return matches
    })
    
    // Deduplicate NHL games by matchup (home vs away) - keep only the one from today
    // This handles cases where the same matchup exists for multiple dates
    const seenMatchups = new Set()
    const nhlDeduplicated = nhlFiltered.filter(g => {
      const matchupKey = `${g.away?.abbr || '?'}_at_${g.home?.abbr || '?'}`
      if (seenMatchups.has(matchupKey)) {
        console.log(`   ⚠️  Deduplication: Removed duplicate ${g.id} (${matchupKey})`)
        return false
      }
      seenMatchups.add(matchupKey)
      return true
    })
    
    const nhlFinal = nhlDeduplicated
    
    // Debug: Log if games were filtered out
    const nhlBeforeFilter = enrichedGames.filter(g => g.sport === 'nhl')
    if (nhlBeforeFilter.length !== nhlFinal.length) {
      console.log(`⚠️  NHL filtering: ${nhlBeforeFilter.length} games before filter, ${nhlFinal.length} after filter`)
      const filteredOut = nhlBeforeFilter.filter(g => !nhlFinal.includes(g))
      if (filteredOut.length > 0) {
        console.log(`   Filtered out ${filteredOut.length} games:`)
        filteredOut.forEach(g => {
          console.log(`     - ${g.id} (${g.date}) - status: ${g.status}`)
        })
      }
    }
    
    console.log(`✅ Final counts - MLB: ${mlbFinal.length}, NFL: ${nflFinal.length}, NHL: ${nhlFinal.length}`)
    
    // Debug: Log NHL games being returned
    if (nhlFinal.length > 0) {
      console.log(`📊 NHL games being returned:`)
      nhlFinal.forEach(g => {
        console.log(`  - ${g.away?.abbr || '?'} @ ${g.home?.abbr || '?'} (${g.id})`)
      })
    }
    
    // Normalize dates - ensure they're all in UTC format with 'Z' marker
    // Supabase returns timestamps without 'Z', which can cause parsing issues
    const normalizeDates = (games) => games.map(game => ({
      ...game,
      date: game.date && !game.date.endsWith('Z') && !game.date.includes('+') 
        ? game.date + 'Z' 
        : game.date
    }))
    
    return NextResponse.json({
      success: true,
      data: {
        mlb: normalizeDates(mlbFinal),
        nfl: normalizeDates(nflFinal),
        nhl: normalizeDates(nhlFinal)
      },
      timestamp: new Date().toISOString(),
      debug: {
        nhlCount: nhlFinal.length,
        nhlGameIds: nhlFinal.map(g => g.id)
      }
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
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
