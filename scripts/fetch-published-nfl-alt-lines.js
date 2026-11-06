#!/usr/bin/env node
/**
 * Alternate-line shop for Published NFL player props.
 *
 * Selects open Published-cohort NFL rows (never shadow-published, never
 * unpublished pending archive) whose games commence after T−35.
 * Groups by oddsApiEventId and fetches only the official *_alternate
 * markets those picks need (event-odds, regions=us).
 *
 * Informational only. Does not rewrite PropValidation.odds / closeOdds
 * and does not change CLV (entry vs consensus close). Writes
 * PlayerPropCache.altQuotes when 012 is applied. A name-match miss
 * still persists the ladder on that pick's propId (existing row, or a
 * thin alt-only insert). Events with nowhere to write are not fetched.
 *
 * Separate from morning fetch (Published slate is not known then) and
 * from snapshot / close-capture routines (those stay unchanged).
 *
 *   node scripts/fetch-published-nfl-alt-lines.js            # dry-run
 *   node scripts/fetch-published-nfl-alt-lines.js --dry-run
 *   node scripts/fetch-published-nfl-alt-lines.js --apply
 *   npm run fetch:nfl-alt-lines:apply
 *   NFL_ALT_APPLY=1 node scripts/fetch-published-nfl-alt-lines.js
 *
 * Caps: ODDS_NFL_ALT_DAILY_CREDITS default 48, enforced at job
 * selection (soonest kickoff first) against today's persisted spend.
 * Overlapping applies share the #87 exclusive lockfile (owner token,
 * stale after 15 min, re-read before delete). Re-selects under the
 * lock against freshly read spend and records spend per call.
 * Goes through lib/odds-api-budget.js (credit log, daily/monthly,
 * remaining floor 3,000). Purpose is nfl-alt, not close-capture, so
 * the close reserve still holds. Refuses to start :04:30–:15 ET so
 * setup SELECTs cannot run in the window. Re-checks quiet before
 * each cache write. ODDS_NFL_ALT=0 disables. ODDS_NFL_ALT_DAILY_CREDITS=0
 * also disables. Requires the secret key for --apply. Do not run
 * --apply from CI. Degrades on PGRST204 / 42703 if 012 is not applied.
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
  applyShadowPublishedNotesExclusion,
} from '../lib/published-picks.js'
import { isPreStartStatus } from '../lib/game-status.js'
import {
  CLOSE_CAPTURE_DEFAULT_MIN_REMAINING,
  buildEventOddsUrl,
  creditCostForMarkets,
  flattenEventOddsQuotes,
  formatCallsUsed,
  groupCaptureJobsByOddsApiEventId,
  isOpsWriteQuietPeriod,
  oddsApiSportKey,
  probeOddsApiQuota,
  shouldSkipPaidCloseCaptureFetch,
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
import {
  acquireSnapshotPassLock,
  shouldRefuseSnapshotStart,
  shouldSkipCloseCaptureWindow,
  snapshotKickoffFloor,
} from '../lib/odds-snapshot.js'
import {
  NFL_ALT_REGIONS,
  NFL_ALT_STATUS_FAILED,
  NFL_ALT_STATUS_OK,
  NFL_ALT_STATUS_PARTIAL,
  classifyNflAltJobs,
  eventCanPersistAltQuotes,
  formatNflAltEventLine,
  nflAltPersistStatus,
  planAltQuotesForEvent,
  writeAltQuoteRow,
  formatNflAltCredits,
  formatNflAltEvents,
  formatNflAltStatus,
  isMissingAltQuoteColumnError,
  isNflAltDisabled,
  isNflAltEligiblePick,
  latestAltStampByGameId,
  loadNflAltDayState,
  readNflAltConfig,
  recordNflAltSpend,
  remainingNflAltCredits,
  saveHeldNflAltRows,
  selectNflAltJobs,
} from '../lib/nfl-alt-lines.js'

config({ path: '.env.local' })

const GAME_SELECT = 'id, sport, date, status, oddsApiEventId'
const PICK_SELECT = [
  'id', 'propId', 'gameIdRef', 'playerName', 'propType', 'threshold',
  'prediction', 'odds', 'edge', 'qualityScore', 'sport', 'source',
  'status', 'notes',
].join(', ')
const CACHE_SELECT = 'id, propId, gameId, playerName, type, pick, altQuotes, altQuoteUpdatedAt'
const CACHE_SELECT_NO_ALT = 'id, propId, gameId, playerName, type, pick'

const KNOWN_FLAGS = new Set([
  '--dry-run', '--apply', '--help', '-h', '--max-credits', '--min-remaining',
])
const FLAGS_WITH_VALUE = new Set(['--max-credits', '--min-remaining'])

function parseNonNegIntFlag(args, flag) {
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

export function formatNflAltModeBanner(apply) {
  return apply ? 'MODE: APPLY' : 'MODE: DRY-RUN'
}

export function nflAltSupabaseEnv(env = process.env) {
  return {
    ...env,
    [SUPABASE_REQUIRE_SECRET_ENV]: '1',
  }
}

export function assertNflAltSecretIsNotPublishable(env = process.env) {
  const preferred = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (isPublishableSupabaseKey(preferred)) {
    throw new Error(
      'SUPABASE_SECRET_KEY is a publishable/anon key. Use the secret or service_role key.',
    )
  }
  return preferred
}

export function unknownNflAltArgs(argv = []) {
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

export function parseNflAltArgs(argv = [], env = process.env) {
  const args = Array.isArray(argv) ? argv : []
  const dryRunFlag = args.includes('--dry-run')
  const applyFlag = args.includes('--apply') || envFlagEnabled(env.NFL_ALT_APPLY)
  const minRemainingFlag = parseNonNegIntFlag(args, '--min-remaining')
  const maxCredits = parseNonNegIntFlag(args, '--max-credits')
  const envMinRemaining = Number(env.ODDS_NFL_ALT_MIN_REMAINING)
  const unknown = unknownNflAltArgs(args)
  const invalidFlags = [
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
    minRemaining,
    maxCredits: maxCredits.present ? maxCredits.value : null,
    disabled: isNflAltDisabled(env),
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

export async function runFetchPublishedNflAltLines({
  argv = process.argv.slice(2),
  createClient = createScriptSupabaseClient,
  now = new Date(),
  clock,
  fetchEventOdds = defaultFetchEventOdds,
  probeQuota = probeOddsApiQuota,
  apiKey = process.env.ODDS_API_KEY,
  env = process.env,
  log = console,
  budget,
  dayState,
  persistDays,
  acquirePassLock = acquireSnapshotPassLock,
} = {}) {
  const nowFn = typeof clock === 'function'
    ? clock
    : () => (now instanceof Date ? now : new Date(now))
  const startedAt = nowFn()
  const args = parseNflAltArgs(argv, env)
  const altConfig = readNflAltConfig(env)
  const persist = persistDays != null
    ? persistDays
    : !env.JEST_WORKER_ID && env.NODE_ENV !== 'test'
  const loadedDays = dayState || loadNflAltDayState({
    persistPath: altConfig.persistPath,
    persist,
  })
  const creditsLeft = remainingNflAltCredits(loadedDays, startedAt, altConfig.dailyCredits)
  const oddsBudget = budget || createOddsApiBudget({
    env,
    now: startedAt,
    log,
    apiKey,
    purpose: 'nfl-alt',
  })

  const done = (result) => {
    const events = result.events ?? (result.altJobs?.length || 0)
    const credits = result.creditsUsed ?? 0
    const calls = result.calls ?? 0
    let nflAltStatus = result.nflAltStatus
    if (!nflAltStatus) {
      if (result.unknown || result.invalidFlags || result.missingSecret
        || result.missingKey) {
        nflAltStatus = NFL_ALT_STATUS_FAILED
      } else if (result.fetchErrors || result.writeErrors || result.skippedQuiet
        || result.skippedLock || result.columnsMissing) {
        nflAltStatus = NFL_ALT_STATUS_PARTIAL
      } else {
        nflAltStatus = NFL_ALT_STATUS_OK
      }
    }
    nflAltStatus = nflAltPersistStatus({
      creditsUsed: credits,
      persistedRows: result.persistedRows ?? 0,
      unmatchedPicks: result.unmatchedPicks || [],
      baseStatus: nflAltStatus,
    })
    log.log(formatNflAltStatus(nflAltStatus))
    log.log(formatNflAltEvents(events))
    log.log(formatCallsUsed(calls))
    log.log(formatNflAltCredits(credits))
    if (nflAltStatus !== NFL_ALT_STATUS_OK) {
      log.log(`⚠️ ${formatNflAltStatus(nflAltStatus)} — treat as WARN in routine reports (exit 0)`)
    }
    emitOddsBudgetStatus(oddsBudget.status(), log)
    log.log(formatOddsCreditsUsed(oddsBudget.runCredits()))
    log.log(formatOddsCreditsRemaining(oddsBudget.remaining()))
    return {
      ...result,
      exitCode: 0,
      nflAltStatus,
      events,
      creditsUsed: credits,
      calls,
    }
  }

  if (args.help) {
    log.log(`Usage: node scripts/fetch-published-nfl-alt-lines.js [--dry-run|--apply] [--max-credits N] [--min-remaining N]

Dry-run (default): list future Published NFL picks that would get alt lines.
--apply or NFL_ALT_APPLY=1: one Odds API event-odds call per event
(regions=us, only the official *_alternate markets those picks need).
Requires ODDS_API_KEY + SUPABASE_SECRET_KEY (SUPABASE_REQUIRE_SECRET_KEY=1).
Do not run from CI. Anon/public keys are refused.
Never fetches shadow-published or unpublished pending archive.
Never requests NHL/MLB alternate keys. Kickoff must be after T−35.
Skips events whose altQuotes are <${altConfig.freshMinutes} min old.
Daily credit cap ${altConfig.dailyCredits} (ODDS_NFL_ALT_DAILY_CREDITS),
enforced at job selection under an exclusive lock. Goes through the
shared credit budget (daily / monthly / remaining floor 3,000).
Purpose is nfl-alt, so the close reserve still holds. Refuses to
start :04:30–:15 ET. Re-checks quiet before each cache write.
ODDS_NFL_ALT=0 disables. Informational only — CLV stays entry vs close.
Unknown flags fail closed (status=failed, exit 0).
Every run prints NFL_ALT_STATUS=ok|partial|failed,
NFL_ALT_EVENTS, CALLS_USED, CREDITS and exits 0.`)
    return done({ altJobs: [], calls: 0, help: true })
  }

  if (args.unknown.length) {
    log.error(`❌ Unknown argument(s): ${args.unknown.join(' ')}`)
    return done({
      altJobs: [],
      calls: 0,
      unknown: args.unknown,
      nflAltStatus: NFL_ALT_STATUS_FAILED,
    })
  }
  if (args.invalidFlags.length) {
    log.error(`❌ Invalid or missing value for ${args.invalidFlags.join(', ')}`)
    return done({
      altJobs: [],
      calls: 0,
      invalidFlags: args.invalidFlags,
      nflAltStatus: NFL_ALT_STATUS_FAILED,
    })
  }

  log.log(formatNflAltModeBanner(args.apply))

  if (args.disabled) {
    log.log('⏸️  ODDS_NFL_ALT=0 — NFL alt-line shop disabled.')
    return done({ altJobs: [], calls: 0, skippedDisabled: true })
  }

  if (altConfig.dailyCredits === 0) {
    log.log('⏸️  ODDS_NFL_ALT_DAILY_CREDITS=0 — NFL alt-line shop disabled.')
    return done({ altJobs: [], calls: 0, skippedDisabled: true })
  }

  if (shouldRefuseSnapshotStart(startedAt)) {
    log.log('⏸️  Alt-line quiet window (:04:30–:15 ET) — no setup queries or Odds API calls.')
    return done({ altJobs: [], calls: 0, skippedQuiet: true })
  }

  let supabase
  try {
    assertNflAltSecretIsNotPublishable(env)
    supabase = createClient(nflAltSupabaseEnv(env))
  } catch (error) {
    log.error(`❌ ${error.message}`)
    return done({
      altJobs: [],
      calls: 0,
      missingSecret: true,
      nflAltStatus: NFL_ALT_STATUS_FAILED,
    })
  }

  const horizon = new Date(startedAt.getTime() + altConfig.horizonHours * 60 * 60 * 1000)
  const kickoffFloor = snapshotKickoffFloor(startedAt)

  async function loadPublishedPicks() {
    return paginateSupabaseSelect(() => applyShadowPublishedNotesExclusion(
      supabase
        .from('PropValidation')
        .select(PICK_SELECT)
        .eq('source', PUBLISHED_STATS_PREFILTER.source)
        .eq('status', 'pending')
        .eq('sport', 'nfl')
        .gt('edge', PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
        .gte('qualityScore', PUBLISHED_STATS_PREFILTER.minQuality)
        .order('id', { ascending: true }),
    ))
  }

  const pickPage = await loadPublishedPicks()
  if (pickPage.error) {
    log.error(`❌ Pick query failed: ${pickPage.error.message}`)
    return done({
      altJobs: [],
      calls: 0,
      nflAltStatus: NFL_ALT_STATUS_FAILED,
    })
  }

  const publishedPicks = (pickPage.rows || []).filter(isNflAltEligiblePick)
  const gameIds = [...new Set(publishedPicks.map((pick) => pick.gameIdRef).filter(Boolean))]
  if (gameIds.length === 0) {
    log.log('✅ No Published NFL picks to shop alt lines for.')
    return done({ altJobs: [], calls: 0, openPicks: [] })
  }

  const { data: games, error: gameError } = await supabase
    .from('Game')
    .select(GAME_SELECT)
    .in('id', gameIds)
    .gt('date', kickoffFloor.toISOString())
    .lte('date', horizon.toISOString())

  if (gameError) {
    log.error(`❌ Game query failed: ${gameError.message}`)
    return done({
      altJobs: [],
      calls: 0,
      nflAltStatus: NFL_ALT_STATUS_FAILED,
    })
  }

  const futureGames = (games || []).filter((game) => (
    isPreStartStatus(game?.status)
    && !shouldSkipCloseCaptureWindow(game, startedAt)
  ))
  const gamesById = new Map(futureGames.map((game) => [game.id, game]))
  const openPicks = publishedPicks.filter((pick) => gamesById.has(pick.gameIdRef))
  const skippedWindowGames = (games || []).filter((game) => (
    isPreStartStatus(game?.status) && shouldSkipCloseCaptureWindow(game, startedAt)
  ))

  const byGame = new Map()
  for (const pick of openPicks) {
    const list = byGame.get(pick.gameIdRef) || []
    list.push(pick)
    byGame.set(pick.gameIdRef, list)
  }

  let columnsMissing = false
  let cacheRows = []
  let cachePage = await paginateSupabaseSelect(() => supabase
    .from('PlayerPropCache')
    .select(CACHE_SELECT)
    .in('gameId', [...gamesById.keys(), '__none__']))
  if (cachePage.error && isMissingAltQuoteColumnError(cachePage.error)) {
    columnsMissing = true
    log.log('⚠️ PlayerPropCache alt columns missing (run 012 SQL). Degrading — no crash.')
    cachePage = await paginateSupabaseSelect(() => supabase
      .from('PlayerPropCache')
      .select(CACHE_SELECT_NO_ALT)
      .in('gameId', [...gamesById.keys(), '__none__']))
  }
  if (cachePage.error) {
    log.log(`⚠️ PlayerPropCache read failed (${cachePage.error.message}); planning without freshness skips.`)
  } else {
    cacheRows = cachePage.rows || []
  }

  if (columnsMissing && args.apply) {
    log.log('⚠️ --apply needs 012 SQL (altQuotes). Skipping paid fetches.')
    return done({
      altJobs: [],
      calls: 0,
      columnsMissing: true,
      openPicks,
      skippedWindow: skippedWindowGames.length,
    })
  }

  const latestAltQuotes = latestAltStampByGameId(cacheRows)
  const grouped = groupCaptureJobsByOddsApiEventId(byGame, gamesById)
  const classified = classifyNflAltJobs(grouped, {
    now: startedAt,
    freshMinutes: altConfig.freshMinutes,
    latestAltQuotes,
  })
  const creditCap = args.maxCredits != null
    ? Math.min(args.maxCredits, creditsLeft)
    : creditsLeft
  let selected = selectNflAltJobs(classified.fetchable, { maxCredits: creditCap })
  let altJobs = selected.jobs.map((job) => ({
    ...job,
    creditCost: creditCostForMarkets(job.markets.length, NFL_ALT_REGIONS.length),
  }))

  if (shouldRefuseSnapshotStart(nowFn())) {
    log.log('⏸️  Alt-line quiet window (:04:30–:15 ET) — aborting after setup, before fetch.')
    return done({
      altJobs: [],
      events: 0,
      calls: 0,
      skippedQuiet: true,
      nflAltStatus: NFL_ALT_STATUS_PARTIAL,
    })
  }

  const plannedCredits = altJobs.reduce((sum, job) => sum + (job.creditCost || 0), 0)
  const plannedCalls = altJobs.length === 0 ? 0 : 1 + altJobs.length

  log.log('\n🏈 PUBLISHED NFL ALT LINES')
  log.log('='.repeat(60))
  log.log(`Published NFL picks in horizon: ${openPicks.length}`)
  log.log(`Events planned: ${altJobs.length}`)
  log.log(`Alt-line credits left today: ${creditsLeft} / ${altConfig.dailyCredits}`)
  log.log(`Odds API HTTP calls this run: ${plannedCalls}`)
  log.log(`Odds API credits this run: ${plannedCredits} (markets × regions=us)`)
  log.log('1 HTTP call per event. Informational only — CLV stays entry vs close.')

  if (creditsLeft <= 0) {
    log.log('⏸️  ODDS_NFL_ALT_DAILY_CREDITS reached. No Odds API calls.')
    return done({
      altJobs: [],
      calls: 0,
      creditsUsed: 0,
      skippedCap: true,
      skippedWindow: skippedWindowGames.length,
      skippedFresh: classified.skippedFresh.length,
    })
  }

  if (altJobs.length === 0) {
    log.log('✅ Nothing to fetch.')
    return done({
      altJobs: [],
      calls: 0,
      creditsUsed: 0,
      plannedCalls,
      plannedCredits,
      openPicks,
      skippedWindow: skippedWindowGames.length,
      skippedFresh: classified.skippedFresh.length,
      skippedCap: selected.skippedCap.length,
    })
  }

  if (args.dryRun) {
    for (const job of altJobs) {
      log.log(
        `  would fetch ${job.gameIds.join(',')}  event=${job.eventId || 'UNMAPPED'}  `
        + `markets=${(job.markets || []).join(',') || '—'}  `
        + `picks=${job.picks.length}  credits=${job.creditCost ?? ''}`,
      )
    }
    log.log('\n💡 Dry-run only. Pass --apply after 012 SQL to write altQuotes.')
    return done({
      altJobs,
      events: altJobs.length,
      calls: 0,
      creditsUsed: 0,
      plannedCalls,
      plannedCredits,
      openPicks,
      skippedWindow: skippedWindowGames.length,
      skippedFresh: classified.skippedFresh.length,
      skippedCap: selected.skippedCap.length,
    })
  }

  if (!apiKey) {
    log.error('❌ ODDS_API_KEY missing. Dry-run does not need it; --apply does.')
    return done({
      altJobs,
      calls: 0,
      missingKey: true,
      nflAltStatus: NFL_ALT_STATUS_FAILED,
    })
  }

  const lock = acquirePassLock({
    persistPath: altConfig.persistPath,
    persist,
  })
  if (!lock.acquired) {
    log.log('⏸️  NFL alt-line lock held. Skipping overlapping run.')
    return done({
      altJobs,
      events: altJobs.length,
      calls: 0,
      skippedLock: true,
      nflAltStatus: NFL_ALT_STATUS_PARTIAL,
    })
  }

  let calls = 0
  let creditsUsed = 0
  let lastQuota = { remaining: null, used: null, last: null }
  let fetchErrors = 0
  let writeErrors = 0
  let skippedBudgetDuringRun = 0
  let skippedQuietDuringRun = false
  const updates = []
  const unmatchedPicks = []
  let liveDays = loadedDays

  try {
    liveDays = persist
      ? loadNflAltDayState({ persistPath: altConfig.persistPath, persist })
      : loadedDays
    const lockedLeft = remainingNflAltCredits(liveDays, startedAt, altConfig.dailyCredits)
    const lockedCap = args.maxCredits != null
      ? Math.min(args.maxCredits, lockedLeft)
      : lockedLeft
    selected = selectNflAltJobs(classified.fetchable, { maxCredits: lockedCap })
    altJobs = selected.jobs.map((job) => ({
      ...job,
      creditCost: creditCostForMarkets(job.markets.length, NFL_ALT_REGIONS.length),
    }))

    if (lockedLeft <= 0) {
      log.log('⏸️  ODDS_NFL_ALT_DAILY_CREDITS reached. No Odds API calls.')
      return done({
        altJobs: [],
        calls: 0,
        creditsUsed: 0,
        skippedCap: true,
      })
    }

    if (altJobs.length === 0) {
      log.log('✅ Nothing to fetch under the lock.')
      return done({
        altJobs: [],
        calls: 0,
        creditsUsed: 0,
        skippedCap: selected.skippedCap.length,
      })
    }

    try {
      lastQuota = await probeQuota({ apiKey }) || lastQuota
      oddsBudget.record(lastQuota, { credits: lastQuota.last ?? 0, isProbe: true })
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
      return done({
        altJobs,
        calls,
        lastQuota,
        skippedQuota: true,
      })
    }
    if (oddsBudget.status() !== ODDS_BUDGET_OK) {
      log.log(`⏸️  ${formatOddsBudgetStatus(oddsBudget.status())}`)
      const warn = formatOddsBudgetWarnLine(oddsBudget.status())
      if (warn) log.log(warn)
      return done({
        altJobs,
        calls,
        creditsUsed: 0,
        lastQuota,
        skippedBudget: true,
      })
    }

    for (let jobIndex = 0; jobIndex < altJobs.length; jobIndex += 1) {
      const job = altJobs[jobIndex]
      if (isOpsWriteQuietPeriod(nowFn())) {
        log.log('⏸️  Ops quiet period (:05–:15 ET) — stopping before further writes.')
        skippedQuietDuringRun = true
        break
      }
      if (shouldSkipPaidCloseCaptureFetch(nowFn())) {
        log.log('⏸️  After :04:30 ET — not starting a paid fetch that quiet :05 would block.')
        skippedQuietDuringRun = true
        break
      }
      const sportKey = oddsApiSportKey(job.game?.sport)
      if (!job.eventId || !sportKey || !job.markets.length) {
        log.log(`  ⏭️  ${job.gameIds.join(',')} unmapped or no markets`)
        continue
      }
      const gameCachePreview = cacheRows.filter((row) => job.gameIds.includes(row.gameId))
      if (!eventCanPersistAltQuotes(job, gameCachePreview)) {
        log.log(`  ⏭️  ${job.gameIds.join(',')} no alt write target — skip fetch (0 credits)`)
        continue
      }
      const estimatedCredits = creditCostForMarkets(job.markets.length, NFL_ALT_REGIONS.length)
      liveDays = persist
        ? loadNflAltDayState({ persistPath: altConfig.persistPath, persist })
        : liveDays
      if (remainingNflAltCredits(liveDays, startedAt, altConfig.dailyCredits) < estimatedCredits) {
        log.log('⏸️  ODDS_NFL_ALT_DAILY_CREDITS reached. No further Odds API calls.')
        break
      }
      const url = buildEventOddsUrl({
        sportKey,
        eventId: job.eventId,
        markets: job.markets,
        apiKey,
        regions: NFL_ALT_REGIONS,
      })
      let fetched
      try {
        fetched = await fetchEventOdds({
          url,
          budget: oddsBudget,
          estimatedCredits,
          apiKey,
        })
      } catch (error) {
        fetchErrors += 1
        log.log(`  ❌ ${job.gameIds.join(',')} fetch failed: ${error.message}`)
        continue
      }
      if (fetched?.skipped) {
        skippedBudgetDuringRun += 1
        log.log(`  ⏸️  ${job.gameIds.join(',')} skipped by budget`)
        break
      }
      if (fetched?.quota) {
        lastQuota = { ...lastQuota, ...fetched.quota }
      }
      calls += 1
      creditsUsed += estimatedCredits
      liveDays = recordNflAltSpend(
        persist
          ? loadNflAltDayState({ persistPath: altConfig.persistPath, persist })
          : liveDays,
        estimatedCredits,
        startedAt,
        {
          persistPath: altConfig.persistPath,
          persist,
        },
      )
      const quotes = flattenEventOddsQuotes(fetched?.data)
      const gameCache = cacheRows.filter((row) => job.gameIds.includes(row.gameId))
      const planned = planAltQuotesForEvent(job, gameCache, quotes, {
        maxLines: altConfig.maxLines,
        now: nowFn(),
      })
      log.log(formatNflAltEventLine(job, planned))
      unmatchedPicks.push(...planned.unmatchedPicks)
      updates.push(...planned.rows)
    }

    let wrote = 0
    if (updates.length) {
      const seen = new Set()
      const pending = []
      for (const row of updates) {
        const key = row.id || row.propId
        if (!key || seen.has(key)) continue
        seen.add(key)
        pending.push(row)
      }
      for (let i = 0; i < pending.length; i += 1) {
        if (isOpsWriteQuietPeriod(nowFn())) {
          skippedQuietDuringRun = true
          const remaining = pending.slice(i)
          const held = saveHeldNflAltRows(remaining, {
            persistPath: altConfig.persistPath,
            persist,
            now: nowFn(),
          })
          log.log(held
            ? `⏸️  Quiet window before write — held ${remaining.length} row(s) at ${held}.`
            : `⏸️  Quiet window before write — dropping ${remaining.length} row(s).`)
          break
        }
        const row = pending[i]
        const write = await writeAltQuoteRow(supabase, row)
        if (write?.columnMissing || write?.skipped) {
          columnsMissing = true
          log.log('⚠️ PlayerPropCache alt columns missing on write (run 012 SQL). Degrading — no crash.')
          break
        }
        if (write?.error) {
          writeErrors += 1
          log.error(`❌ PlayerPropCache altQuotes update failed: ${write.error.message}`)
        } else {
          wrote += 1
        }
      }
      if (!columnsMissing && !writeErrors && !skippedQuietDuringRun) {
        log.log(`✅ Wrote altQuotes on ${wrote} PlayerPropCache row(s).`)
      }
    } else {
      log.log('✅ No matching alt quotes to write.')
    }

    return done({
      altJobs,
      events: altJobs.length,
      calls,
      creditsUsed,
      updates,
      persistedRows: wrote,
      unmatchedPicks,
      fetchErrors,
      writeErrors,
      skippedQuiet: skippedQuietDuringRun,
      skippedBudgetCount: skippedBudgetDuringRun,
      columnsMissing,
    })
  } finally {
    lock.release()
  }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runFetchPublishedNflAltLines().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    console.log(formatNflAltStatus(NFL_ALT_STATUS_FAILED))
    console.log(formatNflAltEvents(0))
    console.log(formatCallsUsed(0))
    console.log(formatNflAltCredits(0))
    process.exit(0)
  })
}
