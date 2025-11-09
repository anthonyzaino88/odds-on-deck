#!/usr/bin/env node

/**
 * CLEAR NHL EVENT IDS
 * 
 * Problem: NHL games have old/expired oddsApiEventId values that return 404 errors
 * Solution: Clear these IDs so fetch-live-odds.js can map to fresh events
 * 
 * Usage:
 *   node scripts/clear-nhl-event-ids.js           # Clear all NHL event IDs
 *   node scripts/clear-nhl-event-ids.js --dry-run # Preview what would be cleared
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  
  console.log('\n🏒 CLEAR NHL EVENT IDS')
  console.log('='.repeat(80))
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (preview only)' : '✅ LIVE (will update database)'}`)
  console.log('='.repeat(80))
  
  // Step 1: Find NHL games with event IDs
  console.log('\n📊 Step 1: Finding NHL games with event IDs...\n')
  
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, oddsApiEventId, homeId, awayId, date, status')
    .eq('sport', 'nhl')
    .not('oddsApiEventId', 'is', null)
  
  if (error) {
    console.error('❌ Error querying games:', error)
    process.exit(1)
  }
  
  if (!games || games.length === 0) {
    console.log('✅ No NHL games have event IDs set (already clear)')
    process.exit(0)
  }
  
  console.log(`Found ${games.length} NHL games with event IDs:\n`)
  
  // Group by status
  const scheduled = games.filter(g => g.status === 'scheduled')
  const inProgress = games.filter(g => g.status === 'in_progress' || g.status === 'in-progress')
  const final = games.filter(g => g.status === 'final')
  const other = games.filter(g => !['scheduled', 'in_progress', 'in-progress', 'final'].includes(g.status))
  
  console.log(`  Scheduled: ${scheduled.length}`)
  console.log(`  In Progress: ${inProgress.length}`)
  console.log(`  Final: ${final.length}`)
  console.log(`  Other: ${other.length}`)
  
  // Display some examples
  console.log(`\nExample games:`)
  games.slice(0, 5).forEach(g => {
    const gameDate = new Date(g.date)
    const estDate = gameDate.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      month: '2-digit',
      day: '2-digit'
    })
    console.log(`  ${g.id} - Event ID: ${g.oddsApiEventId} - Status: ${g.status} - Date: ${estDate}`)
  })
  
  if (games.length > 5) {
    console.log(`  ... and ${games.length - 5} more`)
  }
  
  // Step 2: Clear event IDs
  if (dryRun) {
    console.log(`\n💡 DRY RUN: Would clear oddsApiEventId for ${games.length} games`)
    console.log(`\nTo apply changes, run without --dry-run`)
  } else {
    console.log(`\n🔄 Step 2: Clearing event IDs...\n`)
    
    const { data, error: updateError } = await supabase
      .from('Game')
      .update({ oddsApiEventId: null })
      .eq('sport', 'nhl')
      .not('oddsApiEventId', 'is', null)
      .select()
    
    if (updateError) {
      console.error('❌ Error updating games:', updateError)
      process.exit(1)
    }
    
    const updated = data ? data.length : 0
    console.log(`✅ Cleared oddsApiEventId for ${updated} games`)
  }
  
  // Summary
  console.log('\n\n' + '='.repeat(80))
  console.log('📊 SUMMARY')
  console.log('='.repeat(80))
  console.log(`\nNHL games with event IDs: ${games.length}`)
  console.log(`${dryRun ? 'Would clear' : 'Cleared'}: ${games.length}`)
  
  if (!dryRun) {
    console.log('\n📝 NEXT STEPS:')
    console.log('1. Run: node scripts/fetch-live-odds.js nhl')
    console.log('   This will map NHL games to current Odds API events')
    console.log('2. Verify mappings succeeded (should see "Mapped X new games")')
    console.log('3. Check props on frontend: http://localhost:3000/props')
  }
  
  console.log('\n' + '='.repeat(80))
  console.log(dryRun ? '💡 This was a dry run. Run without --dry-run to apply changes.\n' : '✅ Done!\n')
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

