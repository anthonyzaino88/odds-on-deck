#!/usr/bin/env node

/**
 * CLEAR STALE PROPS
 *
 * Archives matching PlayerPropCache rows to local JSONL, then deletes only
 * the exact versions that were verified on disk. Archive read/write failure
 * aborts deletion.
 *
 *   node scripts/clear-stale-props.js --dry-run
 *   node scripts/clear-stale-props.js
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolvePropLinesDir } from '../lib/local-archive.js'
import {
  createSupabaseExactDeleter,
  createSupabaseRangeFetcher,
  refetchPlayerPropCacheByIds,
  runPropCacheCleanup,
} from '../lib/prop-cache-cleanup.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  console.log('\n🗑️  CLEAR STALE PROPS')
  console.log('='.repeat(80))
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN (preview only)' : '✅ LIVE (archive, then delete verified rows)'}`)
  console.log(`Archive dir: ${resolvePropLinesDir()}`)
  console.log('='.repeat(80))

  const now = new Date()
  const nowIso = now.toISOString()

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
    const fetchPage = createSupabaseRangeFetcher(supabase)
    const result = await runPropCacheCleanup({
      fetchPage,
      nowIso,
      dryRun: true,
      archiveDir: resolvePropLinesDir(),
      archivedAt: nowIso,
    })
    console.log(`\n💡 Would archive ${result.candidates} unique rows (overlapping filters deduped).`)
    console.log('💡 This is a dry run. Run without --dry-run to archive + delete verified rows.')
    process.exit(0)
  }

  const fetchPage = createSupabaseRangeFetcher(supabase)
  const deleteExact = createSupabaseExactDeleter(supabase)

  console.log('\n📦 Archiving props before deletion (verified write)...')
  const result = await runPropCacheCleanup({
    fetchPage,
    refetchByIds: (ids) => refetchPlayerPropCacheByIds(supabase, ids),
    deleteExact,
    nowIso,
    archiveDir: resolvePropLinesDir(),
    archivedAt: nowIso,
    dryRun: false,
  })

  if (result.abort) {
    console.error('\n❌ Archive read/write failed — deletion aborted.')
    if (result.error) console.error(`   ${result.error.message || result.error}`)
    console.error('   PlayerPropCache was not modified.')
    process.exit(1)
  }

  console.log(`  ✅ Archived ${result.archived} unique prop lines → ${resolvePropLinesDir()}`)
  console.log(`  ✅ Deleted ${result.deleted} verified cache rows`)
  if (result.skippedConcurrent) {
    console.log(`  ⏭️  Skipped ${result.skippedConcurrent} rows that changed between capture and delete`)
  }

  const { count: remaining } = await supabase
    .from('PlayerPropCache')
    .select('*', { count: 'exact', head: true })

  console.log(`\n📊 Remaining props: ${remaining}`)
  console.log('\n' + '='.repeat(80))
  console.log('✅ Cleanup complete')
  console.log('='.repeat(80))
  console.log('\n📝 Next steps:')
  console.log('  1. node scripts/fetch-fresh-games.js all')
  console.log('  2. node scripts/fetch-live-odds.js all --cache-fresh')
  console.log('  3. node scripts/update-scores-safely.js all\n')
}

main().catch((error) => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
