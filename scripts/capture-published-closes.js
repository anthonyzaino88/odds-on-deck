#!/usr/bin/env node
/**
 * Capture the last available Published-pick price before first pitch.
 *
 * Quota-aware: one Odds API event-odds call per oddsApiEventId that
 * still has Published picks without closeOdds, markets restricted to
 * those picks. Never re-runs morning fetch-live-odds.
 * Writes only where closeOdds IS NULL. Requires the secret key.
 *
 *   node scripts/capture-published-closes.js            # dry-run (default)
 *   node scripts/capture-published-closes.js --dry-run
 *   node scripts/capture-published-closes.js --apply
 *   npm run capture:published-closes:apply              # PowerShell-safe apply
 *   CLV_APPLY=1 node scripts/capture-published-closes.js
 *
 * Schedule at :16 and :46 ET after record-mlb-window-props.
 * No-ops during :05–:15 ET. CLOSING_CAPTURE=0 disables.
 * Uses createScriptSupabaseClient with SUPABASE_REQUIRE_SECRET_KEY=1.
 * Do not run --apply from CI.
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import {
  SUPABASE_REQUIRE_SECRET_ENV,
  envFlagEnabled,
  isPublishableSupabaseKey,
} from '../lib/supabase-admin-key.js'
import { paginateSupabaseSelect } from '../lib/unplayed-game-grades.js'
import {
  PUBLISHED_STATS_PREFILTER,
  isPublishedEligibleProp,
  isPublishedTrackSource,
} from '../lib/published-picks.js'
import { isMissingColumnError } from '../lib/grade-audit.js'
import {
  CLOSE_CAPTURE_WINDOW_MINUTES,
  applyPublishedCloseUpdate,
  buildEventOddsUrl,
  closeCapturePayload,
  closeUpdateRowCount,
  CLOSE_CAPTURE_DEFAULT_MIN_REMAINING,
  estimateCloseCaptureCost,
  flattenEventOddsQuotes,
  groupCaptureJobsByOddsApiEventId,
  hasCloseAlready,
  isCloseCaptureCandidate,
  isOpsWriteQuietPeriod,
  marketsForPublishedPicks,
  matchClosingQuote,
  oddsApiSportKey,
  parseOddsApiQuota,
  probeOddsApiQuota,
  updateWithOptionalCloseOdds,
} from '../lib/closing-line.js'

config({ path: '.env.local' })

const GAME_SELECT = 'id, sport, date, status, oddsApiEventId'
export const PICK_SELECT_BASE = [
  'id', 'propId', 'gameIdRef', 'playerName', 'propType', 'threshold',
  'prediction', 'odds', 'edge', 'qualityScore', 'sport', 'source',
  'status',
].join(', ')
export const PICK_SELECT = `${PICK_SELECT_BASE}, closeOdds, closeCapturedAt`

const KNOWN_FLAGS = new Set([
  '--dry-run', '--apply', '--help', '-h', '--max-calls', '--min-remaining',
])
const FLAGS_WITH_VALUE = new Set(['--max-calls', '--min-remaining'])

/** Non-negative integer flag. Missing or invalid values fail closed. */
export function parseNonNegIntFlag(args, flag) {
  const i = args.indexOf(flag)
  if (i < 0) return { present: false, value: null, invalid: false }
  const raw = args[i + 1]
  if (raw == null || String(raw).startsWith('--')) {
    return { present: true, value: null, invalid: true }
  }
  const text = String(raw).trim()
  if (!/^\d+$/.test(text)) {
    return { present: true, value: null, invalid: true }
  }
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0) {
    return { present: true, value: null, invalid: true }
  }
  return { present: true, value: n, invalid: false }
}

export function isClosingCaptureDisabled(env = process.env) {
  const raw = String(env.CLOSING_CAPTURE ?? '').trim().toLowerCase()
  return raw === '0' || raw === 'false' || raw === 'off'
}

export function formatCaptureModeBanner(apply) {
  return apply ? 'MODE: APPLY' : 'MODE: DRY-RUN'
}

/** Write scripts fail closed: never fall back to the public/anon key. */
export function captureSupabaseEnv(env = process.env) {
  return {
    ...env,
    [SUPABASE_REQUIRE_SECRET_ENV]: '1',
  }
}

/** Fail closed if the preferred write key looks publishable. Never print it. */
export function assertCaptureSecretIsNotPublishable(env = process.env) {
  const preferred = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (isPublishableSupabaseKey(preferred)) {
    throw new Error(
      'SUPABASE_SECRET_KEY is a publishable/anon key. Use the secret or service_role key.',
    )
  }
  return preferred
}

export function unknownCaptureArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : []
  const unknown = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i])
    if (FLAGS_WITH_VALUE.has(arg)) {
      const value = args[i + 1]
      if (value != null && !String(value).startsWith('--')) i += 1
      continue
    }
    if (KNOWN_FLAGS.has(arg)) continue
    unknown.push(arg)
  }
  return unknown
}

export function parseCaptureClosesArgs(argv = [], env = process.env) {
  const args = Array.isArray(argv) ? argv : []
  const dryRunFlag = args.includes('--dry-run')
  const applyFlag = args.includes('--apply') || envFlagEnabled(env.CLV_APPLY)
  const maxCalls = parseNonNegIntFlag(args, '--max-calls')
  const minRemainingFlag = parseNonNegIntFlag(args, '--min-remaining')
  const envMinRemaining = Number(env.CLOSING_CAPTURE_MIN_REMAINING)
  const unknown = unknownCaptureArgs(args)
  const invalidFlags = [
    maxCalls.invalid ? '--max-calls' : null,
    minRemainingFlag.invalid ? '--min-remaining' : null,
  ].filter(Boolean)
  const minRemaining = minRemainingFlag.present
    ? minRemainingFlag.value
    : (Number.isFinite(envMinRemaining) && envMinRemaining >= 0
      ? envMinRemaining
      : CLOSE_CAPTURE_DEFAULT_MIN_REMAINING)
  return {
    apply: applyFlag && !dryRunFlag,
    dryRun: !applyFlag || dryRunFlag,
    help: args.includes('--help') || args.includes('-h'),
    maxCalls: maxCalls.present ? maxCalls.value : null,
    minRemaining,
    disabled: isClosingCaptureDisabled(env),
    unknown,
    invalidFlags,
  }
}

async function defaultFetchEventOdds({ url, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'OddsOnDeck/1.0' },
  })
  const quota = parseOddsApiQuota(response.headers)
  if (!response.ok) {
    const text = await response.text()
    const error = new Error(`Odds API ${response.status}: ${text}`)
    error.quota = quota
    throw error
  }
  return { data: await response.json(), quota }
}

export async function runCapturePublishedCloses({
  argv = process.argv.slice(2),
  createClient = createScriptSupabaseClient,
  now = new Date(),
  fetchEventOdds = defaultFetchEventOdds,
  probeQuota = probeOddsApiQuota,
  apiKey = process.env.ODDS_API_KEY,
  env = process.env,
  log = console,
} = {}) {
  const args = parseCaptureClosesArgs(argv, env)
  if (args.help) {
    log.log(`Usage: node scripts/capture-published-closes.js [--dry-run|--apply] [--max-calls N] [--min-remaining N]

Dry-run (default): list in-window Published picks missing a close.
--apply or CLV_APPLY=1: one Odds API call per oddsApiEventId, write
         closeOdds only where closeOdds IS NULL. Requires ODDS_API_KEY +
         SUPABASE_SECRET_KEY (SUPABASE_REQUIRE_SECRET_KEY=1).
         Do not run from CI. Anon/public keys are refused.
PowerShell: prefer npm run capture:published-closes:apply.
            $env:CLV_APPLY=1 stays set for later plain runs.
CLOSING_CAPTURE=0 disables the job. --max-calls caps HTTP calls
(including the /v4/sports quota probe). Unknown flags and
invalid/missing --max-calls / --min-remaining values fail closed.
--min-remaining (default ${CLOSE_CAPTURE_DEFAULT_MIN_REMAINING}) stops when
Odds API remaining credits fall below the floor.
Window is T−${CLOSE_CAPTURE_WINDOW_MINUTES}..T−1 (pre-start games only).
No-ops during :05–:15 ET. Schedule at :16 and :46 ET, after
record-mlb-window-props. London NFL 9:30 AM ET games are missed
if this job only runs in the 11–22 ET MLB window.`)
    return { exitCode: 0, updates: [], calls: 0 }
  }

  if (args.unknown.length) {
    log.error(`❌ Unknown argument(s): ${args.unknown.join(' ')}`)
    return { exitCode: 1, updates: [], calls: 0, unknown: args.unknown }
  }
  if (args.invalidFlags.length) {
    log.error(`❌ Invalid or missing value for ${args.invalidFlags.join(', ')}`)
    return { exitCode: 1, updates: [], calls: 0, invalidFlags: args.invalidFlags }
  }

  log.log(formatCaptureModeBanner(args.apply))

  if (args.disabled) {
    log.log('⏸️  CLOSING_CAPTURE=0 — close capture disabled.')
    return { exitCode: 0, updates: [], calls: 0, skippedDisabled: true }
  }

  if (isOpsWriteQuietPeriod(now)) {
    log.log('⏸️  Ops quiet period (:05–:15 ET) — no close capture writes or Odds API calls.')
    return { exitCode: 0, updates: [], calls: 0, skippedQuiet: true }
  }

  let supabase
  try {
    assertCaptureSecretIsNotPublishable(env)
    supabase = createClient(captureSupabaseEnv(env))
  } catch (error) {
    log.error(`❌ ${error.message}`)
    return { exitCode: 1, updates: [], calls: 0, missingSecret: true }
  }
  const horizon = new Date(now.getTime() + CLOSE_CAPTURE_WINDOW_MINUTES * 60 * 1000)

  const { data: games, error: gameError } = await supabase
    .from('Game')
    .select(GAME_SELECT)
    .in('sport', PUBLISHED_STATS_PREFILTER.sports)
    .gte('date', now.toISOString())
    .lte('date', horizon.toISOString())

  if (gameError) {
    log.error(`❌ Game query failed: ${gameError.message}`)
    return { exitCode: 1, updates: [], calls: 0 }
  }

  const windowGames = (games || []).filter((game) => isCloseCaptureCandidate(game, now))
  const gamesById = new Map(windowGames.map((game) => [game.id, game]))
  if (windowGames.length === 0) {
    log.log('✅ No games in the close-capture window.')
    return { exitCode: 0, updates: [], calls: 0, openPicks: [], windowGames: [] }
  }

  async function loadPicks(select) {
    return paginateSupabaseSelect(() => supabase
      .from('PropValidation')
      .select(select)
      .eq('source', PUBLISHED_STATS_PREFILTER.source)
      .in('sport', PUBLISHED_STATS_PREFILTER.sports)
      .in('gameIdRef', windowGames.map((game) => game.id).concat(['__none__']))
      .gt('edge', PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
      .gte('qualityScore', PUBLISHED_STATS_PREFILTER.minQuality)
      .order('id', { ascending: true }))
  }

  let pickPage = await loadPicks(PICK_SELECT)
  let closeColumnsMissing = false
  if (pickPage.error && isMissingColumnError(pickPage.error)) {
    closeColumnsMissing = true
    log.log('⚠️ closeOdds columns not applied yet (run 007 SQL).')
    pickPage = await loadPicks(PICK_SELECT_BASE)
  }

  if (pickPage.error) {
    log.error(`❌ Pick query failed: ${pickPage.error.message}`)
    return { exitCode: 1, updates: [], calls: 0, closeColumnsMissing }
  }

  if (closeColumnsMissing && args.apply) {
    log.error('❌ --apply needs 007 SQL (closeOdds columns). Dry-run still works.')
    return { exitCode: 1, updates: [], calls: 0, closeColumnsMissing }
  }

  const openPicks = (pickPage.rows || []).filter((row) => (
    isPublishedTrackSource(row)
    && isPublishedEligibleProp(row)
    && !hasCloseAlready(row)
    && gamesById.has(row.gameIdRef)
  ))

  const byGame = new Map()
  for (const pick of openPicks) {
    const list = byGame.get(pick.gameIdRef) || []
    list.push(pick)
    byGame.set(pick.gameIdRef, list)
  }

  const captureJobs = groupCaptureJobsByOddsApiEventId(byGame, gamesById)
  const marketCounts = captureJobs.map((job) => marketsForPublishedPicks(job.picks).length)
  const cost = estimateCloseCaptureCost({ gameCount: captureJobs.length, marketCounts })

  log.log('\n📸 PUBLISHED CLOSE CAPTURE')
  log.log('='.repeat(60))
  log.log(`Window: ${CLOSE_CAPTURE_WINDOW_MINUTES} minutes before first pitch (T−1 floor, pre-start only)`)
  log.log(`Games in window: ${windowGames.length}`)
  log.log(`Published picks missing close: ${openPicks.length}`)
  log.log(`Odds API HTTP calls this run: ${cost.httpCalls}`)
  log.log(`Odds API credits this run: ${cost.credits} (markets × regions=${cost.regions})`)
  log.log(cost.note)

  if (captureJobs.length === 0) {
    log.log('✅ Nothing to capture.')
    return { exitCode: 0, updates: [], calls: 0, openPicks, captureJobs }
  }

  if (args.dryRun) {
    for (const job of captureJobs) {
      log.log(
        `  would fetch ${job.gameIds.join(',')}  event=${job.eventId || 'UNMAPPED'}  `
        + `markets=${marketsForPublishedPicks(job.picks).join(',') || '—'}  `
        + `picks=${job.picks.length}`,
      )
    }
    log.log('\n💡 Dry-run only. Pass --apply after 007 SQL to write closes.')
    return { exitCode: 0, updates: [], calls: 0, openPicks, byGame, captureJobs }
  }

  if (!apiKey) {
    log.error('❌ ODDS_API_KEY missing. Dry-run does not need it; --apply does.')
    return { exitCode: 1, updates: [], calls: 0 }
  }

  const updates = []
  let calls = 0
  let lastQuota = { remaining: null, used: null }
  if (args.maxCalls != null && args.maxCalls <= 0) {
    log.log(`⏸️  --max-calls ${args.maxCalls} reached. No Odds API calls.`)
    return { exitCode: 0, updates: [], calls: 0, skippedMaxCalls: true }
  }
  try {
    lastQuota = await probeQuota({ apiKey }) || lastQuota
    calls += 1
  } catch (error) {
    calls += 1
    log.log(`⚠️ Quota probe failed (${error.message}); continuing without a pre-check.`)
  }
  if (lastQuota.remaining != null && lastQuota.remaining < args.minRemaining) {
    log.log(
      `⏸️  Odds API remaining ${lastQuota.remaining} < min-remaining ${args.minRemaining}. `
      + 'No event-odds calls.',
    )
    return { exitCode: 0, updates: [], calls, lastQuota, skippedQuota: true }
  }

  for (const job of captureJobs) {
    const game = job.game
    const sportKey = oddsApiSportKey(game?.sport)
    const label = job.gameIds.join(',')
    if (!job.eventId || !sportKey) {
      log.log(`  skip ${label}: no Odds API event id`)
      continue
    }
    const markets = marketsForPublishedPicks(job.picks)
    if (markets.length === 0) {
      log.log(`  skip ${label}: no mapped markets`)
      continue
    }
    if (args.maxCalls != null && calls >= args.maxCalls) {
      log.log(`⏸️  --max-calls ${args.maxCalls} reached. Stopping.`)
      break
    }
    if (lastQuota.remaining != null && lastQuota.remaining < args.minRemaining) {
      log.log(
        `⏸️  Odds API remaining ${lastQuota.remaining} < min-remaining ${args.minRemaining}. Stopping.`,
      )
      break
    }

    const url = buildEventOddsUrl({
      sportKey,
      eventId: job.eventId,
      markets,
      apiKey,
    })
    calls += 1
    let payload
    try {
      payload = await fetchEventOdds({ url })
      if (payload.quota) lastQuota = payload.quota
    } catch (error) {
      log.error(`  ❌ ${label}: ${error.message}`)
      continue
    }

    const quotes = flattenEventOddsQuotes(payload.data)
    for (const pick of job.picks) {
      const quote = matchClosingQuote(pick, quotes)
      if (!quote) {
        log.log(`  no quote ${pick.id} ${pick.playerName} ${pick.propType}`)
        continue
      }
      const patch = closeCapturePayload(quote, now)
      if (!patch || patch.closeOdds == null) {
        log.log(`  skipped ${pick.id} unconvertible close price`)
        continue
      }
      const write = await updateWithOptionalCloseOdds(
        (body) => applyPublishedCloseUpdate(
          supabase.from('PropValidation'),
          pick.id,
          body,
        ),
        patch,
      )
      if (write?.error) {
        log.error(`  ❌ write ${pick.id}: ${write.error.message}`)
        continue
      }
      const written = closeUpdateRowCount(write)
      if (written === 0) {
        log.log(`  skipped ${pick.id} already captured (closeOdds present)`)
        continue
      }
      updates.push({ id: pick.id, ...patch })
      log.log(
        `  ✅ ${pick.id} ${pick.playerName} ${pick.propType} `
        + `recorded ${pick.odds} → close ${patch.closeOdds} (${quote.book})`,
      )
    }
  }

  if (lastQuota.remaining != null) {
    log.log(`📊 Odds API remaining: ${lastQuota.remaining} (used ${lastQuota.used ?? '?'})`)
  }
  log.log(`Captured ${updates.length} close(s) with ${calls} HTTP call(s).`)
  return { exitCode: 0, updates, calls, lastQuota }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runCapturePublishedCloses().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}
