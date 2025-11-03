#!/usr/bin/env node

/**
 * FETCH FRESH GAMES FROM ESPN API
 * 
 * Uses FREE ESPN API to get current games with correct times
 * Saves to Supabase database
 * 
 * Usage:
 *   node scripts/fetch-fresh-games.js           # Fetch all sports for today
 *   node scripts/fetch-fresh-games.js mlb       # MLB only
 *   node scripts/fetch-fresh-games.js nfl 2025-11-02   # NFL for specific date
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { createGameId } from '../lib/team-mapping.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// ESPN sport IDs - CORRECTED
const SPORT_MAP = {
  'nfl': { sportType: 'football', league: 'nfl' },
  'nhl': { sportType: 'hockey', league: 'nhl' }
}

const TEAM_MAP = {
  // MLB teams
  'LAD': 25, 'TOR': 141, 'NYM': 121, 'WSH': 145,
  // NFL teams  
  'KC': 12, 'BUF': 25, 'DEN': 25, 'HOU': 25,
  // NHL teams
  'BOS': 1, 'CAR': 25
}

async function fetchGamesFromESPN(sport, date) {
  try {
    const sportInfo = SPORT_MAP[sport.toLowerCase()]
    if (!sportInfo) throw new Error(`Unknown sport: ${sport}`)

    console.log(`\n🔄 Fetching ${sport.toUpperCase()} games from ESPN...`)
    
    // CORRECT ESPN API endpoint format
    const league = sportInfo.league
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sportInfo.sportType}/${sportInfo.league}/scoreboard`
    
    console.log(`📡 URL: ${url}`)
    
    const response = await fetch(url)
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`ESPN API error: ${response.status} - ${text}`)
    }
    
    const data = await response.json()
    let events = data.events || []
    
    // Filter by date
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrowStart = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    
    if (sport === 'nhl') {
      // NHL: Only TODAY's games
      events = events.filter(event => {
        const gameDate = new Date(event.date)
        const gameDay = new Date(gameDate.getFullYear(), gameDate.getMonth(), gameDate.getDate())
        return gameDay.getTime() === today.getTime()
      })
      console.log(`📅 Filtered to TODAY's games: ${events.length}`)
    } else if (sport === 'nfl') {
      // NFL: Current WEEK's games (Sunday to Sunday)
      // NFL week runs Sunday to Sunday, so we need to find the most recent Sunday
      const dayOfWeek = now.getDay()
      const mostRecentSunday = new Date(today)
      if (dayOfWeek === 0) {
        // Today is Sunday, use today
        mostRecentSunday.setDate(today.getDate())
      } else {
        // Go back to last Sunday
        mostRecentSunday.setDate(today.getDate() - dayOfWeek)
      }
      const nextSunday = new Date(mostRecentSunday)
      nextSunday.setDate(mostRecentSunday.getDate() + 7)
      nextSunday.setHours(23, 59, 59)
      
      events = events.filter(event => {
        const gameDate = new Date(event.date)
        return gameDate >= mostRecentSunday && gameDate < nextSunday
      })
      console.log(`📅 Filtered to THIS WEEK's games (${mostRecentSunday.toLocaleDateString()} - ${nextSunday.toLocaleDateString()}): ${events.length}`)
    }
    
    console.log(`✅ Found ${events.length} ${sport.toUpperCase()} games`)
    
    return events.map(event => {
      const competition = event.competitions?.[0]
      const home = competition?.competitors?.[0]
      const away = competition?.competitors?.[1]
      
      // Map ESPN team IDs to our format: "NFL_3" or "NHL_25"
      const prefix = sport.toUpperCase() + '_'
      const homeId = home?.team?.id ? `${prefix}${home.team.id}` : null
      const awayId = away?.team?.id ? `${prefix}${away.team.id}` : null
      
      // Get team abbreviations for consistent game ID
      const homeAbbr = home?.team?.abbreviation || home?.team?.abbr || null
      const awayAbbr = away?.team?.abbreviation || away?.team?.abbr || null
      
      // Create consistent game ID using descriptive format
      const gameDate = new Date(event.date)
      const dateStr = gameDate.toISOString().split('T')[0]
      const gameId = homeAbbr && awayAbbr 
        ? createGameId(awayAbbr, homeAbbr, dateStr)
        : event.id // Fallback to ESPN ID if we don't have abbreviations
      
      return {
        id: gameId,
        sport: sport.toLowerCase(),
        date: gameDate,
        status: event.status?.type?.name?.toLowerCase() || 'scheduled',
        homeId: homeId,
        awayId: awayId,
        homeScore: home?.score ? parseInt(home.score) : null,
        awayScore: away?.score ? parseInt(away.score) : null,
        espnGameId: event.id // Store original ESPN ID separately
      }
    })
  } catch (error) {
    console.error(`❌ Error fetching ${sport}:`, error.message)
    return []
  }
}

async function saveToSupabase(sport, games) {
  if (!games.length) {
    console.log(`⚠️  No games to save for ${sport.toUpperCase()}`)
    return 0
  }

  try {
    console.log(`💾 Saving ${games.length} ${sport.toUpperCase()} games to Supabase...`)
    
    // Use UPSERT to update existing games or create new ones
    // This prevents duplicates and preserves foreign key relationships
    const gamesToUpsert = games.map(g => ({
      id: g.id,
      sport: g.sport,
      date: g.date.toISOString(),
      status: g.status,
      homeId: g.homeId,
      awayId: g.awayId,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      espnGameId: g.espnGameId
    }))
    
    // Batch upsert all games at once
    const { data, error: upsertError } = await supabase
      .from('Game')
      .upsert(gamesToUpsert, {
        onConflict: 'id'
      })
      .select()
    
    if (upsertError) {
      throw upsertError
    }
    
    const saved = data?.length || games.length
    console.log(`✅ Saved ${saved} games (upserted - updates existing, creates new)`)
    return saved
  } catch (error) {
    console.error(`❌ Error saving ${sport}:`, error.message)
    return 0
  }
}

async function main() {
  const allArgs = process.argv.slice(2)
  const sport = allArgs[0]?.toLowerCase() || 'all'
  const date = allArgs[1] || null
  
  console.log('🎯 FETCH FRESH GAMES FROM ESPN API')
  console.log(`📅 Date: ${date || 'Today'}`)
  console.log(''.padEnd(50, '='))
  
  let totalSaved = 0
  
  if (sport === 'all') {
    // Fetch all sports
    for (const s of ['nfl', 'nhl']) {
      const games = await fetchGamesFromESPN(s, date)
      totalSaved += await saveToSupabase(s, games)
      // Rate limit
      await new Promise(r => setTimeout(r, 1000))
    }
  } else if (SPORT_MAP[sport]) {
    // Fetch specific sport
    const games = await fetchGamesFromESPN(sport, date)
    totalSaved += await saveToSupabase(sport, games)
  } else {
    console.error(`❌ Invalid sport: ${sport}. Use: nfl, nhl, or all`)
    process.exit(1)
  }
  
  console.log('\n' + ''.padEnd(50, '='))
  console.log(`📊 TOTAL SAVED: ${totalSaved} games`)
  console.log('✅ Fresh games fetched and saved!')
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
