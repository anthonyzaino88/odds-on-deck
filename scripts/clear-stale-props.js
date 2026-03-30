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

// Use secret key for write operations (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  
  console.log('\n🗑️  CLEAR STALE PROPS')
  console.log('='.repeat(80))
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (preview only)' : '✅ LIVE (will delete)'}`)
  console.log('='.repeat(80))
  
  const now = new Date()
  const nowIso = now.toISOString()
  
  // Count what we're about to delete using server-side filters
  const { count: expiredCount } = await supabase
    .from('PlayerPropCache')
    .select('*', { count: 'exact', head: true })
    .lt('expiresAt', nowIso)

  const { count: staleCount } = await supabase
    .from('PlayerPropCache')
    .select('*', { count: 'exact', head: true })
    .eq('isStale', true)

  const { count: pastGameCount } = await supabase
    .from('PlayerPropCache')
    .select('*', { count: 'exact', head: true })
    .lt('gameTime', nowIso)

  const { count: totalCount } = await supabase
    .from('PlayerPropCache')
    .select('*', { count: 'exact', head: true })

  console.log(`\n📊 Props in database: ${totalCount}`)
  console.log(`   Expired (expiresAt < now): ${expiredCount}`)
  console.log(`   Stale (isStale = true): ${staleCount}`)
  console.log(`   Past game time: ${pastGameCount}`)

  if (expiredCount === 0 && staleCount === 0 && pastGameCount === 0) {
    console.log('✅ Database is already clean!')
    process.exit(0)
  }

  if (dryRun) {
    console.log('\n💡 This is a dry run. Run without --dry-run to delete.')
    process.exit(0)
  }

  console.log('\n🗑️  Deleting stale props using server-side filters...')
  let totalDeleted = 0

  // Delete expired props in batches (server-side filter, no 1000-row limit issue)
  const { error: err1, count: del1 } = await supabase
    .from('PlayerPropCache')
    .delete({ count: 'exact' })
    .lt('expiresAt', nowIso)
  if (err1) console.error('❌ Error deleting expired:', err1.message)
  else { totalDeleted += (del1 || 0); console.log(`  ✅ Deleted ${del1 || 0} expired props`) }

  // Delete stale props
  const { error: err2, count: del2 } = await supabase
    .from('PlayerPropCache')
    .delete({ count: 'exact' })
    .eq('isStale', true)
  if (err2) console.error('❌ Error deleting stale:', err2.message)
  else { totalDeleted += (del2 || 0); console.log(`  ✅ Deleted ${del2 || 0} stale props`) }

  // Delete props with past game time
  const { error: err3, count: del3 } = await supabase
    .from('PlayerPropCache')
    .delete({ count: 'exact' })
    .lt('gameTime', nowIso)
  if (err3) console.error('❌ Error deleting past game props:', err3.message)
  else { totalDeleted += (del3 || 0); console.log(`  ✅ Deleted ${del3 || 0} past-game props`) }

  // Verify
  const { count: remaining } = await supabase
    .from('PlayerPropCache')
    .select('*', { count: 'exact', head: true })

  console.log(`\n📊 Total deleted: ${totalDeleted}`)
  console.log(`📊 Remaining props: ${remaining}`)

  console.log('\n' + '='.repeat(80))
  console.log('✅ Cleanup complete')
  console.log('='.repeat(80))
  console.log('\n📝 Next steps:')
  console.log('  1. node scripts/fetch-fresh-games.js all')
  console.log('  2. node scripts/fetch-live-odds.js all --cache-fresh')
  console.log('  3. node scripts/update-scores-safely.js all\n')
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

