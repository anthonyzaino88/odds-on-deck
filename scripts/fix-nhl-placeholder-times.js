#!/usr/bin/env node

/**
 * FIX NHL PLACEHOLDER TIMES
 * 
 * This script:
 * 1. Finds games with placeholder times (5 AM UTC = 12:00 AM EST)
 * 2. Queries ESPN's game detail endpoint for actual times
 * 3. Updates the database with correct times
 * 4. If ESPN still has placeholder, marks game as scheduled with TBD time
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const ESPN_NHL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl'

async function fetchGameDetail(espnGameId) {
  try {
    const url = `${ESPN_NHL_BASE}/summary?event=${espnGameId}`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!response.ok) {
      throw new Error(`ESPN API error: ${response.status}`)
    }
    
    const data = await response.json()
    const header = data.header
    const competition = header?.competitions?.[0]
    
    if (!competition) return null
    
    // Try to get the best available time
    const eventDate = header.date ? new Date(header.date) : null
    const compDate = competition.date ? new Date(competition.date) : null
    const compStartDate = competition.startDate ? new Date(competition.startDate) : null
    
    // Check which times are midnight UTC (placeholder)
    const isEventMidnight = eventDate ? (eventDate.getUTCHours() === 0 && 
                                         eventDate.getUTCMinutes() === 0 && 
                                         eventDate.getUTCSeconds() === 0) : true
    const isCompMidnight = compDate ? (compDate.getUTCHours() === 0 && 
                                       compDate.getUTCMinutes() === 0 && 
                                       compDate.getUTCSeconds() === 0) : true
    const isStartMidnight = compStartDate ? (compStartDate.getUTCHours() === 0 && 
                                             compStartDate.getUTCMinutes() === 0 && 
                                             compStartDate.getUTCSeconds() === 0) : true
    
    // Prefer competition.startDate, then competition.date, then event.date
    // But only if they're NOT midnight UTC (placeholder)
    let bestTime = null
    let isPlaceholder = true
    
    if (compStartDate && !isStartMidnight) {
      bestTime = compStartDate
      isPlaceholder = false
    } else if (compDate && !isCompMidnight) {
      bestTime = compDate
      isPlaceholder = false
    } else if (eventDate && !isEventMidnight) {
      bestTime = eventDate
      isPlaceholder = false
    } else {
      // All times are midnight UTC - ESPN hasn't announced the time yet
      // Use midnight UTC but mark as placeholder
      bestTime = eventDate || compDate || compStartDate
      isPlaceholder = true
    }
    
    return {
      espnGameId,
      date: bestTime ? bestTime.toISOString() : null,
      isPlaceholder,
      status: competition.status?.type?.name || 'STATUS_SCHEDULED'
    }
  } catch (error) {
    console.error(`Error fetching detail for ${espnGameId}:`, error.message)
    return null
  }
}

async function main() {
  console.log('\n🔧 FIX NHL PLACEHOLDER TIMES')
  console.log('='.repeat(80))
  
  // Step 1: Find games with placeholder times
  console.log('\n📋 Step 1: Finding games with placeholder times...')
  
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, espnGameId, date, status, homeId, awayId')
    .eq('sport', 'nhl')
    .order('date', { ascending: true })
  
  if (error) {
    console.error('❌ Database error:', error)
    process.exit(1)
  }
  
  // Filter for placeholder times (5 AM UTC = 12:00 AM EST, or close to midnight)
  const placeholderGames = games.filter(game => {
    const dateStr = game.date || ''
    const gameDate = new Date(dateStr.includes('Z') ? dateStr : dateStr + 'Z')
    
    // Check if time is 5 AM UTC (12:00 AM EST) - this is our placeholder
    // OR if it's midnight UTC (7:00 PM EST previous day) - could also be placeholder
    const hour = gameDate.getUTCHours()
    const minute = gameDate.getUTCMinutes()
    
    return (hour === 5 && minute === 0) || (hour === 0 && minute === 0)
  })
  
  console.log(`\nFound ${placeholderGames.length} games with potential placeholder times:`)
  placeholderGames.forEach(g => {
    const dateStr = g.date || ''
    const gameDate = new Date(dateStr.includes('Z') ? dateStr : dateStr + 'Z')
    const estTime = gameDate.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
    console.log(`  - ${g.id} (${g.espnGameId}) - ${estTime} EST`)
  })
  
  if (placeholderGames.length === 0) {
    console.log('\n✅ No placeholder times found! All games have actual times.')
    process.exit(0)
  }
  
  // Step 2: Fetch actual times from ESPN detail endpoint
  console.log('\n📡 Step 2: Fetching actual times from ESPN...')
  
  const updates = []
  let fixed = 0
  let stillPlaceholder = 0
  let errors = 0
  
  for (const game of placeholderGames) {
    if (!game.espnGameId) {
      console.log(`  ⚠️  ${game.id}: No ESPN ID, skipping`)
      errors++
      continue
    }
    
    console.log(`\n  🔍 ${game.id} (ESPN: ${game.espnGameId})`)
    
    const detail = await fetchGameDetail(game.espnGameId)
    
    if (!detail || !detail.date) {
      console.log(`    ❌ Could not fetch detail`)
      errors++
      await new Promise(r => setTimeout(r, 300)) // Rate limit
      continue
    }
    
    if (detail.isPlaceholder) {
      console.log(`    ⚠️  ESPN still has placeholder time (midnight UTC)`)
      console.log(`    Time: ${detail.date}`)
      stillPlaceholder++
      
      // Update to midnight UTC (7 PM EST previous day) if currently at 5 AM UTC
      const currentDateStr = game.date || ''
      const currentDate = new Date(currentDateStr.includes('Z') ? currentDateStr : currentDateStr + 'Z')
      if (currentDate.getUTCHours() === 5) {
        // Convert from 5 AM UTC (our placeholder) to midnight UTC (ESPN's placeholder)
        updates.push({
          id: game.id,
          newDate: detail.date,
          reason: 'Updated to ESPN placeholder (midnight UTC)'
        })
        console.log(`    🔄 Will update to ESPN's midnight UTC placeholder`)
      } else {
        console.log(`    ✓ Already has ESPN's placeholder, no update needed`)
      }
    } else {
      console.log(`    ✅ Found actual time: ${detail.date}`)
      const estTime = new Date(detail.date).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
      console.log(`    EST: ${estTime}`)
      
      updates.push({
        id: game.id,
        newDate: detail.date,
        reason: 'Updated with actual time from ESPN'
      })
      
      fixed++
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 300))
  }
  
  // Step 3: Apply updates
  console.log('\n\n💾 Step 3: Applying updates...')
  console.log('='.repeat(80))
  
  if (updates.length === 0) {
    console.log('\n⚠️  No updates to apply.')
  } else {
    console.log(`\nUpdating ${updates.length} games:`)
    
    for (const update of updates) {
      console.log(`\n  🔄 ${update.id}`)
      console.log(`    Reason: ${update.reason}`)
      console.log(`    New time: ${update.newDate}`)
      
      const { error: updateError } = await supabase
        .from('Game')
        .update({ date: update.newDate })
        .eq('id', update.id)
      
      if (updateError) {
        console.log(`    ❌ Error: ${updateError.message}`)
        errors++
      } else {
        console.log(`    ✅ Updated successfully`)
      }
    }
  }
  
  // Summary
  console.log('\n\n📊 SUMMARY')
  console.log('='.repeat(80))
  console.log(`\nTotal games checked: ${placeholderGames.length}`)
  console.log(`✅ Fixed with actual times: ${fixed}`)
  console.log(`⚠️  Still placeholder (ESPN not announced): ${stillPlaceholder}`)
  console.log(`❌ Errors: ${errors}`)
  console.log(`💾 Database updates applied: ${updates.length}`)
  
  if (fixed > 0) {
    console.log(`\n✅ Successfully updated ${fixed} games with actual times!`)
  }
  
  if (stillPlaceholder > 0) {
    console.log(`\n⚠️  ${stillPlaceholder} games still have placeholder times (ESPN hasn't announced actual times yet)`)
    console.log(`   These will show as "12:00 AM" or "7:00 PM" until ESPN updates them`)
    console.log(`   Run this script again later to check for updates`)
  }
  
  console.log('\n📋 NEXT STEPS:')
  console.log('1. Clear browser cache (Ctrl+Shift+Delete)')
  console.log('2. Restart dev server')
  console.log('3. Check http://localhost:3000/games')
  console.log('4. If times still wrong, the API may be adding Z markers incorrectly')
  
  console.log('\n' + '='.repeat(80))
  console.log('✅ Done!\n')
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

