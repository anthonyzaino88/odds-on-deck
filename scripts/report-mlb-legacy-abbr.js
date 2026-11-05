#!/usr/bin/env node
/**
 * Read-only: count MLB Team.abbr and Game.id rows still using OAK/CWS
 * instead of stored ATH/CHW.
 *
 * Does not write. Does not call The Odds API.
 * One-time UPDATE SQL is in docs/mlb-ath-chw-backfill.md — run only
 * with Anthony's OK.
 *
 * Usage:
 *   node scripts/report-mlb-legacy-abbr.js
 *   node scripts/report-mlb-legacy-abbr.js --json
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { summarizeLegacyMlbAbbrRows } from '../lib/mlb-abbr-backfill.js'

export const REPORT_MLB_LEGACY_ABBR_USAGE = `Usage:
  node scripts/report-mlb-legacy-abbr.js [--json]

Read-only OAK/CWS → ATH/CHW leftover check. Does not write.
One-time UPDATE: docs/mlb-ath-chw-backfill.md (Anthony's OK only).
`

function parseArgs(argv = []) {
  const out = { json: false, help: false }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--json') out.json = true
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(REPORT_MLB_LEGACY_ABBR_USAGE)
    return
  }

  const { createScriptSupabaseClient } = await import('../lib/supabase-script-client.js')
  const supabase = createScriptSupabaseClient()

  const { data: teams, error: teamError } = await supabase
    .from('Team')
    .select('id, name, abbr, sport')
    .eq('sport', 'mlb')
    .in('abbr', ['OAK', 'CWS'])

  if (teamError) throw new Error(`Team lookup failed: ${teamError.message}`)

  const { data: games, error: gameError } = await supabase
    .from('Game')
    .select('id, sport')
    .eq('sport', 'mlb')
    .or('id.ilike.OAK_at_%,id.ilike.%_at_OAK_%,id.ilike.CWS_at_%,id.ilike.%_at_CWS_%')

  if (gameError) throw new Error(`Game lookup failed: ${gameError.message}`)

  const summary = summarizeLegacyMlbAbbrRows({
    teams: teams || [],
    games: games || [],
  })

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  console.log(`📌 MLB Team.abbr still OAK/CWS: ${summary.teamCount}`)
  console.log(`📌 MLB Game.id still OAK/CWS: ${summary.gameCount}`)
  console.log('   (this script does not write)')
  console.log('   One-time UPDATE: docs/mlb-ath-chw-backfill.md — Anthony\'s OK only')
  for (const team of summary.teams) {
    console.log(`  team ${team.id} ${team.abbr} → ${team.nextAbbr} ${team.name || ''}`.trim())
  }
  for (const game of summary.games) {
    console.log(`  game ${game.id} → ${game.nextId}`)
  }
}

const isDirect = process.argv[1] && process.argv[1].endsWith('report-mlb-legacy-abbr.js')
if (isDirect) {
  main().catch((error) => {
    console.error('❌ report-mlb-legacy-abbr failed:', error)
    process.exit(1)
  })
}
