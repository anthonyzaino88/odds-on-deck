#!/usr/bin/env node

/**
 * CLEAR STALE PROPS
 * 
 * Removes old, expired, or stale props from the database
 * This helps keep the database clean and queries fast
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
  
  console.log('\n🗑️  CLEAR STALE PROPS')
  console.log('='.repeat(80))
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (preview only)' : '✅ LIVE (will delete)'}`)
  console.log('='.repeat(80))
  
  const now = new Date()
  
  // Find stale/expired props
  const { data: staleProps, error: queryError } = await supabase
    .from('PlayerPropCache')
    .select('id, sport, playerName, type, expiresAt, isStale')
  
  if (queryError) {
    console.error('❌ Error querying props:', queryError)
    process.exit(1)
  }
  
  // Filter to stale/expired
  const toDelete = staleProps.filter(p => 
    p.isStale || new Date(p.expiresAt) <= now
  )
  
  console.log(`\n📊 Found ${toDelete.length} stale/expired props to clean up`)
  
  if (toDelete.length === 0) {
    console.log('✅ Database is already clean!')
    process.exit(0)
  }
  
  // Group by sport
  const bySport = {}
  toDelete.forEach(p => {
    bySport[p.sport] = (bySport[p.sport] || 0) + 1
  })
  
  console.log('\nBreakdown by sport:')
  Object.entries(bySport).forEach(([sport, count]) => {
    console.log(`  ${sport.toUpperCase()}: ${count} stale props`)
  })
  
  if (dryRun) {
    console.log('\n💡 This is a dry run. Run without --dry-run to delete.')
  } else {
    console.log('\n🗑️  Deleting stale props...')
    
    const idsToDelete = toDelete.map(p => p.id)
    
    const { error: deleteError } = await supabase
      .from('PlayerPropCache')
      .delete()
      .in('id', idsToDelete)
    
    if (deleteError) {
      console.error('❌ Error deleting props:', deleteError)
      process.exit(1)
    }
    
    console.log(`✅ Deleted ${toDelete.length} stale props`)
  }
  
  console.log('\n' + '='.repeat(80))
  console.log(`${dryRun ? '💡 Dry run complete' : '✅ Cleanup complete'}`)
  console.log('='.repeat(80))
  console.log('\n📝 Next steps:')
  console.log('  1. Wait for bookmakers to post props (12-24 hours)')
  console.log('  2. Run: node scripts/fetch-live-odds.js all --cache-fresh')
  console.log('  3. Check: http://localhost:3000/props\n')
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

