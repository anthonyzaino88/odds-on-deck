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

// Use secret key to bypass RLS (with fallback to anon for read-only)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// ESPN sport IDs - CORRECTED
const SPORT_MAP = {
  'nfl': { sportType: 'football', league: 'nfl' },
  'nhl': { sportType: 'hockey', league: 'nhl' }
}

// Team resolution function to prevent sport conflicts
async function resolveTeamId(espnTeamId, sport) {
  if (!espnTeamId || !sport) return null

  try {
    // First try exact match by ESPN ID and sport
    const { data: team } = await supabase
      .from('Team')
      .select('id')
      .eq('espnId', espnTeamId.toString())
      .eq('sport', sport)
      .maybeSingle()

    if (team) {
      return team.id
    }

    // Fallback: Try by abbreviation if we can determine it
    // For now, create a sport-prefixed ID as fallback
    const prefix = sport.toUpperCase() + '_'
    return `${prefix}${espnTeamId}`

  } catch (error) {
    console.warn(`⚠️ Error resolving team ${espnTeamId} for ${sport}:`, error.message)
    // Fallback to simple prefixing
    const prefix = sport.toUpperCase() + '_'
    return `${prefix}${espnTeamId}`
  }
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
      
    } else if (sport === 'nfl') {
      // NFL: Fetch games for the requested date or upcoming week
      // ESPN scoreboard with dates parameter returns games for that specific date/week
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      
      if (date) {
        // Specific date requested - fetch that date
        const dateStr = date.replace(/-/g, '')
        const url = `https://site.api.espn.com/apis/site/v2/sports/${sportInfo.sportType}/${sportInfo.league}/scoreboard?dates=${dateStr}`
        console.log(`📡 URL: ${url}`)
        
        const response = await fetch(url)
        if (!response.ok) {
          const text = await response.text()
          throw new Error(`ESPN API error: ${response.status} - ${text}`)
        }
        
        const data = await response.json()
        allEvents = data.events || []
        console.log(`📅 Found ${allEvents.length} games for ${date}`)
      } else {
        // No date specified - fetch next 7 days to get upcoming NFL week
        console.log(`📡 Fetching NFL games for next 7 days...`)
        
        for (let i = 0; i < 7; i++) {
          const targetDate = new Date(today)
          targetDate.setDate(today.getDate() + i)
          const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '')
          
          const url = `https://site.api.espn.com/apis/site/v2/sports/${sportInfo.sportType}/${sportInfo.league}/scoreboard?dates=${dateStr}`
          
          try {
            const response = await fetch(url, {
              headers: { 'User-Agent': 'OddsOnDeck/1.0' }
            })
            
            if (response.ok) {
              const data = await response.json()
              const events = data.events || []
              if (events.length > 0) {
                allEvents = [...allEvents, ...events]
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
        allEvents = uniqueEvents
        console.log(`📅 Total unique games found: ${allEvents.length}`)
      }
    } else {
      // Other sports: Use scoreboard endpoint without date
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
    
    // NFL games are now filtered by date in the fetch itself
    // No additional filtering needed
    
    console.log(`✅ Found ${allEvents.length} ${sport.toUpperCase()} games`)
    
    return Promise.all(allEvents.map(async event => {
      const competition = event.competitions?.[0]
      const home = competition?.competitors?.[0]
      const away = competition?.competitors?.[1]

      // Resolve team IDs properly by ESPN ID and sport to avoid conflicts
      const homeId = await resolveTeamId(home?.team?.id, sport)
      const awayId = await resolveTeamId(away?.team?.id, sport)
      
      // Get team abbreviations for consistent game ID
      const homeAbbr = home?.team?.abbreviation || home?.team?.abbr || null
      const awayAbbr = away?.team?.abbreviation || away?.team?.abbr || null
      
      // Create consistent game ID using descriptive format
      // For NHL: Use the queried date for the game ID (to avoid timezone issues with dates)
      // But use ESPN's actual event.date for the game time (to preserve actual start times)
      let gameDate, dateStr
      
      if (sport === 'nhl' && event._queriedDate) {
        // Use the queried date for the game ID (ensures consistent IDs)
        dateStr = event._queriedDate
        
        // For NHL: ESPN's event.date is often midnight UTC (00:00:00Z) which is a placeholder
        // We need to check if it's actually midnight UTC, and if so, use the queried date with a reasonable time
        // Otherwise, use ESPN's actual time but ensure the date matches the queried date
        const espnDate = new Date(event.date)
        const [queriedYear, queriedMonth, queriedDay] = dateStr.split('-')
        
        // For NHL, ESPN provides actual UTC times. Midnight UTC is typically 7 PM EST (during standard time)
        // Don't treat midnight UTC as a placeholder for NHL games
        gameDate = new Date(espnDate)

        // Verify the EST date matches the queried date
        const estDateStr = gameDate.toLocaleDateString('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        })
        const [estMonth, estDay, estYear] = estDateStr.split('/')
        const estDateForId = `${estYear}-${estMonth.padStart(2, '0')}-${estDay.padStart(2, '0')}`

        if (estDateForId !== dateStr) {
          console.warn(`⚠️  Date mismatch for ${awayAbbr} @ ${homeAbbr}: queried ${dateStr}, but EST date is ${estDateForId}`)
          // Use ESPN's date as it's the source of truth for the actual game time
          // But keep the queried date for the game ID to maintain consistency
        }
      } else {
        // For other sports (NFL), use event.date directly (which has actual times)
        gameDate = new Date(event.date)
        
        // CRITICAL: For game ID, use the EST date, not UTC date
        // ESPN's event.date is in UTC, so a game at 8:15 PM EST on Nov 6 = 1:15 AM UTC on Nov 7
        // We need the EST date (Nov 6) for the game ID, not the UTC date (Nov 7)
        const estDateStr = gameDate.toLocaleDateString('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        })
        // Convert MM/DD/YYYY to YYYY-MM-DD
        const [month, day, year] = estDateStr.split('/')
        dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
      }
      
      const gameId = homeAbbr && awayAbbr 
        ? createGameId(awayAbbr, homeAbbr, dateStr)
        : event.id // Fallback to ESPN ID if we don't have abbreviations
      
      // Normalize status - remove "status_" prefix and convert to standard format
      // ESPN returns status like "STATUS_IN_PROGRESS" which becomes "status_in_progress" when lowercased
      let gameStatus = event.status?.type?.name || 'STATUS_SCHEDULED'
      
      // Map ESPN status to our standard format
      if (sport === 'nhl') {
        // NHL status mapping
        const statusMap = {
          '1': 'scheduled',
          '2': 'in_progress',
          '3': 'final',
          'STATUS_SCHEDULED': 'scheduled',
          'STATUS_IN_PROGRESS': 'in_progress',
          'STATUS_FINAL': 'final',
          'STATUS_FINAL_OVERTIME': 'final',
          'STATUS_END_PERIOD': 'in_progress'
        }
        const typeId = event.status?.type?.id?.toString()
        const typeName = event.status?.type?.name
        gameStatus = statusMap[typeId] || statusMap[typeName] || 'scheduled'
      } else if (sport === 'nfl') {
        // NFL status mapping
        const statusMap = {
          '1': 'scheduled',
          '2': 'in_progress',
          '3': 'final',
          'STATUS_SCHEDULED': 'scheduled',
          'STATUS_IN_PROGRESS': 'in_progress',
          'STATUS_FINAL': 'final',
          'STATUS_HALFTIME': 'halftime'
        }
        const typeId = event.status?.type?.id?.toString()
        const typeName = event.status?.type?.name
        gameStatus = statusMap[typeId] || statusMap[typeName] || 'scheduled'
      } else {
        // For other sports, just normalize
        gameStatus = gameStatus.toLowerCase().replace(/^status_/i, '')
      }
      
      return {
        id: gameId,
        sport: sport.toLowerCase(),
        date: gameDate.toISOString(), // Convert to UTC ISO string to preserve timezone
        status: gameStatus,
        homeId: homeId,
        awayId: awayId,
        homeScore: home?.score ? parseInt(home.score) : null,
        awayScore: away?.score ? parseInt(away.score) : null,
        espnGameId: event.id // Store original ESPN ID separately
      }
    }))
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
    // Store odds migration info separately (not in upsert object)
    // Before upserting, check for existing games with same ESPN ID but different game ID
    // This prevents duplicates when dates shift due to timezone issues
    // IMPORTANT: Check ALL games first, then process in batch
    
    // Step 1: First, clean up any existing duplicates for this sport (ones without odds)
    console.log('  🧹 Checking for existing duplicates to clean up...')
    const existingGames = await supabase
      .from('Game')
      .select('id, espnGameId, oddsApiEventId')
      .eq('sport', sport)
      .not('espnGameId', 'is', null)
    
    if (existingGames.data) {
      // Group by ESPN ID
      const byEspnId = {}
      existingGames.data.forEach(g => {
        if (!byEspnId[g.espnGameId]) {
          byEspnId[g.espnGameId] = []
        }
        byEspnId[g.espnGameId].push(g)
      })
      
      // Find duplicates without odds - these can be safely deleted
      const duplicatesToClean = []
      Object.keys(byEspnId).forEach(espnId => {
        const group = byEspnId[espnId]
        if (group.length > 1) {
          const withoutOdds = group.filter(g => !g.oddsApiEventId)
          if (withoutOdds.length > 1) {
            // Keep first, delete rest
            duplicatesToClean.push(...withoutOdds.slice(1).map(g => g.id))
          }
        }
      })
      
      if (duplicatesToClean.length > 0) {
        await supabase
          .from('Game')
          .delete()
          .in('id', duplicatesToClean)
        console.log(`  🗑️  Cleaned up ${duplicatesToClean.length} old duplicates without odds`)
      }
    }
    
    // Step 2: Check for duplicates in the new batch
    // Also check by matchup (homeId + awayId + date) to catch duplicates with different ESPN IDs
    const gamesToRemove = []
    const gamesToDelete = []
    const oddsToMove = []
    
    // Check for duplicates BEFORE creating upsert array
    for (const game of games) {
      // Check 1: Duplicate by ESPN ID
      if (game.espnGameId) {
        // Find any existing games with this ESPN ID (including ones not in current batch)
        const { data: existing } = await supabase
          .from('Game')
          .select('id, oddsApiEventId, date, status')
          .eq('espnGameId', game.espnGameId)
          .neq('id', game.id)
        
        if (existing && existing.length > 0) {
          // Check if existing game has odds
          const hasOdds = existing.find(g => g.oddsApiEventId)
          
          // Check times - determine which is better
          const existingTime = hasOdds ? new Date(hasOdds.date).toLocaleString('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          }) : null
          const newTime = new Date(game.date).toLocaleString('en-US', {
            timeZone: 'America/New_York',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })
          
          // If existing has odds but shows 7pm (12:00 AM), and new one has a different time, prefer new one
          if (hasOdds && existingTime === '12:00 AM' && newTime !== '12:00 AM') {
            // Keep the new game (better time), delete the old one and move odds
            console.log(`  🔄 Replacing ${hasOdds.id} (${existingTime}) with ${game.id} (${newTime}) - better time`)
            gamesToDelete.push(hasOdds.id)
            // Store mapping info to move odds later (store separately, not on game object)
            oddsToMove.push({
              fromGameId: hasOdds.id,
              toGameId: game.id,
              oddsEventId: hasOdds.oddsApiEventId
            })
          } else if (hasOdds) {
            // Existing has odds and better or same time, skip this one
            // BUT: Update the existing game's date/time if the new one is more recent
            const existingDate = new Date(hasOdds.date)
            const newDate = new Date(game.date)
            
            // If dates are the same but times differ, or if new date is more recent, update existing
            if (newDate.getTime() !== existingDate.getTime()) {
              console.log(`  🔄 Updating ${hasOdds.id} with new time from ${game.id}`)
              await supabase
                .from('Game')
                .update({ date: game.date.toISOString() })
                .eq('id', hasOdds.id)
            }
            
            console.log(`  ⚠️  Skipping ${game.id} - duplicate ESPN ID ${game.espnGameId} exists with odds (${hasOdds.id})`)
            gamesToRemove.push(game.id)
            continue
          } else {
            // No odds on existing, delete old duplicate(s) - we'll use the new one
            existing.forEach(g => {
              if (!gamesToDelete.includes(g.id)) {
                gamesToDelete.push(g.id)
              }
            })
          }
        }
      }
      
      // Check 2: Duplicate by matchup (homeId + awayId + date) - catch duplicates with different ESPN IDs
      const gameDateStr = new Date(game.date).toISOString().split('T')[0]
      const { data: matchupDuplicates } = await supabase
        .from('Game')
        .select('id, espnGameId, oddsApiEventId, status, date')
        .eq('sport', sport)
        .eq('homeId', game.homeId)
        .eq('awayId', game.awayId)
        .gte('date', gameDateStr + 'T00:00:00Z')
        .lt('date', gameDateStr + 'T23:59:59Z')
        .neq('id', game.id)
      
      if (matchupDuplicates && matchupDuplicates.length > 0) {
        // Prioritize: game with odds > game with final status > newest game
        const withOdds = matchupDuplicates.find(g => g.oddsApiEventId)
        const withFinalStatus = matchupDuplicates.find(g => g.status === 'final')
        const newest = matchupDuplicates.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
        
        const gameToKeep = withOdds || withFinalStatus || newest
        
        // If we should keep the existing game, skip this one
        if (gameToKeep.id !== game.id) {
          console.log(`  ⚠️  Skipping ${game.id} - duplicate matchup exists: ${gameToKeep.id} (has odds: ${!!withOdds}, status: ${gameToKeep.status})`)
          gamesToRemove.push(game.id)
          continue
        } else {
          // We should keep this game, delete the duplicates
          matchupDuplicates.forEach(g => {
            if (g.id !== game.id && !gamesToDelete.includes(g.id)) {
              // If duplicate has odds, move them to this game
              if (g.oddsApiEventId) {
                oddsToMove.push({
                  fromGameId: g.id,
                  toGameId: game.id,
                  oddsEventId: g.oddsApiEventId
                })
              }
              gamesToDelete.push(g.id)
            }
          })
        }
      }
    }
    
    // Create upsert array AFTER duplicate check (filter out removed games)
    const gamesToUpsert = games
      .filter(g => !gamesToRemove.includes(g.id))
      .map(g => ({
        id: g.id,
        sport: g.sport,
        date: g.date, // Already an ISO string from database
        status: g.status,
        homeId: g.homeId,
        awayId: g.awayId,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        espnGameId: g.espnGameId
      }))
    
    if (gamesToRemove.length > 0) {
      console.log(`  🗑️  Removed ${gamesToRemove.length} duplicate games from batch`)
    }
    
    // Batch upsert all games at once (before deleting or moving odds)
    const { data, error: upsertError } = await supabase
      .from('Game')
      .upsert(gamesToUpsert, {
        onConflict: 'id'
      })
      .select()
    
    if (upsertError) {
      throw upsertError
    }
    
    // Move odds to games with better times (before deleting old games)
    if (oddsToMove.length > 0) {
      console.log(`  🔄 Moving odds for ${oddsToMove.length} games with better times...`)
      for (const move of oddsToMove) {
        // First, update all Odds records to point to the new game
        const { error: oddsUpdateError } = await supabase
          .from('Odds')
          .update({ gameId: move.toGameId })
          .eq('gameId', move.fromGameId)
        
        if (oddsUpdateError) {
          console.warn(`    ⚠️  Error moving odds records: ${oddsUpdateError.message}`)
        }
        
        // Update new game with oddsApiEventId
        await supabase
          .from('Game')
          .update({ oddsApiEventId: move.oddsEventId })
          .eq('id', move.toGameId)
        
        // Clear odds from old game
        await supabase
          .from('Game')
          .update({ oddsApiEventId: null })
          .eq('id', move.fromGameId)
        
        console.log(`    ✅ Moved odds from ${move.fromGameId} to ${move.toGameId}`)
      }
    }
    
    // Delete old duplicates AFTER moving odds (to avoid foreign key constraint)
    if (gamesToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('Game')
        .delete()
        .in('id', gamesToDelete)
      
      if (deleteError) {
        console.warn(`  ⚠️  Error deleting old duplicates: ${deleteError.message}`)
      } else {
        console.log(`  🗑️  Deleted ${gamesToDelete.length} old duplicate games`)
      }
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
