#!/usr/bin/env node

/**
 * One-off repair for MLB Game rows frozen at pre_game / warmup / delayed.
 *
 * After PR #28 the hydrate schedule writes those statuses, and the hourly
 * updater only selected scheduled / in_progress. Those rows sat at 0-0 and
 * aged out of the 3-day window.
 *
 * Dry-run by default (reads Game + StatsAPI/ESPN, writes nothing).
 * Pass --apply to write the same score-updater payload.
 *
 * Usage:
 *   node scripts/repair-stuck-mlb-scores.js
 *   node scripts/repair-stuck-mlb-scores.js --from 2026-09-25 --to 2026-10-01
 *   node scripts/repair-stuck-mlb-scores.js --from 2026-09-25 --to 2026-10-01 --apply
 *
 * --from/--to are inclusive UTC calendar days. A 8:00 PM ET start on 9/30 is
 * stored as 2026-10-01T00:00:00, so the 9/29–9/30 Wild Card night games need
 * `--to 2026-10-01`.
 *
 * Requeue game_line rows that validate-pending-props wrongly sent to
 * needs_review ("Stat not found in API."). Default requeue mode only
 * flips a row back to pending when its Game is final (or dated before
 * yesterday). Prefer waiting until this repair (or the hourly updater)
 * has marked the game final:
 *
 *   SOURCE=game_line SPORT=mlb ACTION=requeue \
 *     node scripts/requeue-or-close-validations.js
 *
 *   node scripts/requeue-or-close-validations.js --source game_line --sport mlb
 *
 * Then gradePendingGameLines (persistGameLines / validation job) waits
 * for Game.status final and grades from the stored score. Do not grade
 * postponed if-necessary placeholders.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fetchLiveGameData, fetchLiveGamesByDateRange, mlbScheduleDateWindow } from '../lib/vendors/stats.js'
import { parseEspnMlbSummary } from '../lib/mlb-live-status.js'
import {
  STUCK_MLB_REPAIR_STATUSES,
  fetchStuckMlbGames,
  parseRepairStuckMlbArgs,
  printScoreRecap,
  refreshGameScores,
} from '../lib/score-updater.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fetchMLBFromESPN(espnGameId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${espnGameId}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    return parseEspnMlbSummary(data)
  } catch (err) {
    console.error(`  ❌ ESPN fallback error: ${err.message}`)
    return null
  }
}

async function main() {
  const args = parseRepairStuckMlbArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node scripts/repair-stuck-mlb-scores.js [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--apply]

Dry-run (default): select stuck MLB rows (pre_game / warmup / delayed)
older than now, fetch live status, print the write plan. No DB writes.
--apply: write the updater payload.

Default range is the last 14 UTC days through now.
--from/--to are inclusive UTC days. Night ET games on 9/30 are stored
as 2026-10-01T00:00Z, so use --to 2026-10-01 for that Wild Card slate.`)
    return
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL. Load .env.local or export credentials.')
    process.exit(1)
  }

  console.log('\n🔧 REPAIR STUCK MLB SCORES')
  console.log('='.repeat(60))
  console.log(`Mode:     ${args.apply ? 'APPLY (writes Game rows)' : 'DRY-RUN (no writes)'}`)
  console.log(`Statuses: ${STUCK_MLB_REPAIR_STATUSES.join(', ')}`)
  console.log(`From:     ${args.from || '(default: 14 days ago)'}`)
  console.log(`To:       ${args.to || '(default: now)'}`)
  console.log('='.repeat(60))

  const startTime = Date.now()
  const { games, error, range } = await fetchStuckMlbGames(supabase, {
    from: args.from,
    to: args.to,
  })

  if (error) {
    console.error(`❌ Query error: ${error.message}`)
    process.exit(1)
  }

  console.log(`📅 Range: ${range.start.toISOString()} .. ${range.end.toISOString()}`)
  console.log(`📊 Found ${games.length} stuck MLB game(s)\n`)

  if (games.length === 0) {
    console.log('✅ Nothing to repair.')
    return
  }

  for (const game of games) {
    console.log(`  • ${game.id}  ${game.status}  ${game.date}  ${game.awayScore ?? 0}-${game.homeScore ?? 0}`)
  }
  console.log('')

  let mlbLiveByPk = null
  const window = mlbScheduleDateWindow(games)
  if (window) {
    try {
      mlbLiveByPk = await fetchLiveGamesByDateRange(window.startDate, window.endDate, true)
      console.log(`📡 MLB schedule hydrate ${window.startDate}..${window.endDate}: ${mlbLiveByPk.size} game(s)\n`)
    } catch (err) {
      console.warn(`  ⚠️  Hydrated schedule fetch failed (${err.message}); falling back to per-gamePk schedule`)
    }
  }

  const result = await refreshGameScores({
    sport: 'mlb',
    games,
    supabase,
    apply: args.apply,
    mlbLiveByPk,
    fetchLiveGameData,
    fetchEspnMlb: fetchMLBFromESPN,
  })

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n📊 Repair summary:`)
  console.log(`  ${args.apply ? 'Updated' : 'Would update'}: ${result.updated}`)
  console.log(`  Errors: ${result.errors}`)
  console.log(`  Total:  ${games.length}`)

  printScoreRecap({
    live: result.live,
    changes: result.changes,
    totalUpdated: result.updated,
    totalErrors: result.errors,
    duration,
    writtenLabel: args.apply ? 'Rows written' : 'Would write',
  })

  if (!args.apply) {
    console.log('💡 Dry-run. Re-run with --apply to write Game rows.')
    console.log('💡 After finals land, requeue needs_review game_line rows:')
    console.log('   SOURCE=game_line SPORT=mlb ACTION=requeue node scripts/requeue-or-close-validations.js')
    console.log('   node scripts/requeue-or-close-validations.js --source game_line --sport mlb')
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
