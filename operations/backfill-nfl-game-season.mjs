#!/usr/bin/env node
/**
 * Backfill null/empty NFL Game.season from kickoff date (Jan–Feb → prior
 * year). Dry-run by default. --apply writes a JSON backup to
 * .local/backups first, then UPDATE. Refused :05–:15 ET.
 *
 * Does not change eligibility gates. Does not call The Odds API.
 *
 * Usage:
 *   node operations/backfill-nfl-game-season.mjs
 *   node operations/backfill-nfl-game-season.mjs --apply
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import {
  NFL_SEASON_BACKFILL_USAGE,
  runBackfillNflGameSeason,
} from '../lib/nfl-season.js'

config({ path: '.env.local' })

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const supabase = deps.supabase || createScriptSupabaseClient(deps.env)
  return runBackfillNflGameSeason({
    argv,
    supabase,
    now: deps.now,
    log: deps.log || console,
    writeFile: deps.writeFile || writeFileSync,
    mkdir: deps.mkdir || mkdirSync,
    cwd: deps.cwd || process.cwd(),
  })
}

if (invokedDirectly()) {
  main().then((result) => {
    process.exit(result.exitCode ?? 0)
  }).catch((error) => {
    console.error('❌ backfill-nfl-game-season failed:', error)
    process.exit(1)
  })
}

export { NFL_SEASON_BACKFILL_USAGE }
