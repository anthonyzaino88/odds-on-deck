#!/usr/bin/env node
/**
 * Midday / pregame price snapshots for Published picks only.
 *
 * Selects open Published-cohort rows (never shadow-published, never
 * unpublished pending archive) whose games commence in the future.
 * Groups by oddsApiEventId, fetches only those events and only the
 * markets those picks need (event-odds, regions=us).
 *
 * Informational only. Does not rewrite PropValidation.odds / closeOdds
 * and does not change CLV (entry vs consensus close). Never writes
 * source='close'. Skips games already inside the close-capture window.
 *
 *   node scripts/snapshot-published-odds.js            # dry-run (default)
 *   node scripts/snapshot-published-odds.js --dry-run
 *   node scripts/snapshot-published-odds.js --apply
 *   npm run snapshot:published-odds:apply
 *   SNAPSHOT_APPLY=1 node scripts/snapshot-published-odds.js
 *
 * Caps: max 2 passes / ET day and max 8 event-odds calls / pass
 * (ODDS_SNAPSHOT_DAILY_PASSES / ODDS_SNAPSHOT_MAX_EVENT_CALLS).
 * Goes through lib/odds-api-budget.js (credit log, daily/monthly,
 * remaining floor 3,000). Purpose is snapshot, not close-capture, so
 * the close reserve still holds. Refuses to start :04:30–:15 ET so
 * setup SELECTs cannot run in the window. Re-checks quiet before
 * insert. ODDS_SNAPSHOT=0 disables.
 * Requires the secret key for --apply. Do not run --apply from CI.
 * Degrades on 42P01 / PGRST204 / 42703 if 011 is not applied.
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
  PUBLISHED_SPORTS,
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
  SNAPSHOT_REGIONS,
  SNAPSHOT_SOURCE_CLOSE,
  SNAPSHOT_STATUS_FAILED,
  SNAPSHOT_STATUS_OK,
  SNAPSHOT_STATUS_PARTIAL,
  buildSnapshotRow,
  classifySnapshotJobs,
  formatSnapshotCredits,
  formatSnapshotEvents,
  formatSnapshotStatus,
  acquireSnapshotPassLock,
  isMissingOddsSnapshotError,
  isSnapshotDisabled,
  isSnapshotEligiblePick,
  latestStampByGameId,
  loadSnapshotPassState,
  marketsForSnapshotJob,
  readSnapshotPassConfig,
  recordSnapshotPass,
  remainingSnapshotPasses,
  sameLineQuotesForPick,
  saveHeldSnapshotRows,
  selectSnapshotJobs,
  shouldRefuseSnapshotStart,
  shouldSkipCloseCaptureWindow,
  snapshotKickoffFloor,
  snapshotSourceForKickoff,
} from '../lib/odds-snapshot.js'

config({ path: '.env.local' })

const GAME_SELECT = 'id, sport, date, status, oddsApiEventId'
const PICK_SELECT = [
  'id', 'propId', 'gameIdRef', 'playerName', 'propType', 'threshold',
  'prediction', 'odds', 'edge', 'qualityScore', 'sport', 'source',
  'status', 'notes',
].join(', ')

const KNOWN_FLAGS = new Set([
  '--dry-run', '--apply', '--help', '-h', '--max-calls', '--min-remaining',
  '--max-credits',
])
const FLAGS_WITH_VALUE = new Set(['--max-calls', '--min-remaining', '--max-credits'])

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

export function formatSnapshotModeBanner(apply) {
  return apply ? 'MODE: APPLY' : 'MODE: DRY-RUN'
}

export function snapshotSupabaseEnv(env = process.env) {
  return {
    ...env,
    [SUPABASE_REQUIRE_SECRET_ENV]: '1',
  }
}

export function assertSnapshotSecretIsNotPublishable(env = process.env) {
  const preferred = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (isPublishableSupabaseKey(preferred)) {
    throw new Error(
      'SUPABASE_SECRET_KEY is a publishable/anon key. Use the secret or service_role key.',
    )
  }
  return preferred
}

export function unknownSnapshotArgs(argv = []) {
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

export function parseSnapshotArgs(argv = [], env = process.env) {
  const args = Array.isArray(argv) ? argv : []
  const dryRunFlag = args.includes('--dry-run')
  const applyFlag = args.includes('--apply') || envFlagEnabled(env.SNAPSHOT_APPLY)
  const maxCalls = parseNonNegIntFlag(args, '--max-calls')
  const minRemainingFlag = parseNonNegIntFlag(args, '--min-remaining')
  const maxCredits = parseNonNegIntFlag(args, '--max-credits')
  const envMinRemaining = Number(env.ODDS_SNAPSHOT_MIN_REMAINING)
  const unknown = unknownSnapshotArgs(args)
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
    disabled: isSnapshotDisabled(env),
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

export async function runSnapshotPublishedOdds({
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
  passState,
  persistPasses,
  acquirePassLock = acquireSnapshotPassLock,
} = {}) {
  const nowFn = typeof clock === 'function'
    ? clock
    : () => (now instanceof Date ? now : new Date(now))
  const startedAt = nowFn()
  const args = parseSnapshotArgs(argv, env)
  const passConfig = readSnapshotPassConfig(env)
  const persist = persistPasses != null
    ? persistPasses
    : !env.JEST_WORKER_ID && env.NODE_ENV !== 'test'
  const loadedPasses = passState || loadSnapshotPassState({
    persistPath: passConfig.persistPath,
    persist,
  })
  const passesLeft = remainingSnapshotPasses(loadedPasses, startedAt, passConfig.dailyPasses)
  const oddsBudget = budget || createOddsApiBudget({
    env,
    now: startedAt,
    log,
    apiKey,
    purpose: 'snapshot',
  })

  const done = (result) => {
    const events = result.events ?? (result.snapshotJobs?.length || 0)
    const credits = result.creditsUsed ?? 0
    const calls = result.calls ?? 0
    let snapshotStatus = result.snapshotStatus
    if (!snapshotStatus) {
      if (result.unknown || result.invalidFlags || result.missingSecret
        || result.missingKey) {
        snapshotStatus = SNAPSHOT_STATUS_FAILED
      } else if (result.fetchErrors || result.writeErrors || result.skippedQuiet
        || result.tableMissing) {
        snapshotStatus = SNAPSHOT_STATUS_PARTIAL
      } else {
        snapshotStatus = SNAPSHOT_STATUS_OK
      }
    }
    log.log(formatSnapshotStatus(snapshotStatus))
    log.log(formatSnapshotEvents(events))
    log.log(formatCallsUsed(calls))
    log.log(formatSnapshotCredits(credits))
    if (snapshotStatus !== SNAPSHOT_STATUS_OK) {
      log.log(`⚠️ ${formatSnapshotStatus(snapshotStatus)} — treat as WARN in routine reports (exit 0)`)
    }
    emitOddsBudgetStatus(oddsBudget.status(), log)
    log.log(formatOddsCreditsUsed(oddsBudget.runCredits()))
    log.log(formatOddsCreditsRemaining(oddsBudget.remaining()))
    return {
      ...result,
      exitCode: 0,
      snapshotStatus,
      events,
      creditsUsed: credits,
      calls,
    }
  }

  if (args.help) {
    log.log(`Usage: node scripts/snapshot-published-odds.js [--dry-run|--apply] [--max-calls N] [--max-credits N] [--min-remaining N]

Dry-run (default): list future Published picks that would be snapshotted.
--apply or SNAPSHOT_APPLY=1: one Odds API event-odds call per event
(regions=us, only the markets those Published picks need).
Requires ODDS_API_KEY + SUPABASE_SECRET_KEY (SUPABASE_REQUIRE_SECRET_KEY=1).
Do not run from CI. Anon/public keys are refused.
Never snapshots shadow-published or unpublished pending archive.
Never writes source=close. Kickoff must be after T−35. Skips events
whose saved quotes are <90 min old. Max ${passConfig.dailyPasses}
passes / ET day, ${passConfig.maxEventCalls} event calls / pass, and
${passConfig.maxCreditsPerPass} credits / pass. Goes through the
shared credit budget (daily / monthly / remaining floor 3,000).
Purpose is snapshot, so the close reserve still holds. Refuses to
start :04:30–:15 ET. ODDS_SNAPSHOT=0 disables.
Unknown flags fail closed (status=failed, exit 0).
Every run prints SNAPSHOT_STATUS=ok|partial|failed,
SNAPSHOT_EVENTS, CALLS_USED, CREDITS and exits 0.`)
    return done({ snapshotJobs: [], calls: 0, help: true })
  }

  if (args.unknown.length) {
    log.error(`❌ Unknown argument(s): ${args.unknown.join(' ')}`)
    return done({
      snapshotJobs: [],
      calls: 0,
      unknown: args.unknown,
      snapshotStatus: SNAPSHOT_STATUS_FAILED,
    })
  }
  if (args.invalidFlags.length) {
    log.error(`❌ Invalid or missing value for ${args.invalidFlags.join(', ')}`)
    return done({
      snapshotJobs: [],
      calls: 0,
      invalidFlags: args.invalidFlags,
      snapshotStatus: SNAPSHOT_STATUS_FAILED,
    })
  }

  log.log(formatSnapshotModeBanner(args.apply))

  if (args.disabled) {
    log.log('⏸️  ODDS_SNAPSHOT=0 — published odds snapshots disabled.')
    return done({ snapshotJobs: [], calls: 0, skippedDisabled: true })
  }

  if (shouldRefuseSnapshotStart(startedAt)) {
    log.log('⏸️  Snapshot quiet window (:04:30–:15 ET) — no setup queries or Odds API calls.')
    return done({ snapshotJobs: [], calls: 0, skippedQuiet: true })
  }

  let supabase
  try {
    assertSnapshotSecretIsNotPublishable(env)
    supabase = createClient(snapshotSupabaseEnv(env))
  } catch (error) {
    log.error(`❌ ${error.message}`)
    return done({
      snapshotJobs: [],
      calls: 0,
      missingSecret: true,
      snapshotStatus: SNAPSHOT_STATUS_FAILED,
    })
  }

  const horizon = new Date(startedAt.getTime() + passConfig.horizonHours * 60 * 60 * 1000)
  const kickoffFloor = snapshotKickoffFloor(startedAt)

  async function loadPublishedPicks() {
    return paginateSupabaseSelect(() => applyShadowPublishedNotesExclusion(
      supabase
        .from('PropValidation')
        .select(PICK_SELECT)
        .eq('source', PUBLISHED_STATS_PREFILTER.source)
        .eq('status', 'pending')
        .in('sport', PUBLISHED_SPORTS)
        .gt('edge', PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
        .gte('qualityScore', PUBLISHED_STATS_PREFILTER.minQuality)
        .order('id', { ascending: true }),
    ))
  }

  const pickPage = await loadPublishedPicks()
  if (pickPage.error) {
    log.error(`❌ Pick query failed: ${pickPage.error.message}`)
    return done({
      snapshotJobs: [],
      calls: 0,
      snapshotStatus: SNAPSHOT_STATUS_FAILED,
    })
  }

  const publishedPicks = (pickPage.rows || []).filter(isSnapshotEligiblePick)
  const gameIds = [...new Set(publishedPicks.map((pick) => pick.gameIdRef).filter(Boolean))]
  if (gameIds.length === 0) {
    log.log('✅ No Published picks to snapshot.')
    return done({ snapshotJobs: [], calls: 0, openPicks: [] })
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
      snapshotJobs: [],
      calls: 0,
      snapshotStatus: SNAPSHOT_STATUS_FAILED,
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

  let tableMissing = false
  let latestSnapshots = new Map()
  const snapshotPage = await paginateSupabaseSelect(() => supabase
    .from('OddsSnapshot')
    .select('gameId, capturedAt')
    .in('gameId', [...gamesById.keys(), '__none__'])
    .order('capturedAt', { ascending: false }))
  if (snapshotPage.error && isMissingOddsSnapshotError(snapshotPage.error)) {
    tableMissing = true
    log.log('⚠️ OddsSnapshot missing (run 011 SQL). Degrading — no crash.')
  } else if (snapshotPage.error) {
    log.log(`⚠️ OddsSnapshot read failed (${snapshotPage.error.message}); planning without freshness skips.`)
  } else {
    latestSnapshots = latestStampByGameId(snapshotPage.rows)
  }

  if (tableMissing && args.apply) {
    log.log('⚠️ --apply needs 011 SQL (OddsSnapshot). Skipping paid fetches.')
    return done({
      snapshotJobs: [],
      calls: 0,
      tableMissing: true,
      openPicks,
      skippedWindow: skippedWindowGames.length,
    })
  }

  let latestCacheQuotes = new Map()
  const cacheSelect = 'gameId, quoteUpdatedAt, fetchedAt'
  let cachePage = await paginateSupabaseSelect(() => supabase
    .from('PlayerPropCache')
    .select(cacheSelect)
    .in('gameId', [...gamesById.keys(), '__none__']))
  if (cachePage.error && isMissingOddsSnapshotError(cachePage.error)) {
    cachePage = await paginateSupabaseSelect(() => supabase
      .from('PlayerPropCache')
      .select('gameId, fetchedAt')
      .in('gameId', [...gamesById.keys(), '__none__']))
  }
  if (!cachePage.error) {
    latestCacheQuotes = latestStampByGameId(
      (cachePage.rows || []).map((row) => ({
        gameId: row.gameId,
        capturedAt: row.quoteUpdatedAt || row.fetchedAt,
      })),
    )
  }

  const grouped = groupCaptureJobsByOddsApiEventId(byGame, gamesById).map((job) => ({
    ...job,
    markets: marketsForSnapshotJob(job),
    source: snapshotSourceForKickoff(job.game?.date, startedAt),
  }))
  const classified = classifySnapshotJobs(grouped, {
    now: startedAt,
    freshMinutes: passConfig.freshMinutes,
    latestSnapshots,
    latestCacheQuotes,
  })
  const selected = selectSnapshotJobs(classified.fetchable, {
    maxEventCalls: args.maxCalls != null
      ? Math.min(args.maxCalls, passConfig.maxEventCalls)
      : passConfig.maxEventCalls,
    maxCredits: args.maxCredits != null
      ? Math.min(args.maxCredits, passConfig.maxCreditsPerPass)
      : passConfig.maxCreditsPerPass,
  })
  const snapshotJobs = selected.jobs.map((job) => ({
    ...job,
    creditCost: creditCostForMarkets(job.markets.length, SNAPSHOT_REGIONS.length),
  }))

  const plannedCredits = snapshotJobs.reduce((sum, job) => sum + (job.creditCost || 0), 0)
  const plannedCalls = snapshotJobs.length === 0 ? 0 : 1 + snapshotJobs.length

  log.log('\n📸 PUBLISHED ODDS SNAPSHOT')
  log.log('='.repeat(60))
  log.log(`Published picks in horizon: ${openPicks.length}`)
  log.log(`Events planned: ${snapshotJobs.length} (cap ${passConfig.maxEventCalls}/pass)`)
  log.log(`Passes left today: ${passesLeft} / ${passConfig.dailyPasses}`)
  log.log(`Odds API HTTP calls this run: ${plannedCalls}`)
  log.log(`Odds API credits this run: ${plannedCredits} (markets × regions=us)`)
  log.log('1 HTTP call per event. Informational only — CLV stays entry vs close.')

  if (passesLeft <= 0) {
    log.log('⏸️  ODDS_SNAPSHOT_DAILY_PASSES reached. No Odds API calls.')
    return done({
      snapshotJobs: [],
      calls: 0,
      creditsUsed: 0,
      skippedPasses: true,
      skippedWindow: classified.skippedWindow.length + skippedWindowGames.length,
      skippedFresh: classified.skippedFresh.length,
    })
  }

  if (snapshotJobs.length === 0) {
    log.log('✅ Nothing to snapshot.')
    return done({
      snapshotJobs: [],
      calls: 0,
      creditsUsed: 0,
      plannedCalls,
      plannedCredits,
      openPicks,
      skippedWindow: classified.skippedWindow.length + skippedWindowGames.length,
      skippedFresh: classified.skippedFresh.length,
    })
  }

  if (args.dryRun) {
    for (const job of snapshotJobs) {
      log.log(
        `  would fetch ${job.gameIds.join(',')}  source=${job.source}  event=${job.eventId || 'UNMAPPED'}  `
        + `markets=${(job.markets || []).join(',') || '—'}  `
        + `picks=${job.picks.length}  credits=${job.creditCost ?? ''}`,
      )
    }
    log.log('\n💡 Dry-run only. Pass --apply after 011 SQL to write snapshots.')
    return done({
      snapshotJobs,
      events: snapshotJobs.length,
      calls: 0,
      creditsUsed: 0,
      plannedCalls,
      plannedCredits,
      openPicks,
      skippedWindow: classified.skippedWindow.length + skippedWindowGames.length,
      skippedFresh: classified.skippedFresh.length,
    })
  }

  if (!apiKey) {
    log.error('❌ ODDS_API_KEY missing. Dry-run does not need it; --apply does.')
    return done({
      snapshotJobs,
      calls: 0,
      missingKey: true,
      snapshotStatus: SNAPSHOT_STATUS_FAILED,
    })
  }

  const lock = acquirePassLock({
    persistPath: passConfig.persistPath,
    persist,
  })
  if (!lock.acquired) {
    log.log('⏸️  Snapshot pass lock held. Skipping overlapping run.')
    return done({
      snapshotJobs,
      events: snapshotJobs.length,
      calls: 0,
      skippedLock: true,
      snapshotStatus: SNAPSHOT_STATUS_PARTIAL,
    })
  }

  let calls = 0
  let creditsUsed = 0
  let lastQuota = { remaining: null, used: null, last: null }
  let fetchErrors = 0
  let writeErrors = 0
  let skippedBudgetDuringRun = 0
  let skippedQuietDuringRun = false
  const rows = []

  try {
    const lockedState = persist
      ? loadSnapshotPassState({ persistPath: passConfig.persistPath, persist })
      : loadedPasses
    if (remainingSnapshotPasses(lockedState, startedAt, passConfig.dailyPasses) <= 0) {
      log.log('⏸️  ODDS_SNAPSHOT_DAILY_PASSES reached. No Odds API calls.')
      return done({
        snapshotJobs: [],
        calls: 0,
        creditsUsed: 0,
        skippedPasses: true,
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
        snapshotJobs,
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
        snapshotJobs,
        calls,
        creditsUsed: 0,
        lastQuota,
        skippedBudget: true,
      })
    }

    let paidCalls = 0
    for (let jobIndex = 0; jobIndex < snapshotJobs.length; jobIndex += 1) {
      const job = snapshotJobs[jobIndex]
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
      const url = buildEventOddsUrl({
        sportKey,
        eventId: job.eventId,
        markets: job.markets,
        apiKey,
        regions: SNAPSHOT_REGIONS,
      })
      const estimatedCredits = creditCostForMarkets(job.markets.length, SNAPSHOT_REGIONS.length)
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
      calls += 1
      creditsUsed += estimatedCredits
      paidCalls += 1
      const quotes = flattenEventOddsQuotes(fetched?.data)
      const capturedAt = nowFn()
      const source = snapshotSourceForKickoff(job.game?.date, capturedAt)
      if (source === SNAPSHOT_SOURCE_CLOSE) continue
      for (const pick of job.picks) {
        const { match, quotes: lineQuotes } = sameLineQuotesForPick(pick, quotes)
        if (!match) {
          log.log(`  ⏭️  ${pick.playerName} ${pick.propType} — no same-line quote`)
          continue
        }
        const row = buildSnapshotRow({
          pick,
          game: job.game,
          match,
          quotes: lineQuotes,
          capturedAt,
          source,
        })
        if (row) rows.push(row)
      }
    }

    if (paidCalls > 0) {
      recordSnapshotPass(lockedState, startedAt, {
        persistPath: passConfig.persistPath,
        persist,
      })
    }

    if (rows.length) {
      if (isOpsWriteQuietPeriod(nowFn())) {
        skippedQuietDuringRun = true
        const held = saveHeldSnapshotRows(rows, {
          persistPath: passConfig.persistPath,
          persist,
          now: nowFn(),
        })
        log.log(held
          ? `⏸️  Quiet window before insert — held ${rows.length} row(s) at ${held}.`
          : `⏸️  Quiet window before insert — dropping ${rows.length} row(s).`)
      } else {
        const write = await supabase.from('OddsSnapshot').insert(rows)
        if (write?.error && isMissingOddsSnapshotError(write.error)) {
          tableMissing = true
          log.log('⚠️ OddsSnapshot missing on write (run 011 SQL). Degrading — no crash.')
        } else if (write?.error) {
          writeErrors += 1
          log.error(`❌ OddsSnapshot insert failed: ${write.error.message}`)
        } else {
          log.log(`✅ Wrote ${rows.length} OddsSnapshot row(s).`)
        }
      }
    } else {
      log.log('✅ No matching quotes to write.')
    }

    return done({
      snapshotJobs,
      events: snapshotJobs.length,
      calls,
      creditsUsed,
      rows,
      fetchErrors,
      writeErrors,
      skippedQuiet: skippedQuietDuringRun,
      skippedBudgetCount: skippedBudgetDuringRun,
      tableMissing,
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
  runSnapshotPublishedOdds().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    console.log(formatSnapshotStatus(SNAPSHOT_STATUS_FAILED))
    console.log(formatSnapshotEvents(0))
    console.log(formatCallsUsed(0))
    console.log(formatSnapshotCredits(0))
    process.exit(0)
  })
}
