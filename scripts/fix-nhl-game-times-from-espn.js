#!/usr/bin/env node

/**
 * Fix NHL Game Times from ESPN
 * 
 * Finds NHL games with midnight UTC (00:00:00) times and fetches
 * the actual game time from ESPN, then updates the database.
 * 
 * Usage:
 *   node scripts/fix-nhl-game-times-from-espn.js
 *   node scripts/fix-nhl-game-times-from-espn.js 2025-11-06  (for specific date)
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const ESPN_NHL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl'

/**
 * Fetch game detail from ESPN to get actual game time
 */
async function fetchGameTimeFromESPN(espnGameId) {
  try {
    const url = `${ESPN_NHL_BASE}/summary?event=${espnGameId}`
    const response = await fetch(url)
    
    if (!response.ok) {
      console.error(`  ❌ ESPN API error: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    const competition = data.header?.competitions?.[0]
    
    if (!competition) {
      return null
    }
    
    // Get the actual game date/time
    const dateStr = competition.date
    if (!dateStr) {
      return null
    }
    
    const gameDate = new Date(dateStr)
    
    // Check if it's still midnight UTC (meaning ESPN doesn't have real time yet)
    // Also check competition.startDate which sometimes has the actual time
    const isMidnightUTC = gameDate.getUTCHours() === 0 && 
                         gameDate.getUTCMinutes() === 0
    
    if (isMidnightUTC) {
      // Try competition.startDate which sometimes has the actual game time
      if (competition.startDate) {
        const startDate = new Date(competition.startDate)
        const startIsMidnight = startDate.getUTCHours() === 0 && startDate.getUTCMinutes() === 0
        if (!startIsMidnight) {
          return startDate // Use startDate if it has a real time
        }
      }
      return null // ESPN doesn't have real time yet
    }
    
    return gameDate
  } catch (error) {
    console.error(`  ❌ Error fetching from ESPN:`, error.message)
    return null
  }
}

async function fixGameTimes(targetDate = null) {
  console.log('🔧 Fixing NHL game times from ESPN...\n')
  
  // Build query to find games with midnight UTC times
  let query = supabase
    .from('Game')
    .select('id, date, espnGameId, status, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
    .not('espnGameId', 'is', null)
  
  // If target date provided, filter to that date range
  if (targetDate) {
    const dateStart = `${targetDate}T00:00:00Z`
    const dateEnd = `${targetDate}T23:59:59Z`
    query = query.gte('date', dateStart).lte('date', dateEnd)
    console.log(`📅 Fixing games for date: ${targetDate}\n`)
  } else {
    // Default: check last 7 days and next 7 days
    const today = new Date()
    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 7)
    const weekAhead = new Date(today)
    weekAhead.setDate(weekAhead.getDate() + 7)
    
    query = query
      .gte('date', weekAgo.toISOString())
      .lte('date', weekAhead.toISOString())
    
    console.log(`📅 Checking games from ${weekAgo.toISOString().split('T')[0]} to ${weekAhead.toISOString().split('T')[0]}\n`)
  }
  
  const { data: games, error } = await query.order('date', { ascending: true })
  
  if (error) {
    console.error('❌ Error fetching games:', error)
    return
  }
  
  console.log(`📊 Found ${games?.length || 0} NHL games to check\n`)
  
  let checked = 0
  let updated = 0
  let skipped = 0
  let errors = 0
  
  for (const game of games || []) {
    try {
      const currentDate = new Date(game.date)
      
      // Check if the time is midnight UTC (00:00:00) or very close to it (within 5 minutes)
      // This catches games that might have been set to 00:00:00, 00:01:00, etc. as placeholders
      const isMidnightUTC = currentDate.getUTCHours() === 0 && 
                           currentDate.getUTCMinutes() < 5
      
      if (!isMidnightUTC) {
        // Game already has a proper time
        skipped++
        continue
      }
      
      checked++
      console.log(`🔄 Checking ${game.away?.abbr} @ ${game.home?.abbr} (${game.espnGameId})...`)
      console.log(`   Current: ${currentDate.toISOString()} (midnight UTC)`)
      
      // Fetch actual game time from ESPN
      const actualGameDate = await fetchGameTimeFromESPN(game.espnGameId)
      
      if (!actualGameDate) {
        console.log(`   ⚠️  ESPN doesn't have actual game time yet (still placeholder)`)
        skipped++
        continue
      }
      
      // Check if the time is different
      if (actualGameDate.getTime() === currentDate.getTime()) {
        console.log(`   ✓ Time matches (still midnight UTC in ESPN)`)
        skipped++
        continue
      }
      
      // Update with actual game time
      const estDisplay = actualGameDate.toLocaleString('en-US', { 
        timeZone: 'America/New_York', 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric', 
        hour: 'numeric', 
        minute: '2-digit' 
      })
      
      console.log(`   📅 Actual time: ${actualGameDate.toISOString()}`)
      console.log(`   📅 EST: ${estDisplay}`)
      
      const { error: updateError } = await supabase
        .from('Game')
        .update({ date: actualGameDate.toISOString() })
        .eq('id', game.id)
      
      if (updateError) {
        console.error(`   ❌ Update error: ${updateError.message}`)
        errors++
      } else {
        updated++
        console.log(`   ✅ Updated game time`)
      }
      
      console.log('')
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500))
      
    } catch (error) {
      console.error(`  ❌ Error processing game ${game.id}:`, error.message)
      errors++
    }
  }
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`✅ Fix complete!`)
  console.log(`  🔍 Checked: ${checked} games with midnight UTC times`)
  console.log(`  ✅ Updated: ${updated} games`)
  console.log(`  ⏭️  Skipped: ${skipped} games (already correct or no time available)`)
  console.log(`  ❌ Errors: ${errors}`)
  console.log(`${'='.repeat(60)}\n`)
}

// Get target date from command line if provided
const targetDate = process.argv[2] || null

fixGameTimes(targetDate).catch(console.error)

