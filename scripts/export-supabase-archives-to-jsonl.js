#!/usr/bin/env node

/**
 * One-time export: copy ArchivedPropLine + GameBoxScore from Supabase to local JSONL.
 *
 * Does NOT truncate or delete anything. After you verify the files, truncate
 * those two tables + VACUUM in the Supabase SQL editor (manual step).
 *
 * Usage:
 *   node scripts/export-supabase-archives-to-jsonl.js
 *   node scripts/export-supabase-archives-to-jsonl.js --dry-run
 *
 * Dirs: ARCHIVE_PROP_LINES_DIR / ARCHIVE_BOX_SCORES_DIR, or repo-relative
 *   research/archive/prop-lines and research/archive/box-scores
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import {
  appendJsonl,
  groupRowsByUtcDay,
  resolveBoxScoresDir,
  resolvePropLinesDir,
} from '../lib/local-archive.js'

config({ path: '.env.local' })

const PAGE_SIZE = 1000

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fetchAllRows(table) {
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

function printDayCounts(label, groups) {
  const days = [...groups.keys()].sort()
  console.log(`\n  ${label} by UTC day:`)
  if (days.length === 0) {
    console.log('    (none)')
    return
  }
  for (const day of days) {
    console.log(`    ${day}: ${groups.get(day).length}`)
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const propDir = resolvePropLinesDir()
  const boxDir = resolveBoxScoresDir()

  console.log('\n📤 EXPORT SUPABASE ARCHIVES → LOCAL JSONL')
  console.log('='.repeat(70))
  console.log(`Mode:      ${dryRun ? '🔍 DRY RUN (count only, no writes)' : '✅ WRITE JSONL (no truncate)'}`)
  console.log(`Prop dir:  ${propDir}`)
  console.log(`Box dir:   ${boxDir}`)
  console.log('This script never TRUNCATEs or DELETEs Supabase rows.')
  console.log('='.repeat(70))

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('\n❌ Missing NEXT_PUBLIC_SUPABASE_URL (check .env.local)')
    process.exit(1)
  }

  console.log('\n📥 Reading ArchivedPropLine...')
  const propRows = await fetchAllRows('ArchivedPropLine')
  const propGroups = groupRowsByUtcDay(propRows, ['archived_at', 'game_time'])
  console.log(`   ${propRows.length} rows`)
  printDayCounts('ArchivedPropLine', propGroups)

  console.log('\n📥 Reading GameBoxScore...')
  const boxRows = await fetchAllRows('GameBoxScore')
  const boxGroups = groupRowsByUtcDay(boxRows, ['fetched_at'])
  console.log(`   ${boxRows.length} rows`)
  printDayCounts('GameBoxScore', boxGroups)

  if (dryRun) {
    console.log('\n💡 Dry run — nothing written. Re-run without --dry-run to export.')
  } else {
    let propsWritten = 0
    for (const [day, rows] of propGroups) {
      propsWritten += appendJsonl(propDir, 'prop-lines', rows, day)
    }
    let boxesWritten = 0
    for (const [day, rows] of boxGroups) {
      boxesWritten += appendJsonl(boxDir, 'box-scores', rows, day)
    }
    console.log(`\n✅ Wrote ${propsWritten} prop lines → ${propDir}`)
    console.log(`✅ Wrote ${boxesWritten} box scores → ${boxDir}`)
    console.log('   Files are named prop-lines-YYYY-MM-DD.jsonl / box-scores-YYYY-MM-DD.jsonl (UTC day).')
    console.log('   Re-running this script appends again — verify files before a second pass.')
  }

  console.log('\n' + '='.repeat(70))
  console.log('NEXT STEP (manual — this script does NOT truncate)')
  console.log('='.repeat(70))
  console.log('After you open a few JSONL files and confirm the row counts match:')
  console.log('  1. In the Supabase SQL editor, run:')
  console.log('       TRUNCATE TABLE "ArchivedPropLine";')
  console.log('       TRUNCATE TABLE "GameBoxScore";')
  console.log('       VACUUM "ArchivedPropLine";')
  console.log('       VACUUM "GameBoxScore";')
  console.log('  2. Do not truncate ClosingOdds, PlayerPropCache, Game, or PropValidation.')
  console.log('  3. See research/archive/README.md for layout and env overrides.\n')
}

main().catch((err) => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})
