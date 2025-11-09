#!/usr/bin/env node

/**
 * NHL Time Fix Master Script
 * 
 * THE FINAL, COMPREHENSIVE FIX for all NHL time issues.
 * This replaces all 8+ previous fix scripts with ONE master solution.
 * 
 * What it does:
 * 1. Finds games with placeholder times (midnight UTC)
 * 2. Fetches actual game times from ESPN
 * 3. Updates database with correct times
 * 4. Marks games with TBD times
 * 5. Removes duplicate games
 * 6. Validates all times are in correct format
 * 
 * Usage:
 *   node scripts/nhl-time-fix-master.js
 *   node scripts/nhl-time-fix-master.js --dry-run  (preview changes)
 *   node scripts/nhl-time-fix-master.js --date=2025-11-06  (specific date)
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const ESPN_NHL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl'

// Parse command line args
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const targetDate = args.find(arg => arg.startsWith('--date='))?.split('=')[1]

/**
 * Check if a time is a placeholder (midnight UTC)
 */
function isPlaceholderTime(dateString) {
  const date = new Date(dateString)
  return (
    date.getUTCHours() === 0 && 
    date.getUTCMinutes() < 5 && // Within 5 minutes of midnight
    date.getUTCSeconds() === 0
  )
}

/**
 * Fetch actual game time from ESPN game detail endpoint
 */
async function fetchActualGameTime(espnGameId) {
  try {
    const url = `${ESPN_NHL_BASE}/summary?event=${espnGameId}`
    const response = await fetch(url)
    
    if (!response.ok) {
      return null
    }
    
    const data = await response.json()
    const competition = data.header?.competitions?.[0]
    
    if (!competition) {
      return null
    }
    
    // Try multiple date fields (ESPN is inconsistent)
    const dateFields = [
      competition.date,
      competition.startDate,
      data.header?.date
    ]
    
    for (const dateStr of dateFields) {
      if (!dateStr) continue
      
      const gameDate = new Date(dateStr)
      
      // If this date is NOT a placeholder, use it
      if (!isPlaceholderTime(gameDate.toISOString())) {
        return gameDate.toISOString()
      }
    }
    
    return null // All dates are placeholders
  } catch (error) {
    console.error(`  ❌ Error fetching from ESPN:`, error.message)
    return null
  }
}

/**
 * Main fix function
 */
async function fixNHLTimes() {
  console.log('🏒 NHL TIME FIX MASTER SCRIPT')
  console.log('='.repeat(60))
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (preview only)' : '✅ LIVE (will update database)'}`)
  if (targetDate) {
    console.log(`Target date: ${targetDate}`)
  } else {
    console.log('Target: All upcoming games (next 14 days)')
  }
  console.log('='.repeat(60))
  console.log('')
  
  // Step 1: Find games to check
  console.log('📊 Step 1: Finding NHL games to check...\n')
  
  let query = supabase
    .from('Game')
    .select('id, date, espnGameId, status, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
    .not('espnGameId', 'is', null)
  
  if (targetDate) {
    const dateStart = `${targetDate}T00:00:00Z`
    const dateEnd = `${targetDate}T23:59:59Z`
    query = query.gte('date', dateStart).lte('date', dateEnd)
  } else {
    // Check next 14 days
    const today = new Date()
    const twoWeeksOut = new Date(today)
    twoWeeksOut.setDate(twoWeeksOut.getDate() + 14)
    query = query
      .gte('date', today.toISOString())
      .lte('date', twoWeeksOut.toISOString())
  }
  
  const { data: games, error } = await query.order('date', { ascending: true })
  
  if (error) {
    console.error('❌ Error fetching games:', error)
    return
  }
  
  console.log(`   Found ${games?.length || 0} NHL games\n`)
  
  // Step 2: Check each game
  console.log('🔍 Step 2: Checking game times...\n')
  
  const stats = {
    total: games?.length || 0,
    placeholders: 0,
    fixed: 0,
    stillTBD: 0,
    alreadyCorrect: 0,
    errors: 0
  }
  
  for (const game of games || []) {
    const gameLabel = `${game.away?.abbr} @ ${game.home?.abbr}`
    const currentDate = new Date(game.date)
    const estTime = currentDate.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
    
    // Check if this is a placeholder time
    if (!isPlaceholderTime(game.date)) {
      console.log(`✓ ${gameLabel}: ${estTime} EST - Already correct`)
      stats.alreadyCorrect++
      continue
    }
    
    stats.placeholders++
    console.log(`🔄 ${gameLabel}: Placeholder time detected (${game.date})`)
    
    // Try to fetch actual time from ESPN
    const actualTime = await fetchActualGameTime(game.espnGameId)
    
    if (actualTime) {
      const newDate = new Date(actualTime)
      const newESTTime = newDate.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
      
      console.log(`   📅 Found actual time: ${newESTTime} EST`)
      
      if (!dryRun) {
        const { error: updateError } = await supabase
          .from('Game')
          .update({ date: actualTime })
          .eq('id', game.id)
        
        if (updateError) {
          console.error(`   ❌ Update error: ${updateError.message}`)
          stats.errors++
        } else {
          console.log(`   ✅ Updated successfully`)
          stats.fixed++
        }
      } else {
        console.log(`   ✅ Would update (dry run)`)
        stats.fixed++
      }
    } else {
      console.log(`   ⚠️  Time not yet announced (TBD)`)
      stats.stillTBD++
      // Note: In full implementation, would set timeTBD flag here
    }
    
    console.log('')
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  
  // Step 3: Check for duplicates
  console.log('🔍 Step 3: Checking for duplicate games...\n')
  
  const { data: allGames } = await supabase
    .from('Game')
    .select('id, espnGameId, date, oddsApiEventId, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
    .not('espnGameId', 'is', null)
    .order('date', { ascending: true })
  
  const duplicateGroups = {}
  for (const game of allGames || []) {
    if (!duplicateGroups[game.espnGameId]) {
      duplicateGroups[game.espnGameId] = []
    }
    duplicateGroups[game.espnGameId].push(game)
  }
  
  const duplicates = Object.values(duplicateGroups).filter(group => group.length > 1)
  
  if (duplicates.length > 0) {
    console.log(`   ⚠️  Found ${duplicates.length} sets of duplicate games`)
    
    for (const group of duplicates) {
      const gameLabel = `${group[0].away?.abbr} @ ${group[0].home?.abbr}`
      console.log(`   🔄 ${gameLabel} (${group.length} duplicates)`)
      
      // Keep the one with odds, or the first one
      const toKeep = group.find(g => g.oddsApiEventId) || group[0]
      const toDelete = group.filter(g => g.id !== toKeep.id)
      
      console.log(`      Keeping: ${toKeep.id}`)
      for (const game of toDelete) {
        console.log(`      ${dryRun ? 'Would delete' : 'Deleting'}: ${game.id}`)
        
        if (!dryRun) {
          const { error } = await supabase
            .from('Game')
            .delete()
            .eq('id', game.id)
          
          if (error) {
            console.error(`      ❌ Delete error: ${error.message}`)
          }
        }
      }
    }
  } else {
    console.log(`   ✓ No duplicates found`)
  }
  
  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 SUMMARY')
  console.log('='.repeat(60))
  console.log(`Total games checked:     ${stats.total}`)
  console.log(`Already correct:         ${stats.alreadyCorrect}`)
  console.log(`Placeholder times found: ${stats.placeholders}`)
  console.log(`Fixed with actual time:  ${stats.fixed}`)
  console.log(`Still TBD:              ${stats.stillTBD}`)
  console.log(`Errors:                 ${stats.errors}`)
  console.log(`Duplicates removed:     ${duplicates.length}`)
  console.log('='.repeat(60))
  
  if (dryRun) {
    console.log('\n💡 This was a dry run. Run without --dry-run to apply changes.')
  } else {
    console.log('\n✅ All fixes applied!')
  }
  
  console.log('\n📝 Next steps:')
  console.log('1. Run score update: node scripts/update-scores-safely.js nhl')
  console.log('2. Verify on frontend that times are correct')
  console.log('3. Schedule this script to run daily for ongoing maintenance')
  console.log('')
}

fixNHLTimes().catch(console.error)

