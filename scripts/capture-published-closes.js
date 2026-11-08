#!/usr/bin/env node
/**
 * Capture the last available Published-pick price before first pitch.
 *
 * Two passes in one run:
 *   early      T−window..T−nearStart (default T−35..T−10) — first close
 *   near-start T−nearStart..T−1 (default T−10..T−1) — overwrite/upsert
 *
 * Quota-aware: one Odds API event-odds call per oddsApiEventId,
 * markets restricted to Published (or shadow-published) picks. Never re-runs morning fetch-live-odds.
 * Early pass writes where closeOdds
 * IS NULL. A pick that already has closeOdds and closeCapturedAt is
 * skipped until kickoff is inside ALREADY_CLOSED_RECAPTURE_MINUTES, so
 * that final window can overwrite with the truest close. Near-start
 * upserts the later close on ClosingOdds.id
 * (deterministic clvclose: primary key; onConflict: id — does not
 * rely on SQL 008) and overwrites PropValidation close fields.
 * Requires the secret key. Daily event-odds captures are
 * capped (default 40, ODDS_CLOSE_CAPTURE_DAILY_CAP) and still gated
 * by lib/odds-api-budget.js including ODDS_CLOSE_CAPTURE_RESERVE.
 * NHL (published or historical shadow-tagged) is included via
 * isCloseCaptureEligiblePick (inside isTargetedCloseCapturePick) and
 * shares this job's window, guards, and --max-calls budget. NFL jobs
 * run first (closeCaptureJobPriority) so a busy NHL slate cannot
 * exhaust the cap before later NFL closes.
 *
 * --nfl-all (opt-in): also capture every pending NFL prop without a close
 * (Published bar ignored) and merge h2h/spreads/totals onto that same
 * per-game call. Game-line closes write to ClosingOdds, idempotently.
 * Absent the flag, behavior is unchanged. NHL visibility is unchanged.
 *
 * --game-lines (opt-in): today's EdgeSnapshot moneyline/total edges for
 * NFL, NHL, and MLB in the same windows. One sport-level /odds call
 * per start-time cluster (markets h2h,totals; --spreads adds spreads;
 * regions from ODDS_CLOSE_CAPTURE_REGIONS, default us). Writes
 * clvclose: rows with quoted_at from last_update. Prop jobs are
 * planned and fetched first. Each sport call also uses one
 * ODDS_CLOSE_CAPTURE_DAILY_CAP slot. ODDS_GAME_LINE_CLOSE_DAILY_CAP
 * (default 12 credits) is persisted on the ET-day ledger, so later
 * runs cannot spend another 12. ODDS_CLOSE_CAPTURE_PROP_HEADROOM
 * (default 28) keeps that many of the 40 slots for later prop closes.
 * Game lines stop before they enter that headroom. Paid calls reserve
 * the credits under the ledger lock before the HTTP call.
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
 * That cadence covers the early pass; it misses most T−10..T−1
 * kickoffs (see operations/README.md for TZ=America/New_York
 * 0,4,16,26,36,46,56 8-22 * * *). Empty window costs 0 credits.
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
  parseRecordInstant,
} from '../lib/published-picks.js'
import { isMissingColumnError } from '../lib/grade-audit.js'
import {
  CLOSE_CAPTURE_PASS_NEAR_START,
  CLOSE_CAPTURE_RECOMMENDED_CRON,
  CLOSE_CAPTURE_ROUTINE_MINUTES,
  CLOSE_CAPTURE_STATUS_FAILED,
  CLOSE_CAPTURE_STATUS_OK,
  CLOSE_CAPTURE_STATUS_PARTIAL,
  applyPublishedCloseUpdate,
  buildEventOddsUrl,
  buildSportOddsUrl,
  capturedNflGameLineGameIds,
  classifyCloseCaptureGames,
  closeCapturePassForGame,
  clusterGameLineCloseTargets,
  gameLineClusterCommenceBounds,
  closeCapturePayload,
  closeCaptureRegionCount,
  closeCaptureRoutineMissesNearStart,
  closeUpdateRowCount,
  CLOSE_CAPTURE_DEFAULT_MIN_REMAINING,
  flattenEventOddsQuotes,
  formatCallsUsed,
  formatCloseCaptureCounts,
  formatCloseCaptureStatus,
  formatCreditsUsed,
  formatGameLineCloseCounts,
  gameLineCloseMarkets,
  isGameLineCloseSport,
  gameLineClosesForCaptureJob,
  gameLineClosesForSportEvent,
  gameLineMarketsAlreadyCaptured,
  groupCaptureJobsByOddsApiEventId,
  includeNflWindowGamesForGameLines,
  isNflSport,
  isOpsWriteQuietPeriod,
  isTargetedCloseCapturePick,
  shouldSkipLiveCloseOverwrite,
  shouldSkipPaidCloseCaptureFetch,
  loadExistingClosingOdds,
  marketsForCaptureJob,
  matchClosingQuote,
  matchSportOddsEvents,
  oddsApiSportKey,
  parseCloseCaptureRegions,
  probeOddsApiQuota,
  readCloseCaptureWindowConfig,
  readGameLineCloseDailyCreditCap,
  resetClosingOddsWriteGuard,
  setClosingOddsClock,
  selectCloseCaptureJobsWithinBudget,
  selectGameLineCloseTargets,
  selectGameLineClustersWithinBudget,
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
  ODDS_BUDGET_GAME_LINE_CAP,
  ODDS_BUDGET_OK,
  sanitizeOddsApiError,
  sanitizedErrorMessage,
} from '../lib/odds-api-budget.js'

config({ path: '.env.local' })

const GAME_SELECT = 'id, sport, date, status, oddsApiEventId'
export const PICK_SELECT_BASE = [
  'id', 'propId', 'gameIdRef', 'playerName', 'propType', 'threshold',
  'prediction', 'odds', 'edge', 'qualityScore', 'sport', 'source',
  'status', 'notes',
].join(', ')
export const PICK_SELECT = `${PICK_SELECT_BASE}, closeOdds, closeCapturedAt`

/**
 * Re-capture a stored close only in this final pre-start window.
 * Hardcoded at 10 minutes. Separate from the near-start pass
 * (CLOSE_CAPTURE_NEAR_START_MINUTES / CLOSE_CAPTURE_NEAR_START_MINUTES env).
 */
export const ALREADY_CLOSED_RECAPTURE_MINUTES = 10

export function publishedCloseAlreadyStored(row) {
  return row?.closeOdds != null && Boolean(row?.closeCapturedAt)
}

export function shouldRecaptureStoredClose(game, now, minutes = ALREADY_CLOSED_RECAPTURE_MINUTES) {
  const start = parseRecordInstant(game?.date || game?.gameDate)
  const instant = now instanceof Date ? now : parseRecordInstant(now)
  if (!start || !instant) return false
  const leadMs = start.getTime() - instant.getTime()
  const windowMs = Number(minutes) * 60 * 1000
  return leadMs > 0 && leadMs <= windowMs
}

const KNOWN_FLAGS = new Set([
  '--dry-run', '--apply', '--help', '-h', '--max-calls', '--min-remaining',
  '--max-credits', '--nfl-all', '--game-lines', '--spreads',
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
    gameLines: args.includes('--game-lines'),
    spreads: args.includes('--spreads'),
    disabled: isClosingCaptureDisabled(env),
    unknown,
    invalidFlags,
  }
}

/** A per-game retry with no props is a game-line fetch, not a prop fetch. */
function isGameLineOnlyCaptureJob(job) {
  if ((job?.picks || []).length > 0) return false
  const markets = job?.markets || []
  if (!markets.length) return false
  return markets.every((market) => {
    const key = String(market || '').toLowerCase().trim()
    return key === 'h2h' || key === 'spreads' || key === 'totals'
  })
}

async function defaultFetchEventOdds({
  url,
  fetchImpl = fetch,
  budget,
  estimatedCredits,
  apiKey,
  gameLine = false,
  reservation = null,
} = {}) {
  const result = await fetchOddsApiJson(url, {
    fetchImpl,
    budget,
    estimatedCredits,
    apiKey,
    gameLine,
    reservation,
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
  now,
  clock,
  fetchEventOdds = defaultFetchEventOdds,
  probeQuota = probeOddsApiQuota,
  apiKey = process.env.ODDS_API_KEY,
  env = process.env,
  log = console,
  budget,
} = {}) {
  resetClosingOddsWriteGuard()
  const nowFn = typeof clock === 'function'
    ? clock
    : (now == null ? () => new Date() : () => (now instanceof Date ? now : new Date(now)))
  setClosingOddsClock(nowFn)
  const startedAt = nowFn()
  const args = parseCaptureClosesArgs(argv, env)
  const windowOpts = readCloseCaptureWindowConfig(env)
  const regions = parseCloseCaptureRegions(env)
  const regionCount = closeCaptureRegionCount(regions)
  const oddsBudget = budget || createOddsApiBudget({
    env,
    now: nowFn,
    log,
    apiKey,
    purpose: 'close-capture',
  })
  let skippedAlreadyClosed = 0
  const done = (result) => {
    const captured = result.captured ?? (result.updates?.length || 0)
    const skippedClosed = Number(result.skippedAlreadyClosed ?? skippedAlreadyClosed) || 0
    const skippedBudget = result.skippedBudgetCount
      ?? ((result.skippedBudget || result.skippedMaxCalls || result.skippedMaxCredits
        || result.skippedQuota || oddsBudget.status() === 'close_cap')
        ? Number(result.skippedBudgetCount) || 0
        : 0)
    const skippedQuietCount = Number(result.skippedQuietCount) || 0
    const skippedWindow = result.skippedWindow ?? 0
    const credits = result.creditsUsed ?? 0
    let captureStatus = result.captureStatus
    if (!captureStatus) {
      if (result.unknown || result.invalidFlags || result.missingSecret
        || (result.closeColumnsMissing && args.apply) || result.missingKey) {
        captureStatus = CLOSE_CAPTURE_STATUS_FAILED
      } else if (result.fetchErrors || result.writeErrors || result.skippedQuiet) {
        captureStatus = CLOSE_CAPTURE_STATUS_PARTIAL
      } else {
        captureStatus = CLOSE_CAPTURE_STATUS_OK
      }
    }
    log.log(formatCloseCaptureStatus(captureStatus))
    log.log(formatCloseCaptureCounts({
      captured,
      skippedBudget,
      skippedQuiet: skippedQuietCount,
      skippedWindow,
      credits,
    }))
    log.log(`SKIPPED_ALREADY_CLOSED=${skippedClosed}`)
    if (captureStatus !== CLOSE_CAPTURE_STATUS_OK) {
      log.log(`⚠️ ${formatCloseCaptureStatus(captureStatus)} — treat as WARN in routine reports (exit 0)`)
    }
    emitOddsBudgetStatus(oddsBudget.status(), log)
    log.log(formatOddsCreditsUsed(oddsBudget.runCredits()))
    log.log(formatOddsCreditsRemaining(oddsBudget.remaining()))
    if (result.plannedCredits != null || result.creditsUsed != null) {
      log.log(formatCreditsUsed(result.creditsUsed ?? 0))
    }
    log.log(formatCallsUsed(result.calls ?? 0))
    return {
      ...result,
      exitCode: 0,
      captureStatus,
      captured,
      skippedBudgetCount: skippedBudget,
      skippedQuietCount,
      skippedWindow,
      skippedAlreadyClosed: skippedClosed,
      creditsUsed: credits,
    }
  }
  if (args.help) {
    log.log(`Usage: node scripts/capture-published-closes.js [--dry-run|--apply] [--nfl-all] [--game-lines] [--spreads] [--max-calls N] [--max-credits N] [--min-remaining N]

Dry-run (default): list in-window Published and shadow-published picks.
NHL shares this --max-calls budget; NFL jobs run first so a busy NHL
slate cannot exhaust the cap before later NFL closes.
--apply or CLV_APPLY=1: one Odds API call per oddsApiEventId.
Early pass writes closeOdds only where closeOdds IS NULL. Near-start
pass overwrites that close and upserts clvclose: ClosingOdds rows.
Requires ODDS_API_KEY + SUPABASE_SECRET_KEY (SUPABASE_REQUIRE_SECRET_KEY=1).
         Do not run from CI. Anon/public keys are refused.
--nfl-all: also target every pending NFL prop without a close
(Published bar ignored) and merge h2h/spreads/totals onto that same
per-game call. Prop markets also request the matching *_alternate
key so alternate-line picks can match the exact recorded threshold.
Game-line closes write to ClosingOdds. Near-start upserts on id
(ClosingOdds TEXT PK / onConflict: id) — no duplicates. SQL 008 is
not required for that upsert.
--game-lines: today's EdgeSnapshot moneyline/total edges for NFL, NHL,
and MLB in the same windows. One sport-level /odds call per
start-time cluster (h2h,totals; --spreads adds spreads; same region
as morning fetch). Writes clvclose: ClosingOdds rows, quoted_at from
last_update. Prop jobs are planned and fetched first and keep the
shared ODDS_CLOSE_CAPTURE_DAILY_CAP.
Absent --nfl-all, only Published picks' markets are requested.
--game-lines does not add h2h/spreads/totals onto those prop calls.
ODDS_GAME_LINE_CLOSE_DAILY_CAP (default 12 credits) is stored on the
ET-day ledger. ODDS_CLOSE_CAPTURE_PROP_HEADROOM (default 28) is the
part of the 40 capture slots game lines must leave for later props.
PowerShell: prefer npm run capture:published-closes:apply or
            npm run capture:published-closes:nfl-all:apply.
            $env:CLV_APPLY=1 stays set for later plain runs.
CLOSING_CAPTURE=0 disables the job. --max-calls caps HTTP calls
(including the /v4/sports quota probe). --max-credits caps
markets × regions and stops before exceeding, soonest
kickoff first when --nfl-all. ODDS_CLOSE_CAPTURE_DAILY_CAP
(default 40) caps paid event-odds captures per ET day.
Unknown flags and invalid/missing --max-calls / --max-credits /
--min-remaining values fail closed (status=failed, exit 0).
--min-remaining (default ${CLOSE_CAPTURE_DEFAULT_MIN_REMAINING}) stops when
Odds API remaining credits fall below the floor.
Windows: early T−${windowOpts.windowMinutes}..T−${windowOpts.nearStartMinutes};
near-start T−${windowOpts.nearStartMinutes}..T−1 (pre-start only).
No-ops during :05–:15 ET; a :00/:04 run re-checks before each write
and stops at :05. Does not start a paid fetch after :04:30 ET.
Schedule TZ=America/New_York
${CLOSE_CAPTURE_RECOMMENDED_CRON} after record-mlb-window-props
during 11–22. Empty window costs 0 credits (no Odds API calls).
:16/:46 11–22 misses :11–:16 kickoffs and London NFL 9:30 AM ET.
Every run prints CLOSE_CAPTURE_STATUS=ok|partial|failed and
CLOSE_CAPTURE_CAPTURED / CLOSE_CAPTURE_SKIPPED_BUDGET /
CLOSE_CAPTURE_SKIPPED_QUIET / CLOSE_CAPTURE_SKIPPED_WINDOW / CREDITS
(SKIPPED_BUDGET is cap/exhaustion only) and exits 0. Dry-run prints
planned HTTP calls including the quota
check, plus planned credits. CALLS_USED=<n> / CREDITS_USED=<n>.`)
    return done({ updates: [], calls: 0, help: true })
  }

  if (args.unknown.length) {
    log.error(`❌ Unknown argument(s): ${args.unknown.join(' ')}`)
    return done({
      updates: [],
      calls: 0,
      unknown: args.unknown,
      captureStatus: CLOSE_CAPTURE_STATUS_FAILED,
    })
  }
  if (args.invalidFlags.length) {
    log.error(`❌ Invalid or missing value for ${args.invalidFlags.join(', ')}`)
    return done({
      updates: [],
      calls: 0,
      invalidFlags: args.invalidFlags,
      captureStatus: CLOSE_CAPTURE_STATUS_FAILED,
    })
  }

  log.log(formatCaptureModeBanner(args.apply))

  if (args.disabled) {
    log.log('⏸️  CLOSING_CAPTURE=0 — close capture disabled.')
    return done({ updates: [], calls: 0, skippedDisabled: true })
  }

  if (isOpsWriteQuietPeriod(startedAt)) {
    log.log('⏸️  Ops quiet period (:05–:15 ET) — no close capture writes or Odds API calls.')
    return done({ updates: [], calls: 0, skippedQuiet: true })
  }

  let supabase
  try {
    assertCaptureSecretIsNotPublishable(env)
    supabase = createClient(captureSupabaseEnv(env))
  } catch (error) {
    log.error(`❌ ${sanitizedErrorMessage(error, apiKey)}`)
    return done({
      updates: [],
      calls: 0,
      missingSecret: true,
      captureStatus: CLOSE_CAPTURE_STATUS_FAILED,
    })
  }
  const horizon = new Date(startedAt.getTime() + windowOpts.windowMinutes * 60 * 1000)

  const { data: games, error: gameError } = await supabase
    .from('Game')
    .select(GAME_SELECT)
    .in('sport', CLOSE_CAPTURE_SPORTS)
    .gte('date', startedAt.toISOString())
    .lte('date', horizon.toISOString())

  if (gameError) {
    log.error(`❌ Game query failed: ${sanitizedErrorMessage(gameError, apiKey)}`)
    return done({
      updates: [],
      calls: 0,
      captureStatus: CLOSE_CAPTURE_STATUS_FAILED,
    })
  }

  const classified = classifyCloseCaptureGames(games || [], startedAt, windowOpts)
  const windowGames = [...classified.early, ...classified.nearStart]
  const gamesById = new Map(windowGames.map((game) => [game.id, game]))
  const passByGameId = new Map([
    ...classified.early.map((game) => [game.id, 'early']),
    ...classified.nearStart.map((game) => [game.id, CLOSE_CAPTURE_PASS_NEAR_START]),
  ])
  const skippedWindow = classified.skippedWindow.length
  if (windowGames.length === 0) {
    log.log('✅ No games in the close-capture window.')
    return done({
      updates: [],
      calls: 0,
      openPicks: [],
      windowGames: [],
      skippedWindow,
    })
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

  async function loadGameLineEdges(client, gameIds) {
    const ids = [...new Set((gameIds || []).filter(Boolean))]
    if (!ids.length) return { rows: [], error: null }
    const page = await paginateSupabaseSelect(() => client
      .from('EdgeSnapshot')
      .select('id, gameId, edgeMlHome, edgeMlAway, edgeTotalO, edgeTotalU, ts')
      .in('gameId', ids)
      .order('ts', { ascending: false })
      .order('id', { ascending: true }))
    if (page.error) return { rows: page.rows, error: page.error }
    return { rows: page.rows, error: null }
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
    log.error(`❌ Pick query failed: ${sanitizedErrorMessage(pickPage.error, apiKey)}`)
    return done({
      updates: [],
      calls: 0,
      closeColumnsMissing,
      skippedWindow,
      captureStatus: CLOSE_CAPTURE_STATUS_FAILED,
    })
  }

  if (closeColumnsMissing && args.apply) {
    log.error('❌ --apply needs 007 SQL (closeOdds columns). Dry-run still works.')
    return done({
      updates: [],
      calls: 0,
      closeColumnsMissing,
      skippedWindow,
      captureStatus: CLOSE_CAPTURE_STATUS_FAILED,
    })
  }

  const openPicks = (pickPage.rows || []).filter((row) => {
    if (!gamesById.has(row.gameIdRef)) return false
    const game = gamesById.get(row.gameIdRef)
    if (publishedCloseAlreadyStored(row) && !shouldRecaptureStoredClose(game, startedAt)) {
      skippedAlreadyClosed += 1
      return false
    }
    const overwrite = passByGameId.get(row.gameIdRef) === CLOSE_CAPTURE_PASS_NEAR_START
    return isTargetedCloseCapturePick(row, { nflAll: args.nflAll, overwrite })
  })

  const closingOddsGameIds = []
  if (args.nflAll) {
    closingOddsGameIds.push(
      ...windowGames.filter((game) => isNflSport(game.sport)).map((game) => game.id),
    )
  }
  if (args.gameLines) {
    closingOddsGameIds.push(
      ...windowGames.filter((game) => isGameLineCloseSport(game.sport)).map((game) => game.id),
    )
  }
  let existingClosingOdds = []
  if (closingOddsGameIds.length) {
    const loaded = await loadExistingClosingOdds(supabase, closingOddsGameIds)
    if (loaded.error) {
      log.log(`⚠️ ClosingOdds read failed (${sanitizedErrorMessage(loaded.error, apiKey)}); planning game-line fetches without a skip list.`)
    } else {
      existingClosingOdds = loaded.rows
    }
  }
  const capturedGameIds = capturedNflGameLineGameIds(
    classified.early.filter((game) => isNflSport(game.sport)),
    existingClosingOdds,
  )

  const byGame = includeNflWindowGamesForGameLines(new Map(), classified.early, {
    nflAll: args.nflAll,
    capturedGameIds,
  })
  for (const pick of openPicks) {
    const list = byGame.get(pick.gameIdRef) || []
    list.push(pick)
    byGame.set(pick.gameIdRef, list)
  }

  const groupedJobs = groupCaptureJobsByOddsApiEventId(byGame, gamesById).map((job) => ({
    ...job,
    pass: (job.gameIds || [job.gameId]).some(
      (id) => passByGameId.get(id) === CLOSE_CAPTURE_PASS_NEAR_START,
    )
      ? CLOSE_CAPTURE_PASS_NEAR_START
      : 'early',
  }))
  const allJobs = sortCloseCaptureJobs(groupedJobs, { nflAll: args.nflAll })
  const remainingCaptures = oddsBudget.remainingCloseCaptures?.()
  const budgeted = selectCloseCaptureJobsWithinBudget(allJobs, {
    nflAll: args.nflAll,
    maxCalls: args.maxCalls,
    maxCredits: args.maxCredits,
    maxCaptures: remainingCaptures,
    regions,
    gameLinesCapturedByGameId: capturedGameIds,
  })
  const captureJobs = budgeted.jobs
  const plannedCalls = budgeted.plannedCalls
  const plannedCredits = budgeted.plannedCredits
  const skippedBudgetCount = Math.max(0, allJobs.filter((job) => job.eventId).length - captureJobs.length)
  const gameLineMarkets = gameLineCloseMarkets({ spreads: args.spreads && args.gameLines })
  const gameLineCap = readGameLineCloseDailyCreditCap(env)
  let gameLinePlan = {
    clusters: [],
    plannedCalls,
    plannedCredits,
    gameLineCredits: 0,
    skipped: 0,
  }
  if (args.gameLines) {
    const edgeGameIds = windowGames
      .filter((game) => isGameLineCloseSport(game.sport))
      .map((game) => game.id)
    const edgePage = await loadGameLineEdges(supabase, edgeGameIds)
    if (edgePage.error) {
      log.error(`❌ EdgeSnapshot query failed: ${sanitizedErrorMessage(edgePage.error, apiKey)}`)
      return done({
        updates: [],
        calls: 0,
        skippedWindow,
        captureStatus: CLOSE_CAPTURE_STATUS_FAILED,
      })
    }
    const targets = selectGameLineCloseTargets(
      windowGames,
      edgePage.rows,
      startedAt,
      windowOpts,
    )
    const coveredByProp = new Set()
    for (const job of captureJobs) {
      const requested = new Set((job.markets || []).map((market) => String(market).toLowerCase()))
      if (!gameLineMarkets.every((market) => requested.has(market))) continue
      for (const id of job.gameIds || [job.gameId]) {
        if (id) coveredByProp.add(id)
      }
    }
    const fetchable = targets.filter((target) => {
      if (coveredByProp.has(target.game.id)) return false
      if (target.pass === CLOSE_CAPTURE_PASS_NEAR_START) return true
      return !gameLineMarketsAlreadyCaptured(target.game, existingClosingOdds, gameLineMarkets)
    })
    const clusters = clusterGameLineCloseTargets(fetchable, {
      windowMinutes: windowOpts.windowMinutes,
    })
    const propsPlanned = captureJobs.length > 0
    const gameLineCreditsLeft = oddsBudget.remainingGameLineCredits?.() ?? gameLineCap
    const gameLineSlotsLeft = Math.max(
      0,
      (oddsBudget.remainingGameLineSlots?.() ?? remainingCaptures ?? 0) - captureJobs.length,
    )
    gameLinePlan = selectGameLineClustersWithinBudget(clusters, {
      markets: gameLineMarkets,
      regions,
      maxCalls: args.maxCalls,
      maxCredits: args.maxCredits,
      maxCaptures: remainingCaptures,
      maxGameLineCredits: gameLineCreditsLeft,
      maxGameLineSlots: gameLineSlotsLeft,
      callsAlready: propsPlanned ? plannedCalls : 0,
      creditsAlready: propsPlanned ? plannedCredits : 0,
      capturesAlready: captureJobs.length,
      includeQuota: !propsPlanned,
    })
  }
  const gameLineClusters = gameLinePlan.clusters
  const reportedCalls = gameLinePlan.plannedCalls
  const reportedCredits = gameLinePlan.plannedCredits
  const skippedBudgetTotal = skippedBudgetCount + (gameLinePlan.skipped || 0)

  log.log('\n📸 PUBLISHED CLOSE CAPTURE')
  log.log('='.repeat(60))
  log.log(
    `Windows: early T−${windowOpts.windowMinutes}..T−${windowOpts.nearStartMinutes}; `
    + `near-start T−${windowOpts.nearStartMinutes}..T−1 (pre-start only)`,
  )
  log.log(`Games in window: ${windowGames.length} (early=${classified.early.length} near-start=${classified.nearStart.length})`)
  if (closeCaptureRoutineMissesNearStart({
    routineMinutes: CLOSE_CAPTURE_ROUTINE_MINUTES,
    nearStartMinutes: windowOpts.nearStartMinutes,
    minLeadMinutes: windowOpts.nearStartMinLeadMinutes,
  })) {
    log.log(
      `⚠️ :16/:46 ET cadence misses most T−10..T−1 kickoffs (:11–:16 quiet). `
      + `Recommended: TZ=America/New_York ${CLOSE_CAPTURE_RECOMMENDED_CRON}`,
    )
  }
  log.log(
    args.nflAll
      ? `Published + shadow + pending NFL props in window: ${openPicks.length}`
      : `Published + shadow picks in window: ${openPicks.length}`,
  )
  if (args.nflAll) {
    log.log('NFL-all: pending props + h2h/spreads/totals (one call per game)')
    log.log('Near-start upserts clvclose: rows on id (ClosingOdds PK / onConflict: id); no duplicates.')
  }
  log.log(`Odds API HTTP calls this run: ${reportedCalls}`)
  log.log(`Odds API credits this run: ${reportedCredits} (markets × regions=${regionCount})`)
  log.log(`Daily capture cap remaining: ${remainingCaptures ?? '?'} (ODDS_CLOSE_CAPTURE_DAILY_CAP)`)
  log.log(`1 HTTP call per game. Credits = markets × regions (${regions.join(',')}), not the morning 10-market slate.`)
  if (args.gameLines) {
    log.log(
      `GAME LINES: ${gameLineClusters.length} sport call(s), markets=${gameLineMarkets.join(',')}, `
      + `${gameLinePlan.creditCost ?? gameLineMarkets.length * regionCount} credit(s) each. `
      + `Daily cap ${gameLineCap} credits left ${oddsBudget.remainingGameLineCredits?.() ?? gameLineCap} `
      + `(ODDS_GAME_LINE_CLOSE_DAILY_CAP, persisted). `
      + `Prop headroom ${oddsBudget.config?.closeCapturePropHeadroom ?? ''} slots `
      + `(ODDS_CLOSE_CAPTURE_PROP_HEADROOM). NFL prop jobs are planned first.`,
    )
  }

  if (captureJobs.length === 0 && gameLineClusters.length === 0) {
    if (args.maxCalls != null && args.maxCalls <= 0) {
      log.log(`⏸️  --max-calls ${args.maxCalls} reached. No Odds API calls.`)
      return done({
        updates: [],
        calls: 0,
        creditsUsed: 0,
        plannedCalls: reportedCalls,
        plannedCredits: reportedCredits,
        skippedMaxCalls: true,
        skippedBudgetCount: skippedBudgetTotal,
        skippedWindow,
      })
    }
    if (args.maxCredits != null && args.maxCredits <= 0) {
      log.log(`⏸️  --max-credits ${args.maxCredits} reached. No Odds API calls.`)
      return done({
        updates: [],
        calls: 0,
        creditsUsed: 0,
        plannedCalls: reportedCalls,
        plannedCredits: reportedCredits,
        skippedMaxCredits: true,
        skippedBudgetCount: skippedBudgetTotal,
        skippedWindow,
      })
    }
    if (remainingCaptures != null && remainingCaptures <= 0) {
      log.log(`⏸️  ODDS_CLOSE_CAPTURE_DAILY_CAP reached. No Odds API calls.`)
      return done({
        updates: [],
        calls: 0,
        creditsUsed: 0,
        plannedCalls: reportedCalls,
        plannedCredits: reportedCredits,
        skippedBudget: true,
        skippedBudgetCount: skippedBudgetTotal,
        skippedWindow,
      })
    }
    if ((gameLinePlan.skipped || 0) > 0) {
      log.log('⏸️  Game-line clusters did not fit the remaining call, credit, capture, or daily game-line budget. No Odds API calls.')
      return done({
        updates: [],
        calls: 0,
        creditsUsed: 0,
        plannedCalls: reportedCalls,
        plannedCredits: reportedCredits,
        skippedBudget: true,
        skippedBudgetCount: skippedBudgetTotal,
        skippedWindow,
        gameLineClusters,
      })
    }
    log.log('✅ Nothing to capture.')
    return done({
      updates: [],
      calls: 0,
      creditsUsed: 0,
      plannedCalls: reportedCalls,
      plannedCredits: reportedCredits,
      openPicks,
      captureJobs,
      skippedBudgetCount: skippedBudgetTotal,
      skippedWindow,
      gameLineClusters,
    })
  }

  if (args.dryRun) {
    for (const job of captureJobs) {
      log.log(
        `  would fetch ${job.gameIds.join(',')}  pass=${job.pass || 'early'}  event=${job.eventId || 'UNMAPPED'}  `
        + `markets=${(job.markets || marketsForCaptureJob(job, {
          nflAll: args.nflAll,
          gameLinesCaptured: job.pass === CLOSE_CAPTURE_PASS_NEAR_START
            ? false
            : capturedGameIds.has(job.gameId),
        })).join(',') || '—'}  `
        + `picks=${job.picks.length}  credits=${job.creditCost ?? ''}`,
      )
    }
    for (const cluster of gameLineClusters) {
      log.log(
        `  would fetch sport=${cluster.sportKey || cluster.sport} games=${cluster.gameIds.join(',')} `
        + `markets=${(cluster.markets || gameLineMarkets).join(',')} credits=${cluster.creditCost ?? ''}`,
      )
    }
    log.log('\n💡 Dry-run only. Pass --apply after 007 SQL to write closes.')
    return done({
      updates: [],
      calls: 0,
      creditsUsed: 0,
      plannedCalls: reportedCalls,
      plannedCredits: reportedCredits,
      openPicks,
      byGame,
      captureJobs,
      skippedBudgetCount: skippedBudgetTotal,
      skippedWindow,
      gameLineClusters,
    })
  }

  if (!apiKey) {
    log.error('❌ ODDS_API_KEY missing. Dry-run does not need it; --apply does.')
    return done({
      updates: [],
      calls: 0,
      missingKey: true,
      skippedWindow,
      captureStatus: CLOSE_CAPTURE_STATUS_FAILED,
    })
  }

  const updates = []
  let skippedWindowDuringRun = 0
  let calls = 0
  let creditsUsed = 0
  let lastQuota = { remaining: null, used: null, last: null }
  let fetchErrors = 0
  let writeErrors = 0
  let skippedBudgetDuringRun = 0
  if (args.maxCalls != null && args.maxCalls <= 0) {
    log.log(`⏸️  --max-calls ${args.maxCalls} reached. No Odds API calls.`)
    return done({
      updates: [],
      calls: 0,
      creditsUsed: 0,
      skippedMaxCalls: true,
      skippedBudgetCount,
      skippedWindow,
    })
  }
  try {
    lastQuota = await probeQuota({ apiKey }) || lastQuota
    oddsBudget.record(lastQuota, { credits: lastQuota.last ?? 0, isProbe: true })
    calls += 1
  } catch (error) {
    calls += 1
    log.log(`⚠️ Quota probe failed (${sanitizedErrorMessage(error, apiKey)}); continuing without a pre-check.`)
  }
  if (lastQuota.remaining != null && lastQuota.remaining < args.minRemaining) {
    log.log(
      `⏸️  Odds API remaining ${lastQuota.remaining} < min-remaining ${args.minRemaining}. `
      + 'No event-odds calls.',
    )
    return done({
      updates: [],
      calls,
      lastQuota,
      skippedQuota: true,
      skippedBudgetCount: skippedBudgetCount || captureJobs.length,
      skippedWindow,
    })
  }
  if (oddsBudget.status() !== ODDS_BUDGET_OK) {
    log.log(`⏸️  ${formatOddsBudgetStatus(oddsBudget.status())}`)
    const warn = formatOddsBudgetWarnLine(oddsBudget.status())
    if (warn) log.log(warn)
    return done({
      updates: [],
      calls,
      creditsUsed: 0,
      lastQuota,
      skippedBudget: true,
      skippedBudgetCount: skippedBudgetCount || captureJobs.length,
      skippedWindow,
    })
  }

  const gameLineWrites = []
  let skippedQuietDuringRun = false
  let skippedQuietCount = 0
  const markQuietStop = (jobIndex) => {
    skippedQuietDuringRun = true
    skippedQuietCount += captureJobs.length - jobIndex
  }
  for (let jobIndex = 0; jobIndex < captureJobs.length; jobIndex += 1) {
    const job = captureJobs[jobIndex]
    if (isOpsWriteQuietPeriod(nowFn())) {
      log.log('⏸️  Ops quiet period (:05–:15 ET) — stopping before further writes.')
      markQuietStop(jobIndex)
      break
    }
    if (shouldSkipPaidCloseCaptureFetch(nowFn())) {
      log.log('⏸️  After :04:30 ET — not starting a paid fetch that quiet :05 would block.')
      markQuietStop(jobIndex)
      break
    }
    const game = job.game
    if (!closeCapturePassForGame(game, nowFn(), windowOpts)) {
      log.log(`  skip ${job.gameIds.join(',')}: no longer in the close window`)
      skippedWindowDuringRun += 1
      continue
    }
    const sportKey = oddsApiSportKey(game?.sport)
    const label = job.gameIds.join(',')
    const overwrite = job.pass === CLOSE_CAPTURE_PASS_NEAR_START
    if (!job.eventId || !sportKey) {
      log.log(`  skip ${label}: no Odds API event id`)
      continue
    }
    const markets = job.markets || marketsForCaptureJob(job, {
      nflAll: args.nflAll,
      gameLinesCaptured: overwrite ? false : capturedGameIds.has(job.gameId),
    })
    if (markets.length === 0) {
      log.log(`  skip ${label}: no mapped markets`)
      continue
    }
    const jobCredits = job.creditCost ?? (markets.length * regionCount)
    if (args.maxCalls != null && calls >= args.maxCalls) {
      log.log(`⏸️  --max-calls ${args.maxCalls} reached. Stopping.`)
      skippedBudgetDuringRun += 1
      break
    }
    if (args.maxCredits != null && creditsUsed + jobCredits > args.maxCredits) {
      log.log(`⏸️  --max-credits ${args.maxCredits} reached. Stopping.`)
      skippedBudgetDuringRun += 1
      break
    }
    if (lastQuota.remaining != null && lastQuota.remaining < args.minRemaining) {
      log.log(
        `⏸️  Odds API remaining ${lastQuota.remaining} < min-remaining ${args.minRemaining}. Stopping.`,
      )
      skippedBudgetDuringRun += 1
      break
    }
    const gameLineOnly = isGameLineOnlyCaptureJob(job)
    const budgetExtra = gameLineOnly
      ? { captures: 1, gameLineCredits: jobCredits }
      : { captures: 1 }
    if (gameLineOnly && jobCredits > (oddsBudget.remainingGameLineCredits?.() ?? jobCredits)) {
      log.log(`⏸️  ${formatOddsBudgetStatus(ODDS_BUDGET_GAME_LINE_CAP)}`)
      const warn = formatOddsBudgetWarnLine(ODDS_BUDGET_GAME_LINE_CAP)
      if (warn) log.log(warn)
      skippedBudgetDuringRun += 1
      continue
    }
    if (!oddsBudget.allow(jobCredits, budgetExtra)) {
      log.log(`⏸️  ${formatOddsBudgetStatus(oddsBudget.status())}`)
      const warn = formatOddsBudgetWarnLine(oddsBudget.status())
      if (warn) log.log(warn)
      skippedBudgetDuringRun += 1
      if (gameLineOnly && oddsBudget.status() === ODDS_BUDGET_GAME_LINE_CAP) continue
      break
    }

    if (shouldSkipPaidCloseCaptureFetch(nowFn())) {
      log.log(
        `⏸️  skipped ${label} paid fetch after :04:30 ET (quiet :05 would block the write)`,
      )
      markQuietStop(jobIndex)
      break
    }
    const url = buildEventOddsUrl({
      sportKey,
      eventId: job.eventId,
      markets,
      apiKey,
      regions,
    })
    calls += 1
    creditsUsed += jobCredits
    let payload
    try {
      payload = await fetchEventOdds({
        url,
        budget: oddsBudget,
        estimatedCredits: jobCredits,
        apiKey,
        gameLine: gameLineOnly,
      })
      if (payload?.skipped) {
        log.log(`⏸️  ${formatOddsBudgetStatus(oddsBudget.status())}`)
        const warn = formatOddsBudgetWarnLine(oddsBudget.status())
        if (warn) log.log(warn)
        skippedBudgetDuringRun += 1
        break
      }
      if (payload?.quota) lastQuota = payload.quota
      if (!payload?.budgetRecorded) {
        const spent = payload?.quota?.last ?? jobCredits
        oddsBudget.record(payload?.quota || {}, {
          credits: spent,
          captures: 1,
          gameLineCredits: gameLineOnly ? spent : 0,
        })
      }
    } catch (error) {
      fetchErrors += 1
      const safe = sanitizeOddsApiError(error, apiKey)
      log.error(`  ❌ ${label}: ${safe?.message || ''}`)
      continue
    }

    if (args.nflAll && isNflSport(game?.sport)) {
      const liveSkip = overwrite
        ? shouldSkipLiveCloseOverwrite({ payload: payload.data, now: nowFn() })
        : null
      if (liveSkip) {
        log.log(`  skipped ${label} near-start game-line overwrite: ${liveSkip}`)
      } else {
        const gameLineRows = gameLineClosesForCaptureJob(job, payload.data, nowFn(), {
          log,
          skipLiveOverwrite: overwrite,
        })
        if (isOpsWriteQuietPeriod(nowFn())) {
          log.log('⏸️  Ops quiet period (:05–:15 ET) — stopping before further writes.')
          markQuietStop(jobIndex)
          break
        }
        const writtenLines = await writeGameLineCloses(supabase, gameLineRows, {
          gamesById,
          overwrite,
        })
        if (writtenLines.error) {
          writeErrors += 1
          const failedNote = writtenLines.failed
            ? ` (${writtenLines.failed} row(s) not captured)`
            : ''
          log.error(`  ❌ ClosingOdds ${label}: ${sanitizedErrorMessage(writtenLines.error, apiKey)}${failedNote}`)
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
    }

    const quotes = flattenEventOddsQuotes(payload.data)
    for (const pick of job.picks) {
      const quote = matchClosingQuote(pick, quotes)
      if (!quote) {
        log.log(`  no quote ${pick.id} ${pick.playerName} ${pick.propType}`)
        continue
      }
      const liveSkip = overwrite
        ? shouldSkipLiveCloseOverwrite({ payload: payload.data, quote, now: nowFn() })
        : null
      if (liveSkip) {
        log.log(`  skipped ${pick.id} near-start overwrite: ${liveSkip}`)
        continue
      }
      const patch = closeCapturePayload(quote, nowFn())
      if (!patch || patch.closeOdds == null) {
        log.log(`  skipped ${pick.id} unconvertible close price`)
        continue
      }
      if (isOpsWriteQuietPeriod(nowFn())) {
        log.log('⏸️  Ops quiet period (:05–:15 ET) — stopping before further writes.')
        markQuietStop(jobIndex)
        break
      }
      const write = await updateWithOptionalCloseOdds(
        (body) => applyPublishedCloseUpdate(
          supabase.from('PropValidation'),
          pick.id,
          body,
          { overwrite },
        ),
        patch,
      )
      if (write?.error) {
        writeErrors += 1
        log.error(`  ❌ write ${pick.id}: ${sanitizedErrorMessage(write.error, apiKey)}`)
        continue
      }
      const written = closeUpdateRowCount(write)
      if (written === 0) {
        log.log(
          overwrite
            ? `  skipped ${pick.id} close not written (overwrite matched 0 rows)`
            : `  skipped ${pick.id} already captured (closeOdds present)`,
        )
        continue
      }
      updates.push({ id: pick.id, ...patch, pass: job.pass })
      const booksNote = overwrite && patch.closeNumBooks != null
        ? `, books=${patch.closeNumBooks}`
        : ''
      log.log(
        `  ✅ ${pick.id} ${pick.playerName} ${pick.propType} `
        + `${overwrite ? 'updated' : 'recorded'} ${pick.odds} → close ${patch.closeOdds} `
        + `(${quote.book}${booksNote})`,
      )
    }
    if (skippedQuietDuringRun) break
  }

  if (args.gameLines && !skippedQuietDuringRun && !skippedBudgetDuringRun) {
    for (let clusterIndex = 0; clusterIndex < gameLineClusters.length; clusterIndex += 1) {
      const cluster = gameLineClusters[clusterIndex]
      const dueTargets = (cluster.targets || []).filter((target) => (
        closeCapturePassForGame(target.game, nowFn(), windowOpts)
      ))
      if (!dueTargets.length) {
        log.log(`  skip game lines ${cluster.gameIds.join(',')}: no longer in the close window`)
        skippedWindowDuringRun += 1
        continue
      }
      if (isOpsWriteQuietPeriod(nowFn())) {
        log.log('⏸️  Ops quiet period (:05–:15 ET) — stopping before further writes.')
        skippedQuietDuringRun = true
        skippedQuietCount += gameLineClusters.length - clusterIndex
        break
      }
      if (shouldSkipPaidCloseCaptureFetch(nowFn())) {
        log.log('⏸️  After :04:30 ET — not starting a paid fetch that quiet :05 would block.')
        skippedQuietDuringRun = true
        skippedQuietCount += gameLineClusters.length - clusterIndex
        break
      }
      const sportKey = cluster.sportKey
      const label = cluster.gameIds.join(',')
      if (!sportKey) {
        log.log(`  skip game lines ${label}: no Odds API sport key`)
        continue
      }
      const clusterCredits = cluster.creditCost ?? (gameLineMarkets.length * regionCount)
      if (args.maxCalls != null && calls >= args.maxCalls) {
        log.log(`⏸️  --max-calls ${args.maxCalls} reached. Stopping.`)
        skippedBudgetDuringRun += 1
        break
      }
      if (args.maxCredits != null && creditsUsed + clusterCredits > args.maxCredits) {
        log.log(`⏸️  --max-credits ${args.maxCredits} reached. Stopping.`)
        skippedBudgetDuringRun += 1
        break
      }
      if (lastQuota.remaining != null && lastQuota.remaining < args.minRemaining) {
        log.log(
          `⏸️  Odds API remaining ${lastQuota.remaining} < min-remaining ${args.minRemaining}. Stopping.`,
        )
        skippedBudgetDuringRun += 1
        break
      }
      const reservation = typeof oddsBudget.reserve === 'function'
        ? oddsBudget.reserve(clusterCredits, {
          captures: 1,
          gameLineCredits: clusterCredits,
        })
        : { ok: oddsBudget.allow(clusterCredits, { captures: 1, gameLineCredits: clusterCredits }) }
      if (!reservation?.ok) {
        log.log(`⏸️  ${formatOddsBudgetStatus(reservation?.status || oddsBudget.status())}`)
        const warn = formatOddsBudgetWarnLine(reservation?.status || oddsBudget.status())
        if (warn) log.log(warn)
        skippedBudgetDuringRun += 1
        break
      }
      const bounds = gameLineClusterCommenceBounds(dueTargets)
      const url = buildSportOddsUrl({
        sportKey,
        markets: cluster.markets || gameLineMarkets,
        apiKey,
        regions,
        commenceTimeFrom: bounds.commenceTimeFrom,
        commenceTimeTo: bounds.commenceTimeTo,
      })
      calls += 1
      creditsUsed += clusterCredits
      let payload
      try {
        payload = await fetchEventOdds({
          url,
          budget: oddsBudget,
          estimatedCredits: clusterCredits,
          apiKey,
          gameLine: true,
          reservation,
        })
        if (payload?.skipped) {
          log.log(`⏸️  ${formatOddsBudgetStatus(oddsBudget.status())}`)
          const warn = formatOddsBudgetWarnLine(oddsBudget.status())
          if (warn) log.log(warn)
          skippedBudgetDuringRun += 1
          break
        }
        if (payload?.quota) lastQuota = payload.quota
        if (!payload?.budgetRecorded && typeof oddsBudget.reconcile === 'function') {
          oddsBudget.reconcile(reservation, payload?.quota || {}, {
            credits: payload?.quota?.last ?? clusterCredits,
          })
        } else if (!payload?.budgetRecorded) {
          oddsBudget.record(payload?.quota || {}, {
            credits: payload?.quota?.last ?? clusterCredits,
            captures: 1,
            gameLineCredits: clusterCredits,
          })
        }
      } catch (error) {
        fetchErrors += 1
        const safe = sanitizeOddsApiError(error, apiKey)
        log.error(`  ❌ game lines ${label}: ${safe?.message || ''}`)
        continue
      }
      const events = Array.isArray(payload.data) ? payload.data : []
      const { matched, unmatched } = matchSportOddsEvents(events, dueTargets)
      const pendingWrites = [
        ...matched.map((target) => ({ target, event: target.event })),
        ...unmatched.map((target) => ({ target, event: null })),
      ]
      for (const item of pendingWrites) {
        if (!closeCapturePassForGame(item.target.game, nowFn(), windowOpts)) {
          log.log(`  skip ${item.target.game.id}: left the close window before write`)
          skippedWindowDuringRun += 1
          continue
        }
        const overwrite = closeCapturePassForGame(item.target.game, nowFn(), windowOpts) === CLOSE_CAPTURE_PASS_NEAR_START
        const rows = item.event
          ? gameLineClosesForSportEvent(item.event, item.target.game, nowFn(), {
            markets: cluster.markets || gameLineMarkets,
            log,
            skipLiveOverwrite: overwrite,
          })
          : gameLineClosesForSportEvent(null, item.target.game, nowFn(), {
            markets: cluster.markets || gameLineMarkets,
            log,
          })
        if (isOpsWriteQuietPeriod(nowFn())) {
          log.log('⏸️  Ops quiet period (:05–:15 ET) — stopping before further writes.')
          skippedQuietDuringRun = true
          skippedQuietCount += 1
          break
        }
        const writtenLines = await writeGameLineCloses(supabase, rows, {
          gamesById,
          overwrite,
        })
        if (writtenLines.error) {
          writeErrors += 1
          const failedNote = writtenLines.failed
            ? ` (${writtenLines.failed} row(s) not captured)`
            : ''
          log.error(`  ❌ ClosingOdds ${item.target.game.id}: ${sanitizedErrorMessage(writtenLines.error, apiKey)}${failedNote}`)
        }
        log.log(formatGameLineCloseCounts({
          label: item.target.game.id,
          proposed: rows.length,
          inserted: writtenLines.inserted,
          skipped: writtenLines.skipped,
          failed: writtenLines.failed,
        }))
        if (writtenLines.inserted > 0) {
          gameLineWrites.push(...(writtenLines.rows || []))
        }
      }
      if (skippedQuietDuringRun) break
    }
  }

  if (lastQuota.remaining != null) {
    log.log(`📊 Odds API remaining: ${lastQuota.remaining} (used ${lastQuota.used ?? '?'})`)
  }
  log.log(`Captured ${updates.length} close(s) with ${calls} HTTP call(s).`)
  return done({
    updates,
    calls,
    creditsUsed,
    lastQuota,
    plannedCalls: reportedCalls,
    plannedCredits: reportedCredits,
    gameLineWrites,
    captureJobs,
    gameLineClusters,
    fetchErrors,
    writeErrors,
    skippedBudgetCount: skippedBudgetTotal + skippedBudgetDuringRun,
    skippedWindow: skippedWindow + skippedWindowDuringRun,
    skippedQuiet: skippedQuietDuringRun || undefined,
    skippedQuietCount,
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
    console.error('Fatal:', sanitizedErrorMessage(error, process.env.ODDS_API_KEY))
    console.log(formatCloseCaptureStatus(CLOSE_CAPTURE_STATUS_FAILED))
    console.log(formatCloseCaptureCounts({}))
    console.log(formatCallsUsed(0))
    process.exit(0)
  })
}
