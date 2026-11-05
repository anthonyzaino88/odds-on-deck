/**
 * Midday / pregame price snapshots for Published picks only.
 *
 * Informational path from the morning post to the close. CLV stays
 * entry price vs consensus close — snapshots never rewrite odds,
 * closeOdds, or clvProb.
 *
 * Never includes shadow-published or unpublished pending archive.
 * Never writes source='close' (that window stays on close capture).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMissingColumnError } from './grade-audit.js'
import { toAmericanOdds } from './odds-units.js'
import { etDayKey, parseEnvNonNegInt } from './odds-api-budget.js'
import { normalizePlayerName } from './parlay-integrity.js'
import {
  CLOSE_CAPTURE_WINDOW_MINUTES,
  creditCostForMarkets,
  isOpsWriteQuietPeriod,
  marketsForPublishedPicks,
  matchClosingQuote,
  shouldSkipPaidCloseCaptureFetch,
} from './closing-line.js'
import {
  isPublishedCohort,
  isPublishedEligibleProp,
  isPublishedTrackSource,
  isShadowPublishedCohort,
  parseRecordInstant,
  sourceMarketFromPick,
} from './published-picks.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const SNAPSHOT_SOURCE_MIDDAY = 'midday'
export const SNAPSHOT_SOURCE_PREGAME = 'pregame'
export const SNAPSHOT_SOURCE_CLOSE = 'close'
export const SNAPSHOT_SOURCES = Object.freeze([
  SNAPSHOT_SOURCE_MIDDAY,
  SNAPSHOT_SOURCE_PREGAME,
  SNAPSHOT_SOURCE_CLOSE,
])

export const SNAPSHOT_PREGAME_MINUTES = 120
export const DEFAULT_SNAPSHOT_DAILY_PASSES = 2
export const DEFAULT_SNAPSHOT_MAX_EVENT_CALLS = 8
export const DEFAULT_SNAPSHOT_MAX_CREDITS_PER_PASS = 24
export const DEFAULT_SNAPSHOT_FRESH_MINUTES = 90
export const DEFAULT_SNAPSHOT_HORIZON_HOURS = 36
export const DEFAULT_SNAPSHOT_REL_PATH = path.join('.local', 'odds-snapshot.json')
export const SNAPSHOT_LOCK_STALE_MS = 15 * 60 * 1000

export const SNAPSHOT_STATUS_OK = 'ok'
export const SNAPSHOT_STATUS_PARTIAL = 'partial'
export const SNAPSHOT_STATUS_FAILED = 'failed'

export const SNAPSHOT_REGIONS = Object.freeze(['us'])

/**
 * Missing table (42P01) or missing column (42703 / PGRST204).
 * Do not match the error message — 23502 / 23514 can mention "column".
 */
export function isMissingOddsSnapshotError(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '42P01') return true
  return isMissingColumnError(error)
}

/**
 * Open Published-cohort persist rows only. Graded `isPublishedPick`
 * cannot snapshot a future kickoff. "Never pending" means unpublished
 * pending archive — not Published-track rows still awaiting grade.
 */
export function isSnapshotEligiblePick(record) {
  if (!record || typeof record !== 'object') return false
  if (isShadowPublishedCohort(record)) return false
  if (!isPublishedTrackSource(record)) return false
  if (!isPublishedEligibleProp(record)) return false
  if (!isPublishedCohort(record)) return false
  const status = String(record.status || '').toLowerCase().trim()
  if (status && status !== 'pending') return false
  return true
}

export function snapshotSourceForKickoff(kickoff, now = new Date()) {
  const start = kickoff instanceof Date ? kickoff : parseRecordInstant(kickoff)
  const instant = now instanceof Date ? now : new Date(now)
  if (!start || Number.isNaN(instant.getTime())) return SNAPSHOT_SOURCE_MIDDAY
  const minutes = (start.getTime() - instant.getTime()) / 60000
  if (minutes <= SNAPSHOT_PREGAME_MINUTES) return SNAPSHOT_SOURCE_PREGAME
  return SNAPSHOT_SOURCE_MIDDAY
}

export function quotesAreFresh(capturedAt, now = new Date(), freshMinutes = DEFAULT_SNAPSHOT_FRESH_MINUTES) {
  const stamp = capturedAt instanceof Date ? capturedAt : parseRecordInstant(capturedAt)
  const instant = now instanceof Date ? now : new Date(now)
  const window = Number(freshMinutes)
  if (!stamp || Number.isNaN(instant.getTime()) || !Number.isFinite(window) || window < 0) {
    return false
  }
  return (instant.getTime() - stamp.getTime()) < window * 60 * 1000
}

export function eventQuotesAreFresh({
  snapshotAt = null,
  cacheUpdatedAt = null,
  now = new Date(),
  freshMinutes = DEFAULT_SNAPSHOT_FRESH_MINUTES,
} = {}) {
  return quotesAreFresh(snapshotAt, now, freshMinutes)
    || quotesAreFresh(cacheUpdatedAt, now, freshMinutes)
}

/** Kickoff must be strictly after T−35. T−1..T−0 and live rows do not snapshot. */
export function shouldSkipCloseCaptureWindow(game, now = new Date()) {
  const start = parseRecordInstant(game?.date || game?.gameDate)
  const instant = now instanceof Date ? now : new Date(now)
  if (!start || Number.isNaN(instant.getTime())) return true
  return start.getTime() <= instant.getTime() + CLOSE_CAPTURE_WINDOW_MINUTES * 60 * 1000
}

export function snapshotKickoffFloor(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now)
  return new Date(instant.getTime() + CLOSE_CAPTURE_WINDOW_MINUTES * 60 * 1000)
}

/** Refuse setup SELECTs and fetches from :04:30 through :15 ET. */
export function shouldRefuseSnapshotStart(now = new Date()) {
  return isOpsWriteQuietPeriod(now) || shouldSkipPaidCloseCaptureFetch(now)
}

export function readSnapshotPassConfig(env = process.env) {
  return {
    dailyPasses: parseEnvNonNegInt(env.ODDS_SNAPSHOT_DAILY_PASSES, DEFAULT_SNAPSHOT_DAILY_PASSES),
    maxEventCalls: parseEnvNonNegInt(env.ODDS_SNAPSHOT_MAX_EVENT_CALLS, DEFAULT_SNAPSHOT_MAX_EVENT_CALLS),
    maxCreditsPerPass: parseEnvNonNegInt(
      env.ODDS_SNAPSHOT_MAX_CREDITS_PER_PASS,
      DEFAULT_SNAPSHOT_MAX_CREDITS_PER_PASS,
    ),
    freshMinutes: parseEnvNonNegInt(env.ODDS_SNAPSHOT_FRESH_MINUTES, DEFAULT_SNAPSHOT_FRESH_MINUTES),
    horizonHours: parseEnvNonNegInt(env.ODDS_SNAPSHOT_HORIZON_HOURS, DEFAULT_SNAPSHOT_HORIZON_HOURS),
    persistPath: env.ODDS_SNAPSHOT_PATH
      ? String(env.ODDS_SNAPSHOT_PATH)
      : DEFAULT_SNAPSHOT_REL_PATH,
  }
}

export function resolveSnapshotPassPath(persistPath) {
  const rel = persistPath || DEFAULT_SNAPSHOT_REL_PATH
  if (path.isAbsolute(rel)) return rel
  return path.resolve(REPO_ROOT, rel)
}

function emptyPassState() {
  return { version: 1, days: {}, updatedAt: null }
}

function shouldPersistSnapshotPasses(env = process.env) {
  if (env.JEST_WORKER_ID || process.env.JEST_WORKER_ID) return false
  if (env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test') return false
  return true
}

export function loadSnapshotPassState({
  persistPath,
  filesystem = fs,
  persist = true,
} = {}) {
  if (!persist) return emptyPassState()
  const filePath = resolveSnapshotPassPath(persistPath)
  try {
    if (filesystem.existsSync && !filesystem.existsSync(filePath)) return emptyPassState()
    const parsed = JSON.parse(filesystem.readFileSync(filePath, 'utf8'))
    const days = {}
    for (const [day, row] of Object.entries(parsed?.days || {})) {
      days[day] = { passes: Math.max(0, Number(row?.passes) || 0) }
    }
    return { version: 1, days, updatedAt: parsed?.updatedAt || null }
  } catch {
    return emptyPassState()
  }
}

export function saveSnapshotPassState(state, {
  persistPath,
  filesystem = fs,
  persist = true,
} = {}) {
  if (!persist) return state
  const filePath = resolveSnapshotPassPath(persistPath)
  filesystem.mkdirSync?.(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  filesystem.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  filesystem.renameSync(tmp, filePath)
  return state
}

export function snapshotLockPath(persistPath) {
  return `${resolveSnapshotPassPath(persistPath)}.lock`
}

export function acquireSnapshotPassLock({
  persistPath,
  filesystem = fs,
  persist = true,
  staleMs = SNAPSHOT_LOCK_STALE_MS,
  retry = true,
} = {}) {
  if (!persist) return { acquired: true, release() {} }
  const lockPath = snapshotLockPath(persistPath)
  filesystem.mkdirSync?.(path.dirname(lockPath), { recursive: true })
  try {
    const fd = filesystem.openSync(lockPath, 'wx')
    try {
      filesystem.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`)
    } finally {
      filesystem.closeSync(fd)
    }
    return {
      acquired: true,
      release() {
        try { filesystem.unlinkSync(lockPath) } catch { /* already gone */ }
      },
    }
  } catch (error) {
    if (error?.code === 'EEXIST' && retry) {
      try {
        const stat = filesystem.statSync(lockPath)
        if (Date.now() - Number(stat.mtimeMs || 0) > staleMs) {
          filesystem.unlinkSync(lockPath)
          return acquireSnapshotPassLock({
            persistPath,
            filesystem,
            persist,
            staleMs,
            retry: false,
          })
        }
      } catch { /* keep fail-closed */ }
    }
    return { acquired: false, release() {} }
  }
}

export function saveHeldSnapshotRows(rows, {
  persistPath,
  filesystem = fs,
  persist = true,
  now = new Date(),
} = {}) {
  if (!persist || !rows?.length) return null
  const filePath = path.join(
    path.dirname(resolveSnapshotPassPath(persistPath)),
    'odds-snapshot-held.json',
  )
  filesystem.mkdirSync?.(path.dirname(filePath), { recursive: true })
  filesystem.writeFileSync(filePath, `${JSON.stringify({
    heldAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    rows,
  }, null, 2)}\n`)
  return filePath
}

export function todaySnapshotPasses(state, now = new Date()) {
  const day = etDayKey(now)
  return Math.max(0, Number(state?.days?.[day]?.passes) || 0)
}

export function remainingSnapshotPasses(state, now = new Date(), dailyPasses = DEFAULT_SNAPSHOT_DAILY_PASSES) {
  const cap = Math.max(0, Number(dailyPasses) || 0)
  return Math.max(0, cap - todaySnapshotPasses(state, now))
}

export function recordSnapshotPass(state, now = new Date(), opts = {}) {
  const day = etDayKey(now)
  const next = {
    version: 1,
    days: { ...(state?.days || {}) },
    updatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  }
  const row = next.days[day] || { passes: 0 }
  next.days[day] = { passes: (Number(row.passes) || 0) + 1 }
  return saveSnapshotPassState(next, opts)
}

export function snapshotRowId(propValidationId, capturedAt) {
  const iso = (capturedAt instanceof Date ? capturedAt : new Date(capturedAt)).toISOString()
  return `os:${propValidationId}:${iso}`
}

export function snapshotQuotesPayload(quotes) {
  return (quotes || []).map((quote) => ({
    book: quote.book || null,
    american: toAmericanOdds(quote.odds) ?? quote.odds ?? null,
    lastUpdate: quote.last_update || quote.lastUpdate || null,
  }))
}

export function sameLineQuotesForPick(pick, quotes) {
  const match = matchClosingQuote(pick, quotes)
  if (!match) return { match: null, quotes: [] }
  const player = normalizePlayerName(pick?.playerName)
  const side = String(pick?.prediction || pick?.pick || '').toLowerCase().trim()
  const line = Number(pick?.threshold)
  const lineQuotes = (quotes || []).filter((quote) => (
    normalizePlayerName(quote.playerName) === player
    && quote.pick === side
    && Number(quote.threshold) === line
  ))
  return { match, quotes: lineQuotes }
}

export function buildSnapshotRow({
  pick,
  game,
  match,
  quotes = [],
  capturedAt = new Date(),
  source,
} = {}) {
  if (!pick?.id || !match) return null
  const stamp = capturedAt instanceof Date ? capturedAt : new Date(capturedAt)
  const kickoff = game?.date || game?.gameDate || pick.gameDate
  const tag = SNAPSHOT_SOURCES.includes(source)
    ? source
    : snapshotSourceForKickoff(kickoff, stamp)
  if (tag === SNAPSHOT_SOURCE_CLOSE) return null
  const consensus = toAmericanOdds(match.odds)
  const best = toAmericanOdds(match.bestOdds ?? match.odds)
  return {
    id: snapshotRowId(pick.id, stamp),
    propValidationId: pick.id,
    gameId: pick.gameIdRef || game?.id || null,
    sport: pick.sport || game?.sport || null,
    market: match.sourceMarket || sourceMarketFromPick(pick) || pick.propType || null,
    playerName: pick.playerName || null,
    selection: String(pick.prediction || pick.pick || '').toLowerCase().trim() || null,
    line: Number.isFinite(Number(pick.threshold)) ? Number(pick.threshold) : null,
    consensusOdds: Number.isFinite(consensus) ? Math.round(consensus) : null,
    bestOdds: Number.isFinite(best) ? Math.round(best) : null,
    bestBook: match.bestBook || match.book || null,
    numBooks: match.numBooks ?? null,
    quotes: snapshotQuotesPayload(quotes),
    capturedAt: stamp.toISOString(),
    source: tag,
  }
}

export function formatSnapshotStatus(status = SNAPSHOT_STATUS_OK) {
  return `SNAPSHOT_STATUS=${status || SNAPSHOT_STATUS_OK}`
}

export function formatSnapshotEvents(events) {
  return `SNAPSHOT_EVENTS=${Number(events) || 0}`
}

export function formatSnapshotCredits(credits) {
  return `CREDITS=${Number(credits) || 0}`
}

export function latestStampByGameId(rows, {
  gameKey = 'gameId',
  stampKey = 'capturedAt',
} = {}) {
  const latest = new Map()
  for (const row of rows || []) {
    const gameId = row?.[gameKey]
    const stamp = parseRecordInstant(row?.[stampKey])
    if (!gameId || !stamp) continue
    const prev = latest.get(gameId)
    if (!prev || stamp.getTime() > prev.getTime()) latest.set(gameId, stamp)
  }
  return latest
}

export function snapshotJobKickoffMs(job) {
  const start = parseRecordInstant(job?.game?.date || job?.game?.gameDate)
  return start ? start.getTime() : Number.POSITIVE_INFINITY
}

export function sortSnapshotJobs(jobs) {
  return [...(jobs || [])].sort((a, b) => snapshotJobKickoffMs(a) - snapshotJobKickoffMs(b))
}

export function classifySnapshotJobs(jobs, {
  now = new Date(),
  freshMinutes = DEFAULT_SNAPSHOT_FRESH_MINUTES,
  latestSnapshots = new Map(),
  latestCacheQuotes = new Map(),
} = {}) {
  const fetchable = []
  const skippedWindow = []
  const skippedFresh = []
  const skippedUnmapped = []
  for (const job of jobs || []) {
    if (!job?.eventId) {
      skippedUnmapped.push(job)
      continue
    }
    if (shouldSkipCloseCaptureWindow(job.game, now)) {
      skippedWindow.push(job)
      continue
    }
    const gameIds = job.gameIds?.length ? job.gameIds : [job.gameId]
    const fresh = gameIds.some((id) => eventQuotesAreFresh({
      snapshotAt: latestSnapshots.get(id) || null,
      cacheUpdatedAt: latestCacheQuotes.get(id) || null,
      now,
      freshMinutes,
    }))
    if (fresh) {
      skippedFresh.push(job)
      continue
    }
    fetchable.push(job)
  }
  return { fetchable, skippedWindow, skippedFresh, skippedUnmapped }
}

export function selectSnapshotJobs(jobs, {
  maxEventCalls = DEFAULT_SNAPSHOT_MAX_EVENT_CALLS,
  maxCredits = DEFAULT_SNAPSHOT_MAX_CREDITS_PER_PASS,
} = {}) {
  const callCap = Math.max(0, Number(maxEventCalls) || 0)
  const creditCap = Math.max(0, Number(maxCredits) || 0)
  const sorted = sortSnapshotJobs(jobs)
  const kept = []
  const skippedCap = []
  let credits = 0
  for (const job of sorted) {
    const markets = job.markets?.length ? job.markets : marketsForSnapshotJob(job)
    const cost = creditCostForMarkets(markets.length, SNAPSHOT_REGIONS.length)
    if (kept.length >= callCap || credits + cost > creditCap) {
      skippedCap.push(job)
      continue
    }
    kept.push(job)
    credits += cost
  }
  return { jobs: kept, skippedCap }
}

export function marketsForSnapshotJob(job) {
  return marketsForPublishedPicks(job?.picks, { sport: job?.game?.sport })
}

export function isSnapshotDisabled(env = process.env) {
  const raw = String(env.ODDS_SNAPSHOT ?? '').trim().toLowerCase()
  return raw === '0' || raw === 'false' || raw === 'off'
}
