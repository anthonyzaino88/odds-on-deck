#!/usr/bin/env node
// Daily ESPN team-performance refresh. Safe to run before calculate-game-edges.
// Uses the secret-key script client. Per-sport API failures do not abort others.
// Never overwrites stored Team stats with 0 or null from a failed/empty fetch.
//
//   node scripts/fetch-team-performance-data.js            # write pass (default)
//   node scripts/fetch-team-performance-data.js --help
//
// Parse argv before creating a Supabase client. --help/-h prints usage
// and exits 0 with no writes. Unknown flags and positionals exit 2.

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { config } from 'dotenv'
import { ensurePrismaClient } from '../lib/prisma-preflight.js'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { runFetchTeamPerformanceData } from '../lib/team-performance-fetch.js'

config({ path: '.env.local' })

const KNOWN_FLAGS = new Set(['--help', '-h'])

export const FETCH_TEAM_PERFORMANCE_USAGE = `Usage: node scripts/fetch-team-performance-data.js [--help]

Daily ESPN team-performance refresh. Writes present, usable Team fields.
Requires SUPABASE_SECRET_KEY. Does not call The Odds API.

--help, -h    Print usage and exit. No DB writes.
Unknown flags and positionals fail closed (exit 2).`

export function formatFetchTeamPerformanceModeBanner() {
  return 'MODE: APPLY'
}

export function parseFetchTeamPerformanceArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : []
  const unknown = []
  for (const raw of args) {
    const arg = String(raw)
    if (KNOWN_FLAGS.has(arg)) continue
    unknown.push(arg)
  }
  return {
    help: args.includes('--help') || args.includes('-h'),
    unknown,
  }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

/**
 * CLI entry. Parses argv before any client or write. Inject runFetch /
 * createClient in tests so --help and unknown flags cannot touch DB.
 */
export async function runFetchTeamPerformanceCli({
  argv = process.argv.slice(2),
  runFetch = runFetchTeamPerformanceData,
  createClient = createScriptSupabaseClient,
  preflightPrisma,
  log = console,
} = {}) {
  const args = parseFetchTeamPerformanceArgs(argv)
  if (args.help) {
    log.log(FETCH_TEAM_PERFORMANCE_USAGE)
    return { exitCode: 0 }
  }
  if (args.unknown.length) {
    log.error(`❌ Unknown argument(s): ${args.unknown.join(' ')}`)
    return { exitCode: 2, unknown: args.unknown }
  }

  log.log(formatFetchTeamPerformanceModeBanner())
  if (typeof preflightPrisma === 'function') {
    preflightPrisma({ warnOnly: true })
  } else {
    ensurePrismaClient({ warnOnly: true })
  }
  return runFetch({ createClient, logger: log })
}

export { runFetchTeamPerformanceData }

if (invokedDirectly()) {
  runFetchTeamPerformanceCli()
    .then((summary) => {
      if (summary?.exitCode === 0 && summary?.results) {
        console.log('\n✅ Team performance data fetch complete!\n')
      }
      process.exit(summary?.exitCode ?? 0)
    })
    .catch((error) => {
      console.error('❌ Fatal error:', error)
      process.exit(1)
    })
}
