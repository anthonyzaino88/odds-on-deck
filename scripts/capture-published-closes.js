#!/usr/bin/env node
/**
 * Capture the last available Published-pick price before first pitch.
 *
 * Quota-aware: one Odds API event-odds call per oddsApiEventId that
 * still has Published or shadow-published picks without closeOdds,
 * markets restricted to those picks. Never re-runs morning fetch-live-odds.
 * Writes only where closeOdds IS NULL. Requires the secret key.
 * NHL (published or historical shadow-tagged) shares this job's window,
 * guards, and --max-calls budget. NFL jobs run first so a busy NHL
 * slate cannot exhaust the cap before later NFL closes.
 *
 * --nfl-all (opt-in): also capture every pending NFL prop without a close
 * (Published bar ignored) and merge h2h/spreads/totals onto that same
 * per-game call. Game-line closes write to ClosingOdds, idempotently.
 * Absent the flag, behavior is unchanged. NHL visibility is unchanged.
 *
 *   node scripts/capture-published-closes.js            # dry-run (default)
 *   node scripts/capture-published-closes.js --dry-run
 *   node scripts/capture-published-closes.js --apply
 *   node scripts/capture-published-closes.js --nfl-all --dry-run
 *   node scripts/capture-published-closes.js --nfl-all --apply
 *   npm run capture:published-closes:apply              # PowerShell-safe apply
 *   npm run capture:published-closes:nfl-all:apply
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
  CLOSE_CAPTURE_SPORTS,
  PUBLISHED_STATS_PREFILTER,
  isCloseCaptureEligiblePick,
} from '../lib/published-picks.js'
import { isMissingColumnError } from '../lib/grade-audit.js'
import {
  CLOSE_CAPTURE_WINDOW_MINUTES,
  applyPublishedCloseUpdate,
  buildEventOddsUrl,
  capturedNflGameLineGameIds,
  closeCaptureJobPriority,
  closeCapturePayload,
  closeUpdateRowCount,
  CLOSE_CAPTURE_DEFAULT_MIN_REMAINING,
  flattenEventOddsQuotes,
  formatCallsUsed,
  formatCreditsUsed,
  formatGameLineCloseCounts,
  gameLineClosesForCaptureJob,
  groupCaptureJobsByOddsApiEventId,
  hasCloseAlready,
  includeNflWindowGamesForGameLines,
  isCloseCaptureCandidate,
  isNflSport,
  isOpsWriteQuietPeriod,
  isTargetedCloseCapturePick,
  loadExistingClosingOdds,
  marketsForCaptureJob,
  matchClosingQuote,
  oddsApiSportKey,
  probeOddsApiQuota,
  resetClosingOddsWriteGuard,
  selectCloseCaptureJobsWithinBudget,
  sortCloseCaptureJobs,
  updateWithOptionalCloseOdds,
  writeGameLineCloses,
} from '../lib/closing-line.js'
import {
  createOddsApiBudget,
  emitOddsBudgetStatus,
  fetchOddsApiJson,
  formatOddsBudgetStatus,
  formatOddsBudgetWarnLine,
  formatOddsCreditsRemaining,
  formatOddsCreditsUsed,
  ODDS_BUDGET_OK,
} from '../lib/odds-api-budget.js'

config({ path: '.env.local' })

const GAME_SELECT = 'id, sport, date, status, oddsApiEventId'
export const PICK_SELECT_BASE = [
  'id', 'propId', 'gameIdRef', 'playerName', 'propType', 'threshold',
  'prediction', 'odds', 'edge', 'qualityScore', 'sport', 'source',
  'status', 'notes',
].join(', ')
export const PICK_SELECT = `${PICK_SELECT_BASE}, closeOdds, closeCapturedAt`

const KNOWN_FLAGS = new Set([
  '--dry-run', '--apply', '--help', '-h', '--max-calls', '--min-remaining',
  '--max-credits', '--nfl-all',
])
const FLAGS_WITH_VALUE = new Set(['--max-calls', '--min-remaining', '--max-credits'])

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
  const maxCredits = parseNonNegIntFlag(args, '--max-credits')
  const envMinRemaining = Number(env.CLOSING_CAPTURE_MIN_REMAINING)
  const unknown = unknownCaptureArgs(args)
  const invalidFlags = [
    maxCalls.invalid ? '--max-calls' : null,
    minRemainingFlag.invalid ? '--min-remaining' : null,
    maxCredits.invalid ? '--max-credits' : null,
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
    maxCredits: maxCredits.present ? maxCredits.value : null,
    nflAll: args.includes('--nfl-all'),
    disabled: isClosingCaptureDisabled(env),
    unknown,
    invalidFlags,
  }
}

async function defaultFetchEventOdds({
  url,
  fetchImpl = fetch,
  budget,
  estimatedCredits,
  apiKey,
} = {}) {
  const result = await fetchOddsApiJson(url, {
    fetchImpl,
    budget,
    estimatedCredits,
    apiKey,
  })
  return {
    data: result.data,
    quota: result.quota,
    skipped: result.skipped,
    budgetRecorded: result.budgetRecorded,
  }
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
  budget,
} = {}) {
  resetClosingOddsWriteGuard()
  const args = parseCaptureClosesArgs(argv, env)
  const oddsBudget = budget || createOddsApiBudget({
    env,
    now,
    log,
    apiKey,
    purpose: 'close-capture',
  })
  const done = (result) => {
    emitOddsBudgetStatus(oddsBudget.status(), log)
    log.log(formatOddsCreditsUsed(oddsBudget.runCredits()))
    log.log(formatOddsCreditsRemaining(oddsBudget.remaining()))
    if (result.plannedCredits != null || result.creditsUsed != null) {
      log.log(formatCreditsUsed(result.creditsUsed ?? 0))
    }
    log.log(formatCallsUsed(result.calls ?? 0))
    return result
  }
  if (args.help) {
    log.log(`Usage: node scripts/capture-published-closes.js [--dry-run|--apply] [--nfl-all] [--max-calls N] [--max-credits N] [--min-remaining N]

Dry-run (default): list in-window Published and shadow-published picks
missing a close. NHL shares this --max-calls budget; NFL jobs run first
so a busy NHL slate cannot exhaust the cap before later NFL closes.
--apply or CLV_APPLY=1: one Odds API call per
oddsApiEventId, write closeOdds only where closeOdds IS NULL. Requires
ODDS_API_KEY + SUPABASE_SECRET_KEY (SUPABASE_REQUIRE_SECRET_KEY=1).
         Do not run from CI. Anon/public keys are refused.
--nfl-all: also target every pending NFL prop without a close
(Published bar ignored) and merge h2h/spreads/totals onto that same
per-game call. Prop markets also request the matching *_alternate
key so alternate-line picks can match the exact recorded threshold.
Game-line closes write to ClosingOdds (no duplicates).
Absent --nfl-all, behavior is unchanged. NHL visibility is unchanged.
PowerShell: prefer npm run capture:published-closes:apply or
            npm run capture:published-closes:nfl-all:apply.
            $env:CLV_APPLY=1 stays set for later plain runs.
CLOSING_CAPTURE=0 disables the job. --max-calls caps HTTP calls
(including the /v4/sports quota probe). --max-credits caps
markets × regions (us=1) and stops before exceeding, soonest
kickoff first when --nfl-all. Unknown flags and invalid/missing
--max-calls / --max-credits / --min-remaining values fail closed.
Close capture is idempotent: deterministic clvclose: ids plus
ClosingOdds_close_capture_uniq (SQL 008, after exact-duplicate cleanup).
--min-remaining (default ${CLOSE_CAPTURE_DEFAULT_MIN_REMAINING}) stops when
Odds API remaining credits fall below the floor.
Window is T−${CLOSE_CAPTURE_WINDOW_MINUTES}..T−1 (pre-start games only).
No-ops during :05–:15 ET. Schedule at :16 and :46 ET, after
record-mlb-window-props. London NFL 9:30 AM ET games are missed
if this job only runs in the 11–22 ET MLB window.
Dry-run prints planned HTTP calls including the quota check,
plus planned credits. Every run prints CALLS_USED=<n> (actual
HTTP calls) and CREDITS_USED=<n> when credits were budgeted.`)
    return done({ exitCode: 0, updates: [], calls: 0, help: true })
  }

  if (args.unknown.length) {
    log.error(`❌ Unknown argument(s): ${args.unknown.join(' ')}`)
    return done({ exitCode: 1, updates: [], calls: 0, unknown: args.unknown })
  }
  if (args.invalidFlags.length) {
    log.error(`❌ Invalid or missing value for ${args.invalidFlags.join(', ')}`)
    return done({ exitCode: 1, updates: [], calls: 0, invalidFlags: args.invalidFlags })
  }

  log.log(formatCaptureModeBanner(args.apply))

  if (args.disabled) {
    log.log('⏸️  CLOSING_CAPTURE=0 — close capture disabled.')
    return done({ exitCode: 0, updates: [], calls: 0, skippedDisabled: true })
  }

  if (isOpsWriteQuietPeriod(now)) {
    log.log('⏸️  Ops quiet period (:05–:15 ET) — no close capture writes or Odds API calls.')
    return done({ exitCode: 0, updates: [], calls: 0, skippedQuiet: true })
  }

  let supabase
  try {
    assertCaptureSecretIsNotPublishable(env)
    supabase = createClient(captureSupabaseEnv(env))
  } catch (error) {
    log.error(`❌ ${error.message}`)
    return done({ exitCode: 1, updates: [], calls: 0, missingSecret: true })
  }
  const horizon = new Date(now.getTime() + CLOSE_CAPTURE_WINDOW_MINUTES * 60 * 1000)

  const { data: games, error: gameError } = await supabase
    .from('Game')
    .select(GAME_SELECT)
    .in('sport', CLOSE_CAPTURE_SPORTS)
    .gte('date', now.toISOString())
    .lte('date', horizon.toISOString())

  if (gameError) {
    log.error(`❌ Game query failed: ${gameError.message}`)
    return done({ exitCode: 1, updates: [], calls: 0 })
  }

  const windowGames = (games || []).filter((game) => isCloseCaptureCandidate(game, now))
  const gamesById = new Map(windowGames.map((game) => [game.id, game]))
  if (windowGames.length === 0) {
    log.log('✅ No games in the close-capture window.')
    return done({ exitCode: 0, updates: [], calls: 0, openPicks: [], windowGames: [] })
  }

  async function loadPublishedPicks(select) {
    return paginateSupabaseSelect(() => supabase
      .from('PropValidation')
      .select(select)
      .eq('source', PUBLISHED_STATS_PREFILTER.source)
      .in('sport', CLOSE_CAPTURE_SPORTS)
      .in('gameIdRef', windowGames.map((game) => game.id).concat(['__none__']))
      .gt('edge', PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
      .gte('qualityScore', PUBLISHED_STATS_PREFILTER.minQuality)
      .order('id', { ascending: true }))
  }

  async function loadNflAllPendingPicks(select) {
    const nflGameIds = windowGames.filter((game) => isNflSport(game.sport)).map((game) => game.id)
    if (nflGameIds.length === 0) return { rows: [], error: null }
    return paginateSupabaseSelect(() => supabase
      .from('PropValidation')
      .select(select)
      .eq('sport', 'nfl')
      .eq('status', 'pending')
      .in('gameIdRef', nflGameIds.concat(['__none__']))
      .order('id', { ascending: true }))
  }

  async function loadCapturePicks(select) {
    const published = await loadPublishedPicks(select)
    if (published.error) return published
    if (!args.nflAll) return published
    const nflAll = await loadNflAllPendingPicks(select)
    if (nflAll.error) return nflAll
    const byId = new Map()
    for (const row of [...(published.rows || []), ...(nflAll.rows || [])]) {
      if (row?.id) byId.set(row.id, row)
    }
    return { rows: [...byId.values()], error: null }
  }

  let pickPage = await loadCapturePicks(PICK_SELECT)
  let closeColumnsMissing = false
  if (pickPage.error && isMissingColumnError(pickPage.error)) {
    closeColumnsMissing = true
    log.log('⚠️ closeOdds columns not applied yet (run 007 SQL).')
    pickPage = await loadCapturePicks(PICK_SELECT_BASE)
  }

  if (pickPage.error) {
    log.error(`❌ Pick query failed: ${pickPage.error.message}`)
    return done({ exitCode: 1, updates: [], calls: 0, closeColumnsMissing })
  }

  if (closeColumnsMissing && args.apply) {
    log.error('❌ --apply needs 007 SQL (closeOdds columns). Dry-run still works.')
    return done({ exitCode: 1, updates: [], calls: 0, closeColumnsMissing })
  }

  const openPicks = (pickPage.rows || []).filter((row) => (
    (args.nflAll
      ? isTargetedCloseCapturePick(row, { nflAll: true })
      : isCloseCaptureEligiblePick(row) && !hasCloseAlready(row))
    && gamesById.has(row.gameIdRef)
  ))

  let existingClosingOdds = []
  if (args.nflAll) {
    const nflIds = windowGames.filter((game) => isNflSport(game.sport)).map((game) => game.id)
    const loaded = await loadExistingClosingOdds(supabase, nflIds)
    if (loaded.error) {
      log.log(`⚠️ ClosingOdds read failed (${loaded.error.message}); planning game-line fetches without a skip list.`)
    } else {
      existingClosingOdds = loaded.rows
    }
  }
  const capturedGameIds = capturedNflGameLineGameIds(
    windowGames.filter((game) => isNflSport(game.sport)),
    existingClosingOdds,
  )

  const byGame = includeNflWindowGamesForGameLines(new Map(), windowGames, {
    nflAll: args.nflAll,
    capturedGameIds,
  })
  for (const pick of openPicks) {
    const list = byGame.get(pick.gameIdRef) || []
    list.push(pick)
    byGame.set(pick.gameIdRef, list)
  }

  const allJobs = sortCloseCaptureJobs(
    groupCaptureJobsByOddsApiEventId(byGame, gamesById),
    { nflAll: args.nflAll },
  )
  const budgeted = selectCloseCaptureJobsWithinBudget(allJobs, {
    nflAll: args.nflAll,
    maxCalls: args.maxCalls,
    maxCredits: args.maxCredits,
    gameLinesCapturedByGameId: capturedGameIds,
  })
  const captureJobs = budgeted.jobs
  const plannedCalls = budgeted.plannedCalls
  const plannedCredits = budgeted.plannedCredits

  log.log('\n📸 PUBLISHED CLOSE CAPTURE')
  log.log('='.repeat(60))
  log.log(`Window: ${CLOSE_CAPTURE_WINDOW_MINUTES} minutes before first pitch (T−1 floor, pre-start only)`)
  log.log(`Games in window: ${windowGames.length}`)
  log.log(
    args.nflAll
      ? `Published + shadow + pending NFL props missing close: ${openPicks.length}`
      : `Published + shadow picks missing close: ${openPicks.length}`,
  )
  if (args.nflAll) {
    log.log('NFL-all: pending props + h2h/spreads/totals (one call per game)')
    log.log('Close capture is idempotent (clvclose: ids + ClosingOdds_close_capture_uniq).')
  }
  log.log(`Odds API HTTP calls this run: ${plannedCalls}`)
  log.log(`Odds API credits this run: ${plannedCredits} (markets × regions=1)`)
  log.log('1 HTTP call per game. Credits = markets × regions (us=1), not the morning 10-market slate.')

  if (captureJobs.length === 0) {
    if (args.maxCalls != null && args.maxCalls <= 0) {
      log.log(`⏸️  --max-calls ${args.maxCalls} reached. No Odds API calls.`)
      return done({
        exitCode: 0,
        updates: [],
        calls: 0,
        creditsUsed: 0,
        plannedCalls,
        plannedCredits,
        skippedMaxCalls: true,
      })
    }
    if (args.maxCredits != null && args.maxCredits <= 0) {
      log.log(`⏸️  --max-credits ${args.maxCredits} reached. No Odds API calls.`)
      return done({
        exitCode: 0,
        updates: [],
        calls: 0,
        creditsUsed: 0,
        plannedCalls,
        plannedCredits,
        skippedMaxCredits: true,
      })
    }
    log.log('✅ Nothing to capture.')
    return done({
      exitCode: 0,
      updates: [],
      calls: 0,
      creditsUsed: 0,
      plannedCalls,
      plannedCredits,
      openPicks,
      captureJobs,
    })
  }

  if (args.dryRun) {
    for (const job of captureJobs) {
      log.log(
        `  would fetch ${job.gameIds.join(',')}  event=${job.eventId || 'UNMAPPED'}  `
        + `markets=${(job.markets || marketsForCaptureJob(job, {
          nflAll: args.nflAll,
          gameLinesCaptured: capturedGameIds.has(job.gameId),
        })).join(',') || '—'}  `
        + `picks=${job.picks.length}  credits=${job.creditCost ?? ''}`,
      )
    }
    log.log('\n💡 Dry-run only. Pass --apply after 007 SQL to write closes.')
    return done({
      exitCode: 0,
      updates: [],
      calls: 0,
      creditsUsed: 0,
      plannedCalls,
      plannedCredits,
      openPicks,
      byGame,
      captureJobs,
    })
  }

  if (!apiKey) {
    log.error('❌ ODDS_API_KEY missing. Dry-run does not need it; --apply does.')
    return done({ exitCode: 1, updates: [], calls: 0 })
  }

  const updates = []
  let calls = 0
  let creditsUsed = 0
  let lastQuota = { remaining: null, used: null, last: null }
  if (args.maxCalls != null && args.maxCalls <= 0) {
    log.log(`⏸️  --max-calls ${args.maxCalls} reached. No Odds API calls.`)
    return done({
      exitCode: 0,
      updates: [],
      calls: 0,
      creditsUsed: 0,
      skippedMaxCalls: true,
    })
  }
  try {
    lastQuota = await probeQuota({ apiKey }) || lastQuota
    oddsBudget.record(lastQuota, { credits: lastQuota.last ?? 0 })
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
    return done({ exitCode: 0, updates: [], calls, lastQuota, skippedQuota: true })
  }
  if (oddsBudget.status() !== ODDS_BUDGET_OK) {
    log.log(`⏸️  ${formatOddsBudgetStatus(oddsBudget.status())}`)
    const warn = formatOddsBudgetWarnLine(oddsBudget.status())
    if (warn) log.log(warn)
    return done({
      exitCode: 0,
      updates: [],
      calls,
      creditsUsed: 0,
      lastQuota,
      skippedBudget: true,
    })
  }

  const gameLineWrites = []
  for (const job of captureJobs) {
    const game = job.game
    const sportKey = oddsApiSportKey(game?.sport)
    const label = job.gameIds.join(',')
    if (!job.eventId || !sportKey) {
      log.log(`  skip ${label}: no Odds API event id`)
      continue
    }
    const markets = job.markets || marketsForCaptureJob(job, {
      nflAll: args.nflAll,
      gameLinesCaptured: capturedGameIds.has(job.gameId),
    })
    if (markets.length === 0) {
      log.log(`  skip ${label}: no mapped markets`)
      continue
    }
    if (args.maxCalls != null && calls >= args.maxCalls) {
      log.log(`⏸️  --max-calls ${args.maxCalls} reached. Stopping.`)
      break
    }
    if (args.maxCredits != null && creditsUsed + markets.length > args.maxCredits) {
      log.log(`⏸️  --max-credits ${args.maxCredits} reached. Stopping.`)
      break
    }
    if (lastQuota.remaining != null && lastQuota.remaining < args.minRemaining) {
      log.log(
        `⏸️  Odds API remaining ${lastQuota.remaining} < min-remaining ${args.minRemaining}. Stopping.`,
      )
      break
    }
    if (!oddsBudget.allow(markets.length)) {
      log.log(`⏸️  ${formatOddsBudgetStatus(oddsBudget.status())}`)
      const warn = formatOddsBudgetWarnLine(oddsBudget.status())
      if (warn) log.log(warn)
      break
    }

    const url = buildEventOddsUrl({
      sportKey,
      eventId: job.eventId,
      markets,
      apiKey,
    })
    calls += 1
    creditsUsed += markets.length
    let payload
    try {
      payload = await fetchEventOdds({ url })
      if (payload?.skipped) {
        log.log(`⏸️  ${formatOddsBudgetStatus(oddsBudget.status())}`)
        const warn = formatOddsBudgetWarnLine(oddsBudget.status())
        if (warn) log.log(warn)
        break
      }
      if (payload?.quota) lastQuota = payload.quota
      oddsBudget.record(payload?.quota || {}, { credits: payload?.quota?.last ?? markets.length })
    } catch (error) {
      log.error(`  ❌ ${label}: ${error.message}`)
      continue
    }

    if (args.nflAll && isNflSport(game?.sport)) {
      const gameLineRows = gameLineClosesForCaptureJob(job, payload.data, now, { log })
      const writtenLines = await writeGameLineCloses(supabase, gameLineRows, {
        gamesById,
      })
      if (writtenLines.error) {
        const failedNote = writtenLines.failed
          ? ` (${writtenLines.failed} row(s) not captured)`
          : ''
        log.error(`  ❌ ClosingOdds ${label}: ${writtenLines.error.message}${failedNote}`)
      }
      log.log(formatGameLineCloseCounts({
        label,
        proposed: gameLineRows.length,
        inserted: writtenLines.inserted,
        skipped: writtenLines.skipped,
        failed: writtenLines.failed,
      }))
      if (writtenLines.inserted > 0) {
        gameLineWrites.push(...(writtenLines.rows || []))
      }
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
  return done({
    exitCode: 0,
    updates,
    calls,
    creditsUsed,
    lastQuota,
    plannedCalls,
    plannedCredits,
    gameLineWrites,
  })
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
    console.log(formatCallsUsed(0))
    process.exit(1)
  })
}
