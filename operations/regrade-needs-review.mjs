#!/usr/bin/env node
/**
 * Regrade PropValidation rows that are still needs_review after the
 * name-matching / DNP / NFL-zero grading changes.
 *
 * Dry-run by default. Required filters: --sport and --source
 * system_generated, plus --ids or a --from/--to date range.
 *
 * Writes a plan CSV to operations/backups/. --apply --confirm <plan-hash>
 * writes only after a full-row JSONL backup and a row-count re-check.
 * Refuses :05–:15 ET at start and before every batch of 25.
 * Updates with .eq('id').eq('status','needs_review').
 *
 * supabaseAdmin imports server-only. Run with:
 *   node --conditions=react-server operations/regrade-needs-review.mjs ...
 *
 * Rollback from the backup:
 *   Each line of operations/backups/regrade-needs-review-*-rows.jsonl is
 *   a full PropValidation row. Restore by updating that id with the
 *   backed-up status, result, actualValue, notes, completedAt, and
 *   audit fields. Do not apply a newer plan afterward without a new
 *   dry-run.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { supabaseAdmin } from '../lib/supabase-admin.js'
import { fetchParsedMlbBoxscore } from '../lib/vendors/mlb-game-stats.js'
import { getPlayerGameStat as lookupNflStat } from '../lib/vendors/nfl-game-stats.js'
import { lookupPlayerGameStat as lookupNhlStat } from '../lib/vendors/nhl-game-stats.js'
import { lookupMlbPlayerStat } from '../lib/mlb-stat-grade.js'
import { REGRADE_USAGE, runRegradeNeedsReview } from '../lib/regrade-needs-review.js'

config({ path: '.env.local' })

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

export async function main(argv = process.argv.slice(2)) {
  return runRegradeNeedsReview({
    argv,
    createClient: () => supabaseAdmin,
    lookupMlb: lookupMlbPlayerStat,
    lookupNhl: lookupNhlStat,
    lookupNfl: lookupNflStat,
    fetchMlbBoxscore: fetchParsedMlbBoxscore,
    writeFile: writeFileSync,
    mkdir: mkdirSync,
    log: console,
  })
}

if (invokedDirectly()) {
  main().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}

export { REGRADE_USAGE }
