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
    
    let allEvents = []
    
    if (sport === 'nhl') {
      // NHL: Fetch games for next 7 days (to match Odds API which returns games for multiple days)
      // ESPN NHL scoreboard only returns today's games, so we need to query multiple dates
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      
      for (let i = 0; i < 7; i++) {
        const targetDate = new Date(today)
        targetDate.setDate(today.getDate() + i)
        const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '')
        // Store the queried date (YYYY-MM-DD) for use when creating game records
        const queriedDateStr = targetDate.toISOString().split('T')[0]
        
        const url = `https://site.api.espn.com/apis/site/v2/sports/${sportInfo.sportType}/${sportInfo.league}/scoreboard?dates=${dateStr}`
        
        try {
          const response = await fetch(url, {
            headers: { 'User-Agent': 'OddsOnDeck/1.0' }
          })
          
          if (response.ok) {
            const data = await response.json()
            const events = data.events || []
            if (events.length > 0) {
              // Attach the queried date to each event so we can use it later
              const eventsWithDate = events.map(event => ({
                ...event,
                _queriedDate: queriedDateStr // Store the date we queried for
              }))
              allEvents = [...allEvents, ...eventsWithDate]
              console.log(`  📅 ${targetDate.toLocaleDateString()}: ${events.length} games`)
            }
          }
          
          // Small delay to avoid rate limiting
          await new Promise(r => setTimeout(r, 200))
        } catch (error) {
          console.warn(`  ⚠️  Error fetching ${targetDate.toLocaleDateString()}: ${error.message}`)
        }
      }
      
      // Remove duplicates by event ID
      const uniqueEvents = Array.from(
        new Map(allEvents.map(event => [event.id, event])).values()
      )
      
      console.log(`📅 Total games across next 7 days: ${uniqueEvents.length}`)
      allEvents = uniqueEvents
      
    } else {
      // NFL and other sports: Use scoreboard endpoint
      const url = `https://site.api.espn.com/apis/site/v2/sports/${sportInfo.sportType}/${sportInfo.league}/scoreboard`
      
      console.log(`📡 URL: ${url}`)
      
      const response = await fetch(url)
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`ESPN API error: ${response.status} - ${text}`)
      }
      
      const data = await response.json()
      allEvents = data.events || []
    }
    
    // Filter by date for NFL
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    if (sport === 'nfl') {
      // NFL: Current WEEK's games (Thursday to Monday)
      // NFL week runs Thursday Night Football → Sunday slate → Monday Night Football
      // If we're on Tuesday/Wednesday, fetch the upcoming week (next Thu-Mon)
      const dayOfWeek = now.getDay()
      let weekStart, weekEnd
      
      if (dayOfWeek === 2 || dayOfWeek === 3) {
        // Tuesday or Wednesday - fetch upcoming week (next Thursday to next Monday)
        const daysUntilThursday = dayOfWeek === 2 ? 2 : 1
        weekStart = new Date(today)
        weekStart.setDate(today.getDate() + daysUntilThursday)
        weekEnd = new Date(weekStart)
        weekEnd.setDate(weekStart.getDate() + 5)
        weekEnd.setDate(weekEnd.getDate() - 1) // Go back to Monday
        weekEnd.setHours(23, 59, 59)
      } else {
        // Thursday through Monday - fetch current week
        if (dayOfWeek === 4) {
          weekStart = new Date(today)
        } else if (dayOfWeek === 0) {
          weekStart = new Date(today)
          weekStart.setDate(today.getDate() - 3) // Go back to Thursday
        } else if (dayOfWeek === 1) {
          weekStart = new Date(today)
          weekStart.setDate(today.getDate() - 4) // Go back to Thursday
        } else if (dayOfWeek === 5) {
          weekStart = new Date(today)
          weekStart.setDate(today.getDate() - 1) // Go back to Thursday
        } else if (dayOfWeek === 6) {
          weekStart = new Date(today)
          weekStart.setDate(today.getDate() - 2) // Go back to Thursday
        }
        
        weekEnd = new Date(weekStart)
        weekEnd.setDate(weekStart.getDate() + 5)
        weekEnd.setDate(weekEnd.getDate() - 1) // Go back to Monday
        weekEnd.setHours(23, 59, 59)
      }
      
      allEvents = allEvents.filter(event => {
        const gameDate = new Date(event.date)
        return gameDate >= weekStart && gameDate <= weekEnd
      })
      console.log(`📅 Filtered to THIS WEEK's games (Thu-Mon: ${weekStart.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}): ${allEvents.length}`)
    }
    
    console.log(`✅ Found ${allEvents.length} ${sport.toUpperCase()} games`)
    
    return allEvents.map(event => {
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
      // For NHL: Use the queried date (the date we asked ESPN for) instead of event.date
      // This avoids timezone issues where ESPN returns games for Nov 5 but event.date is Nov 6 UTC
      let gameDate, dateStr
      
      if (sport === 'nhl' && event._queriedDate) {
        // Use the date we queried for (the date parameter in the URL)
        dateStr = event._queriedDate
        gameDate = new Date(dateStr + 'T00:00:00Z') // Create UTC date from queried date
      } else {
        // For other sports, use event.date and normalize to UTC
        const parsedDate = new Date(event.date)
        gameDate = new Date(Date.UTC(
          parsedDate.getUTCFullYear(),
          parsedDate.getUTCMonth(),
          parsedDate.getUTCDate()
        ))
        dateStr = gameDate.toISOString().split('T')[0]
      }
      
      const gameId = homeAbbr && awayAbbr 
        ? createGameId(awayAbbr, homeAbbr, dateStr)
        : event.id // Fallback to ESPN ID if we don't have abbreviations
      
      return {
        id: gameId,
        sport: sport.toLowerCase(),
        date: gameDate, // Use normalized date
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
    
    // Before upserting, check for existing games with same ESPN ID but different game ID
    // This prevents duplicates when dates shift due to timezone issues
    for (const game of gamesToUpsert) {
      if (game.espnGameId) {
        // Find any existing games with this ESPN ID
        const { data: existing } = await supabase
          .from('Game')
          .select('id, oddsApiEventId')
          .eq('espnGameId', game.espnGameId)
          .neq('id', game.id)
        
        if (existing && existing.length > 0) {
          // If existing game has odds mapped, keep it and skip this one
          const hasOdds = existing.find(g => g.oddsApiEventId)
          if (hasOdds) {
            console.log(`  ⚠️  Skipping ${game.id} - duplicate ESPN ID ${game.espnGameId} exists with odds`)
            // Remove from gamesToUpsert
            const index = gamesToUpsert.findIndex(g => g.id === game.id)
            if (index > -1) {
              gamesToUpsert.splice(index, 1)
            }
            continue
          }
          
          // Otherwise, delete the old duplicate(s)
          const oldIds = existing.map(g => g.id)
          await supabase
            .from('Game')
            .delete()
            .in('id', oldIds)
        }
      }
    }
    
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
