/**
 * Shared Odds API credit-budget guard.
 *
 * The Odds API bills credits (markets × regions) and returns
 * x-requests-remaining / x-requests-used / x-requests-last on every
 * response. Remaining/used are month-to-date on the account. Daily
 * usage is not in the headers, so this module persists a small local
 * JSON ledger (gitignored `.local/`) — the same class of laptop-only
 * file as the research JSONL archives. Never writes the production DB
 * and never logs the API key.
 *
 * Always probe GET /v4/sports (0 credits) first to refresh headers,
 * then gate paid calls. lastRemaining / lastUsed from a previous ET
 * day must not block today's run.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ODDS_BUDGET_OK = 'ok'
export const ODDS_BUDGET_FLOOR = 'floor'
export const ODDS_BUDGET_DAILY_CAP = 'daily_cap'
export const ODDS_BUDGET_MONTHLY_CAP = 'monthly_cap'
export const ODDS_BUDGET_PROBE_FAILED = 'probe_failed'
export const ODDS_BUDGET_CLOSE_CAP = 'close_cap'
export const ODDS_BUDGET_GAME_LINE_CAP = 'game_line_cap'

export const DEFAULT_DAILY_CREDIT_CAP = 1500
export const DEFAULT_MONTHLY_CREDIT_CAP = 17000
export const DEFAULT_REMAINING_FLOOR = 3000
export const DEFAULT_CLOSE_CAPTURE_RESERVE = 200
export const DEFAULT_CLOSE_CAPTURE_DAILY_CAP = 40
/** Slots of the 40-capture day that game lines must leave for later prop closes. */
export const DEFAULT_CLOSE_CAPTURE_PROP_HEADROOM = 28
export const DEFAULT_GAME_LINE_CLOSE_DAILY_CAP = 12
const BUDGET_LOCK_STALE_MS = 30 * 1000
export const DEFAULT_PROBE_FAIL_CREDIT_CAP = 100
export const DEFAULT_BUDGET_REL_PATH = path.join('.local', 'odds-api-budget.json')
export const ODDS_API_USER_AGENT = 'OddsOnDeck/1.0'
export const ODDS_API_SPORTS_URL = 'https://api.the-odds-api.com/v4/sports'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function etDayKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ET_DAY.format(new Date())
  return ET_DAY.format(date)
}

export function parseEnvNonNegInt(value, fallback) {
  if (value == null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.floor(n)
}

export function readOddsBudgetConfig(env = process.env) {
  const monthlyFallback = parseEnvNonNegInt(env.ODDS_API_QUOTA, DEFAULT_MONTHLY_CREDIT_CAP)
  return {
    dailyCap: parseEnvNonNegInt(env.ODDS_DAILY_CREDIT_CAP, DEFAULT_DAILY_CREDIT_CAP),
    monthlyCap: parseEnvNonNegInt(env.ODDS_MONTHLY_CREDIT_CAP, monthlyFallback),
    remainingFloor: parseEnvNonNegInt(env.ODDS_REMAINING_FLOOR, DEFAULT_REMAINING_FLOOR),
    closeCaptureReserve: parseEnvNonNegInt(
      env.ODDS_CLOSE_CAPTURE_RESERVE,
      DEFAULT_CLOSE_CAPTURE_RESERVE,
    ),
    closeCaptureDailyCap: parseEnvNonNegInt(
      env.ODDS_CLOSE_CAPTURE_DAILY_CAP,
      DEFAULT_CLOSE_CAPTURE_DAILY_CAP,
    ),
    closeCapturePropHeadroom: parseEnvNonNegInt(
      env.ODDS_CLOSE_CAPTURE_PROP_HEADROOM,
      DEFAULT_CLOSE_CAPTURE_PROP_HEADROOM,
    ),
    gameLineCloseDailyCap: parseEnvNonNegInt(
      env.ODDS_GAME_LINE_CLOSE_DAILY_CAP,
      DEFAULT_GAME_LINE_CLOSE_DAILY_CAP,
    ),
    probeFailCreditCap: parseEnvNonNegInt(
      env.ODDS_PROBE_FAIL_CREDIT_CAP,
      DEFAULT_PROBE_FAIL_CREDIT_CAP,
    ),
    persistPath: env.ODDS_BUDGET_PATH
      ? String(env.ODDS_BUDGET_PATH)
      : DEFAULT_BUDGET_REL_PATH,
  }
}

export function resolveOddsBudgetPath(persistPath) {
  const rel = persistPath || DEFAULT_BUDGET_REL_PATH
  if (path.isAbsolute(rel)) return rel
  return path.resolve(REPO_ROOT, rel)
}

function toNullableNumber(value) {
  if (value == null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * x-requests-last is a credit cost only when it is a real non-negative
 * number. Null, blank, NaN, Infinity, and negative headers are missing,
 * not zero — Number(null) is 0 and must not refund a reservation.
 */
function usableRequestCost(value) {
  if (value == null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

function fenceValue(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

export function parseOddsApiQuota(headers) {
  if (!headers) return { remaining: null, used: null, last: null }
  const get = (name) => {
    if (typeof headers.get === 'function') return headers.get(name)
    return headers[name] || headers[name.toLowerCase()] || null
  }
  return {
    remaining: toNullableNumber(get('x-requests-remaining')),
    used: toNullableNumber(get('x-requests-used')),
    last: toNullableNumber(get('x-requests-last')),
  }
}

function countCsvParam(params, name) {
  const raw = params.get(name)
  if (!raw) return 0
  return raw.split(',').map((part) => part.trim()).filter(Boolean).length
}

export function estimateCreditsFromOddsEndpoint(endpointOrUrl) {
  const raw = String(endpointOrUrl || '')
  let search = ''
  try {
    if (/^https?:\/\//i.test(raw)) {
      search = new URL(raw).searchParams.toString()
    } else {
      const q = raw.indexOf('?')
      search = q >= 0 ? raw.slice(q + 1) : ''
    }
  } catch {
    search = ''
  }
  const params = new URLSearchParams(search)
  const marketCount = countCsvParam(params, 'markets')
  if (!marketCount) return 0
  const regionCount = countCsvParam(params, 'regions') || 1
  return marketCount * regionCount
}

export function stripOddsApiKeyFromUrl(url) {
  return String(url || '').replace(/apiKey=[^&]*/gi, 'apiKey=[redacted]')
}

export function redactOddsApiKey(text, apiKey) {
  const raw = String(text ?? '')
  if (!apiKey) return raw
  return raw.split(String(apiKey)).join('[redacted]')
}

export function formatOddsBudgetStatus(status = ODDS_BUDGET_OK) {
  return `ODDS_BUDGET_STATUS=${status || ODDS_BUDGET_OK}`
}

export function formatOddsBudgetWarnLine(status) {
  if (!status || status === ODDS_BUDGET_OK) return null
  return `⚠️ ${formatOddsBudgetStatus(status)} — treat as WARN in routine reports (exit 0)`
}

export function formatOddsCreditsUsed(credits) {
  return `ODDS_CREDITS_USED=${Number(credits) || 0}`
}

export function formatOddsCreditsRemaining(remaining) {
  return remaining == null || remaining === ''
    ? 'ODDS_CREDITS_REMAINING=unknown'
    : `ODDS_CREDITS_REMAINING=${remaining}`
}

export function emitOddsBudgetStatus(status, log = console) {
  log.log?.(formatOddsBudgetStatus(status))
  const warn = formatOddsBudgetWarnLine(status)
  if (warn) (log.warn || log.log)?.(warn)
}

export function buildSportsQuotaProbeUrl(apiKey) {
  const params = new URLSearchParams()
  if (apiKey) params.set('apiKey', apiKey)
  return `${ODDS_API_SPORTS_URL}?${params.toString()}`
}

function emptyDayRow() {
  return {
    credits: 0,
    calls: 0,
    closeCaptures: 0,
    gameLineCredits: 0,
  }
}

function dayRow(row) {
  return {
    credits: Number(row?.credits) || 0,
    calls: Number(row?.calls) || 0,
    closeCaptures: Number(row?.closeCaptures) || 0,
    gameLineCredits: Number(row?.gameLineCredits) || 0,
  }
}

function emptyState() {
  return {
    version: 1,
    lastRemaining: null,
    lastUsed: null,
    lastCost: null,
    quotaDay: null,
    updatedAt: null,
    fence: 0,
    days: {},
  }
}

function normalizeState(raw) {
  const state = emptyState()
  if (!raw || typeof raw !== 'object') return state
  state.lastRemaining = toNullableNumber(raw.lastRemaining)
  state.lastUsed = toNullableNumber(raw.lastUsed)
  state.lastCost = toNullableNumber(raw.lastCost)
  state.quotaDay = raw.quotaDay ? String(raw.quotaDay) : null
  state.updatedAt = raw.updatedAt || null
  state.fence = fenceValue(raw.fence)
  const days = raw.days && typeof raw.days === 'object' ? raw.days : {}
  for (const [day, row] of Object.entries(days)) {
    state.days[day] = dayRow(row)
  }
  return state
}

function shouldPersistToDisk(env = process.env) {
  if (env.JEST_WORKER_ID || process.env.JEST_WORKER_ID) return false
  if (env.NODE_ENV === 'test' || process.env.NODE_ENV === 'test') return false
  return true
}

function emitLedgerWarn(log, message) {
  (log?.warn || log?.log)?.(message)
}

export function loadOddsBudgetState({
  persistPath,
  filesystem = fs,
  persist = true,
  log,
  warn = true,
} = {}) {
  if (!persist) return emptyState()
  const filePath = resolveOddsBudgetPath(persistPath)
  try {
    if (filesystem.existsSync && !filesystem.existsSync(filePath)) {
      if (warn) {
        emitLedgerWarn(log, `⚠️ Odds budget ledger missing at ${filePath}; starting empty`)
      }
      return emptyState()
    }
    const parsed = JSON.parse(filesystem.readFileSync(filePath, 'utf8'))
    return normalizeState(parsed)
  } catch (error) {
    if (warn) {
      emitLedgerWarn(
        log,
        `⚠️ Odds budget ledger corrupt or unreadable at ${filePath}: ${error.message}; starting empty`,
      )
    }
    return emptyState()
  }
}

function mergeCounter(diskValue, memoryValue, delta) {
  const change = Number(delta) || 0
  const before = Math.max(0, (Number(memoryValue) || 0) - change)
  return Math.max(0, Math.max(Number(diskValue) || 0, before) + change)
}

function mergeBudgetStates(disk, memory, {
  dayKey,
  thisCost = 0,
  thisCaptures = 0,
  thisGameLineCredits = 0,
  thisCalls = 1,
} = {}) {
  const out = emptyState()
  const diskState = normalizeState(disk)
  const memState = normalizeState(memory)
  const allDays = new Set([
    ...Object.keys(diskState.days),
    ...Object.keys(memState.days),
  ])
  for (const day of allDays) {
    const d = dayRow(diskState.days[day])
    const m = dayRow(memState.days[day])
    if (day === dayKey) {
      out.days[day] = {
        credits: mergeCounter(d.credits, m.credits, thisCost),
        calls: mergeCounter(d.calls, m.calls, thisCalls),
        closeCaptures: mergeCounter(d.closeCaptures, m.closeCaptures, thisCaptures),
        gameLineCredits: mergeCounter(d.gameLineCredits, m.gameLineCredits, thisGameLineCredits),
      }
    } else {
      out.days[day] = {
        credits: Math.max(d.credits, m.credits),
        calls: Math.max(d.calls, m.calls),
        closeCaptures: Math.max(d.closeCaptures, m.closeCaptures),
        gameLineCredits: Math.max(d.gameLineCredits, m.gameLineCredits),
      }
    }
  }
  out.lastRemaining = memState.lastRemaining ?? diskState.lastRemaining
  out.lastUsed = memState.lastUsed ?? diskState.lastUsed
  out.lastCost = memState.lastCost ?? diskState.lastCost
  out.quotaDay = memState.quotaDay ?? diskState.quotaDay
  out.updatedAt = memState.updatedAt || diskState.updatedAt
  out.version = memState.version || diskState.version || 1
  return out
}

function writeBudgetFile(filesystem, filePath, merged) {
  const dir = path.dirname(filePath)
  filesystem.mkdirSync?.(dir, { recursive: true })
  const payload = `${JSON.stringify(merged, null, 2)}\n`
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  filesystem.writeFileSync(tmp, payload, 'utf8')
  if (typeof filesystem.renameSync === 'function') {
    try {
      filesystem.renameSync(tmp, filePath)
      return
    } catch {
      // fall through to a direct write
    }
  }
  filesystem.writeFileSync(filePath, payload, 'utf8')
  try {
    filesystem.unlinkSync?.(tmp)
  } catch {
    // tmp cleanup is best-effort
  }
}

/**
 * Exclusive create of `<ledger>.lock`. The holder re-reads the ledger,
 * applies one reservation, and writes it before the Odds API call.
 * A stale lock (crashed holder) is removed once. Nested calls from the
 * same write reuse the lock the outer reserve already holds.
 * The callback receives the lock token. A ledger write must still
 * match that token and the fence it read, so a stolen stale lock
 * cannot commit the old holder's merge.
 */
const budgetLockHeld = new Map()

function assertBudgetFence(filesystem, filePath, token, seenFence, loadOpts) {
  const lockPath = `${filePath}.lock`
  let current = null
  try {
    current = filesystem.readFileSync(lockPath, 'utf8')
  } catch {
    current = null
  }
  if (String(current) !== String(token)) {
    throw new Error('Odds budget lock lost')
  }
  const latest = loadOddsBudgetState({ ...loadOpts, warn: false })
  if (fenceValue(latest.fence) !== seenFence) {
    throw new Error('Odds budget fence moved')
  }
}

export function withOddsBudgetLock(filePath, filesystem, fn) {
  if (!filePath || typeof filesystem?.openSync !== 'function') return fn(null)
  const held = budgetLockHeld.get(filePath)
  if (held) return fn(held)
  const lockPath = `${filePath}.lock`
  filesystem.mkdirSync?.(path.dirname(lockPath), { recursive: true })
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}\n`
  const started = Date.now()
  let fd = null
  for (;;) {
    try {
      fd = filesystem.openSync(lockPath, 'wx')
      break
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let stale = false
      try {
        const stat = filesystem.statSync(lockPath)
        stale = Date.now() - Number(stat.mtimeMs || 0) > BUDGET_LOCK_STALE_MS
      } catch {
        stale = false
      }
      if (stale) {
        try { filesystem.unlinkSync(lockPath) } catch { /* raced */ }
        continue
      }
      if (Date.now() - started > BUDGET_LOCK_STALE_MS) {
        throw new Error('Odds budget lock timed out')
      }
      const until = Date.now() + 5
      while (Date.now() < until) { /* another process holds the ledger */ }
    }
  }
  try {
    filesystem.writeFileSync(fd, token)
  } finally {
    try { filesystem.closeSync(fd) } catch { /* closed */ }
  }
  budgetLockHeld.set(filePath, token)
  try {
    return fn(token)
  } finally {
    budgetLockHeld.delete(filePath)
    try {
      const current = filesystem.readFileSync(lockPath, 'utf8')
      if (String(current) === token) filesystem.unlinkSync(lockPath)
    } catch {
      // already released
    }
  }
}

export function saveOddsBudgetState(state, {
  persistPath,
  filesystem = fs,
  persist = true,
  log,
  dayKey,
  thisCost = 0,
  thisCaptures = 0,
  thisGameLineCredits = 0,
  thisCalls = 1,
} = {}) {
  if (!persist) return state
  const filePath = resolveOddsBudgetPath(persistPath)
  const loadOpts = {
    persistPath,
    filesystem,
    persist: true,
    log,
  }
  return withOddsBudgetLock(filePath, filesystem, (token) => {
    const disk = loadOddsBudgetState({ ...loadOpts, warn: false })
    const seenFence = fenceValue(disk.fence)
    const merged = mergeBudgetStates(disk, state, {
      dayKey,
      thisCost,
      thisCaptures,
      thisGameLineCredits,
      thisCalls,
    })
    merged.fence = seenFence + 1
    if (token) assertBudgetFence(filesystem, filePath, token, seenFence, loadOpts)
    writeBudgetFile(filesystem, filePath, merged)
    return merged
  })
}

function creditCost(quota, estimatedCredits) {
  const last = usableRequestCost(quota?.last)
  if (last != null) return last
  if (estimatedCredits == null) return 1
  if (typeof estimatedCredits === 'string' && estimatedCredits.trim() === '') return 1
  const estimate = Number(estimatedCredits)
  if (!Number.isFinite(estimate)) return 1
  return Math.max(0, estimate)
}

export function createOddsApiBudget({
  env = process.env,
  now,
  log = console,
  persist,
  filesystem = fs,
  state: seeded,
  apiKey = env.ODDS_API_KEY,
  purpose = 'fetch',
} = {}) {
  const config = readOddsBudgetConfig(env)
  const persistEnabled = persist == null ? shouldPersistToDisk(env) : Boolean(persist)
  const persistOpts = {
    persistPath: config.persistPath,
    filesystem,
    persist: persistEnabled,
    log,
  }
  const state = normalizeState(seeded || loadOddsBudgetState(persistOpts))
  const clock = typeof now === 'function'
    ? now
    : (now == null ? () => new Date() : () => (now instanceof Date ? now : new Date(now)))
  function currentDayKey() {
    return etDayKey(clock())
  }
  let statusDay = currentDayKey()
  if (!state.days[statusDay]) state.days[statusDay] = emptyDayRow()

  function noteDay() {
    const day = currentDayKey()
    if (!state.days[day]) state.days[day] = emptyDayRow()
    if (day === statusDay) return false
    statusDay = day
    return true
  }

  const isCloseCapture = purpose === 'close-capture'
  const effectiveDailyCap = isCloseCapture
    ? config.dailyCap
    : Math.max(0, config.dailyCap - config.closeCaptureReserve)

  let status = ODDS_BUDGET_OK
  let runCredits = 0
  let runCalls = 0
  let probeFailedWithoutTodayHeaders = false

  function todayCredits() {
    return Number(state.days[currentDayKey()]?.credits) || 0
  }

  function todayCloseCaptures() {
    return Number(state.days[currentDayKey()]?.closeCaptures) || 0
  }

  function todayGameLineCredits() {
    return Number(state.days[currentDayKey()]?.gameLineCredits) || 0
  }

  function remainingCloseCaptures() {
    return Math.max(0, config.closeCaptureDailyCap - todayCloseCaptures())
  }

  function gameLineSlotCeiling() {
    return Math.max(0, config.closeCaptureDailyCap - config.closeCapturePropHeadroom)
  }

  function remainingGameLineCredits() {
    return Math.max(0, config.gameLineCloseDailyCap - todayGameLineCredits())
  }

  /** Capture slots game lines may still take without entering the prop headroom. */
  function remainingGameLineSlots() {
    return Math.max(0, Math.min(
      gameLineSlotCeiling() - todayCloseCaptures(),
      remainingCloseCaptures(),
    ))
  }

  function reloadFromDisk() {
    if (!persistEnabled) return
    const disk = loadOddsBudgetState({ ...persistOpts, warn: false })
    const merged = mergeBudgetStates(disk, state, {
      dayKey: currentDayKey(),
      thisCost: 0,
      thisCaptures: 0,
      thisGameLineCredits: 0,
      thisCalls: 0,
    })
    state.days = merged.days
    if (disk.updatedAt) {
      state.lastRemaining = disk.lastRemaining ?? state.lastRemaining
      state.lastUsed = disk.lastUsed ?? state.lastUsed
      state.lastCost = disk.lastCost ?? state.lastCost
      state.quotaDay = disk.quotaDay ?? state.quotaDay
      state.updatedAt = disk.updatedAt
    }
    if (!state.days[currentDayKey()]) state.days[currentDayKey()] = emptyDayRow()
  }

  function quotaSnapshot() {
    return {
      remaining: state.lastRemaining,
      used: state.lastUsed,
      last: state.lastCost,
    }
  }

  function hasFreshQuota() {
    return state.quotaDay === currentDayKey()
  }

  function dailyCapNow() {
    if (probeFailedWithoutTodayHeaders) {
      return Math.min(effectiveDailyCap, config.probeFailCreditCap)
    }
    return effectiveDailyCap
  }

  function paidCredits(nextCredits = 1) {
    const n = Number(nextCredits)
    if (!Number.isFinite(n) || n <= 0) return 1
    return n
  }

  function captureCountForAllow(nextCredits, extra = {}) {
    if (!isCloseCapture || extra.isProbe) return 0
    if (extra.captures != null) return Math.max(0, Number(extra.captures) || 0)
    return paidCredits(nextCredits) > 0 ? 1 : 0
  }

  function wouldCross(nextCredits = 1, extra = {}) {
    const next = paidCredits(nextCredits)
    const captures = captureCountForAllow(next, extra)
    if (hasFreshQuota() && state.lastRemaining != null
      && (state.lastRemaining - next) < config.remainingFloor) {
      return ODDS_BUDGET_FLOOR
    }
    if (hasFreshQuota() && state.lastUsed != null
      && (state.lastUsed + next) > config.monthlyCap) {
      return ODDS_BUDGET_MONTHLY_CAP
    }
    if (isCloseCapture && Number(extra.gameLineCredits) > 0) {
      const gameLineCost = Math.max(0, Number(extra.gameLineCredits) || 0)
      if (todayGameLineCredits() + gameLineCost > config.gameLineCloseDailyCap) {
        return ODDS_BUDGET_GAME_LINE_CAP
      }
      if (captures > 0 && todayCloseCaptures() + captures > gameLineSlotCeiling()) {
        return ODDS_BUDGET_GAME_LINE_CAP
      }
    }
    if (isCloseCapture && captures > 0
      && (todayCloseCaptures() + captures) > config.closeCaptureDailyCap) {
      return ODDS_BUDGET_CLOSE_CAP
    }
    if ((todayCredits() + next) > dailyCapNow()) {
      return probeFailedWithoutTodayHeaders
        ? ODDS_BUDGET_PROBE_FAILED
        : ODDS_BUDGET_DAILY_CAP
    }
    return null
  }

  function recomputeStatus() {
    if (probeFailedWithoutTodayHeaders) {
      status = ODDS_BUDGET_PROBE_FAILED
      return
    }
    status = wouldCross(1) || ODDS_BUDGET_OK
  }

  function markProbeFailed() {
    if (hasFreshQuota()) return false
    probeFailedWithoutTodayHeaders = true
    status = ODDS_BUDGET_PROBE_FAILED
    return true
  }

  function allow(nextCredits = 1, extra = {}) {
    const next = Math.max(0, Number(nextCredits) || 0)
    if (noteDay()) recomputeStatus()
    if (status === ODDS_BUDGET_GAME_LINE_CAP && !(Number(extra.gameLineCredits) > 0)) {
      recomputeStatus()
    }
    if (probeFailedWithoutTodayHeaders) {
      return !wouldCross(next, extra)
    }
    if (status !== ODDS_BUDGET_OK) return false
    const reason = wouldCross(next, extra)
    if (reason) {
      status = reason
      return false
    }
    return true
  }

  function persistState(thisCost = 0, thisCaptures = 0, thisGameLineCredits = 0, thisCalls = 1, forDay = currentDayKey()) {
    const keepMonths = new Set([currentDayKey().slice(0, 7), String(forDay).slice(0, 7)])
    const days = {}
    for (const [day, row] of Object.entries(state.days)) {
      if (keepMonths.has(String(day).slice(0, 7))) days[day] = dayRow(row)
    }
    state.days = days
    state.updatedAt = new Date().toISOString()
    const merged = saveOddsBudgetState(state, {
      ...persistOpts,
      dayKey: forDay,
      thisCost,
      thisCaptures,
      thisGameLineCredits,
      thisCalls,
    })
    if (merged && persistEnabled) {
      state.lastRemaining = merged.lastRemaining
      state.lastUsed = merged.lastUsed
      state.lastCost = merged.lastCost
      state.quotaDay = merged.quotaDay
      state.updatedAt = merged.updatedAt
      state.days = merged.days
      if (!state.days[forDay]) state.days[forDay] = emptyDayRow()
      if (!state.days[currentDayKey()]) state.days[currentDayKey()] = emptyDayRow()
    }
  }

  function snapshotQuota() {
    return {
      lastRemaining: state.lastRemaining,
      lastUsed: state.lastUsed,
      lastCost: state.lastCost,
      quotaDay: state.quotaDay,
    }
  }

  function restoreQuota(saved) {
    state.lastRemaining = saved.lastRemaining
    state.lastUsed = saved.lastUsed
    state.lastCost = saved.lastCost
    state.quotaDay = saved.quotaDay
  }

  function applyUsage({
    cost = 0,
    captures = 0,
    gameLineCredits = 0,
    calls = 1,
    quota = null,
    day = null,
  } = {}) {
    const forDay = day || currentDayKey()
    if (!state.days[forDay]) state.days[forDay] = emptyDayRow()
    const beforeRow = dayRow(state.days[forDay])
    const beforeQuota = snapshotQuota()
    const beforeRunCredits = runCredits
    const beforeRunCalls = runCalls
    const row = dayRow(beforeRow)
    row.credits = Math.max(0, row.credits + cost)
    row.calls = Math.max(0, row.calls + calls)
    row.closeCaptures = Math.max(0, row.closeCaptures + captures)
    row.gameLineCredits = Math.max(0, row.gameLineCredits + gameLineCredits)
    state.days[forDay] = row
    if (quota) {
      if (quota.remaining != null) state.lastRemaining = quota.remaining
      if (quota.used != null) state.lastUsed = quota.used
      if (quota.remaining != null || quota.used != null) state.quotaDay = forDay
      state.lastCost = cost
    }
    runCredits += cost
    runCalls += calls
    try {
      persistState(cost, captures, gameLineCredits, calls, forDay)
    } catch (error) {
      state.days[forDay] = beforeRow
      restoreQuota(beforeQuota)
      runCredits = beforeRunCredits
      runCalls = beforeRunCalls
      throw error
    }
    recomputeStatus()
    return row
  }

  function parseQuotaInput(quota) {
    if (quota && typeof quota === 'object' && ('remaining' in quota || 'used' in quota || 'last' in quota)) {
      return {
        remaining: quota.remaining ?? null,
        used: quota.used ?? null,
        last: quota.last ?? null,
      }
    }
    return parseOddsApiQuota(quota)
  }

  function record(quota = {}, { credits, captures, isProbe = false, gameLineCredits = 0 } = {}) {
    if (noteDay()) recomputeStatus()
    const forDay = currentDayKey()
    const parsed = parseQuotaInput(quota)
    const cost = creditCost(parsed, credits)
    const captureInc = isCloseCapture && !isProbe && cost > 0
      ? Math.max(0, captures != null ? Number(captures) || 0 : 1)
      : 0
    const gameLineInc = Math.max(0, Number(gameLineCredits) || 0)
    if (!state.days[forDay]) state.days[forDay] = emptyDayRow()
    const beforeRow = dayRow(state.days[forDay])
    const beforeQuota = snapshotQuota()
    const beforeRunCredits = runCredits
    const beforeRunCalls = runCalls
    runCredits += cost
    runCalls += 1
    if (parsed.remaining != null) state.lastRemaining = parsed.remaining
    if (parsed.used != null) state.lastUsed = parsed.used
    if (parsed.remaining != null || parsed.used != null) state.quotaDay = forDay
    state.lastCost = cost
    const row = dayRow(beforeRow)
    row.credits += cost
    row.calls += 1
    row.closeCaptures += captureInc
    row.gameLineCredits += gameLineInc
    state.days[forDay] = row
    try {
      persistState(cost, captureInc, gameLineInc, 1, forDay)
    } catch (error) {
      state.days[forDay] = beforeRow
      restoreQuota(beforeQuota)
      runCredits = beforeRunCredits
      runCalls = beforeRunCalls
      throw error
    }
    const line = `  💳 Odds API credits last=${parsed.last ?? cost} used=${parsed.used ?? state.lastUsed ?? '?'} remaining=${parsed.remaining ?? state.lastRemaining ?? '?'}`
    log.log?.(redactOddsApiKey(line, apiKey))
    recomputeStatus()
    return parsed
  }

  function reserve(nextCredits = 1, extra = {}) {
    const commit = () => {
      reloadFromDisk()
      if (noteDay()) recomputeStatus()
      const forDay = currentDayKey()
      const next = Math.max(0, Number(nextCredits) || 0)
      const reason = wouldCross(next, extra)
      if (reason) {
        status = reason
        return {
          ok: false,
          status: reason,
          credits: 0,
          captures: 0,
          gameLineCredits: 0,
          dayKey: forDay,
        }
      }
      const cost = paidCredits(next)
      const captures = captureCountForAllow(next, extra)
      const gameLineInc = Math.max(0, Number(extra.gameLineCredits) || 0)
      applyUsage({ cost, captures, gameLineCredits: gameLineInc, calls: 1, day: forDay })
      log.log?.(redactOddsApiKey(`  💳 reserved Odds API credits=${cost}`, apiKey))
      return {
        ok: true,
        status: ODDS_BUDGET_OK,
        credits: cost,
        captures,
        gameLineCredits: gameLineInc,
        dayKey: forDay,
      }
    }
    if (!persistEnabled || typeof filesystem?.openSync !== 'function') return commit()
    return withOddsBudgetLock(resolveOddsBudgetPath(config.persistPath), filesystem, commit)
  }

  function reconcile(reservation, quota = {}, { credits } = {}) {
    if (!reservation?.ok) return null
    const parsed = parseQuotaInput(quota)
    const estimate = credits != null && usableRequestCost(credits) != null
      ? credits
      : reservation.credits
    const actual = creditCost({ ...parsed, last: usableRequestCost(parsed.last) }, estimate)
    const delta = actual - (Number(reservation.credits) || 0)
    const gameLineDelta = Number(reservation.gameLineCredits) > 0
      ? actual - Number(reservation.gameLineCredits)
      : 0
    const forDay = reservation.dayKey || currentDayKey()
    const commit = () => {
      reloadFromDisk()
      if (parsed.remaining != null) state.lastRemaining = parsed.remaining
      if (parsed.used != null) state.lastUsed = parsed.used
      if (parsed.remaining != null || parsed.used != null) state.quotaDay = forDay
      state.lastCost = actual
      applyUsage({
        cost: delta,
        captures: 0,
        gameLineCredits: gameLineDelta,
        calls: 0,
        day: forDay,
      })
      return parsed
    }
    if (!persistEnabled || typeof filesystem?.openSync !== 'function') return commit()
    return withOddsBudgetLock(resolveOddsBudgetPath(config.persistPath), filesystem, commit)
  }

  function logSummary() {
    emitOddsBudgetStatus(status, log)
    log.log?.(formatOddsCreditsUsed(runCredits))
    log.log?.(formatOddsCreditsRemaining(state.lastRemaining))
  }

  recomputeStatus()

  return {
    config,
    purpose,
    effectiveDailyCap,
    allow,
    wouldCross,
    reserve,
    reconcile,
    record,
    logSummary,
    quota: quotaSnapshot,
    status: () => status,
    runCredits: () => runCredits,
    runCalls: () => runCalls,
    remaining: () => state.lastRemaining,
    used: () => state.lastUsed,
    todayCredits,
    todayCloseCaptures,
    todayGameLineCredits,
    remainingCloseCaptures,
    remainingGameLineCredits,
    remainingGameLineSlots,
    hasFreshQuota,
    markProbeFailed,
    persistPath: config.persistPath,
  }
}

export async function fetchOddsApiJson(url, {
  budget,
  fetchImpl = fetch,
  estimatedCredits,
  isProbe = false,
  log = console,
  apiKey,
  gameLine = false,
  reservation = null,
} = {}) {
  const nextCredits = estimatedCredits ?? estimateCreditsFromOddsEndpoint(url)
  let held = reservation
  if (budget && !isProbe && !held && typeof budget.reserve === 'function') {
    held = budget.reserve(nextCredits, {
      gameLineCredits: gameLine ? nextCredits : 0,
    })
    if (!held?.ok) {
      const status = held?.status || budget.status()
      log.log?.(redactOddsApiKey(`  ⏸️  ${formatOddsBudgetStatus(status)}`, apiKey))
      const warn = formatOddsBudgetWarnLine(status)
      if (warn) (log.warn || log.log)?.(warn)
      return {
        skipped: true,
        status,
        data: null,
        quota: budget.quota(),
        budgetRecorded: false,
      }
    }
  } else if (budget && !isProbe && !budget.allow(nextCredits, {
    gameLineCredits: gameLine ? nextCredits : 0,
  })) {
    const status = budget.status()
    log.log?.(redactOddsApiKey(`  ⏸️  ${formatOddsBudgetStatus(status)}`, apiKey))
    const warn = formatOddsBudgetWarnLine(status)
    if (warn) (log.warn || log.log)?.(warn)
    return {
      skipped: true,
      status,
      data: null,
      quota: budget.quota(),
      budgetRecorded: false,
    }
  }
  let response
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': ODDS_API_USER_AGENT },
    })
  } catch (error) {
    // The reservation is already on the ledger. A crash or a dropped
    // response must not free those credits for a second caller.
    throw error
  }
  const quota = parseOddsApiQuota(response.headers)
  if (budget && held?.ok && typeof budget.reconcile === 'function') {
    budget.reconcile(held, quota, { credits: quota.last ?? nextCredits })
  } else if (budget) {
    budget.record(quota, { credits: quota.last ?? nextCredits, isProbe, gameLineCredits: gameLine ? (quota.last ?? nextCredits) : 0 })
  }
  if (!response.ok) {
    const text = await response.text()
    const error = new Error(redactOddsApiKey(`Odds API ${response.status}: ${text}`, apiKey))
    error.quota = quota
    throw error
  }
  return {
    skipped: false,
    status: budget ? budget.status() : ODDS_BUDGET_OK,
    data: await response.json(),
    quota,
    budgetRecorded: Boolean(budget),
  }
}

export async function refreshOddsApiQuota({
  apiKey,
  budget,
  fetchImpl = fetch,
  log = console,
} = {}) {
  return fetchOddsApiJson(buildSportsQuotaProbeUrl(apiKey), {
    fetchImpl,
    budget,
    estimatedCredits: 0,
    isProbe: true,
    apiKey,
    log,
  })
}

export async function runOddsQuotaProbe({
  apiKey,
  budget,
  fetchImpl = fetch,
  log = console,
} = {}) {
  try {
    const result = await refreshOddsApiQuota({ apiKey, budget, fetchImpl, log })
    const quota = result?.quota
    const gotHeaders = quota?.remaining != null || quota?.used != null
    if (!gotHeaders && budget?.markProbeFailed?.()) {
      emitOddsBudgetStatus(budget.status(), log)
    }
    return result
  } catch (error) {
    const redacted = redactOddsApiKey(
      `⚠️ Quota probe failed (${error.message})`,
      apiKey,
    )
    if (budget?.markProbeFailed?.()) {
      log.log?.(redacted)
      emitOddsBudgetStatus(budget.status(), log)
    } else {
      log.log?.(`${redacted}; continuing with today's quota headers.`)
    }
    return {
      skipped: true,
      probeFailed: true,
      error,
      status: budget ? budget.status() : ODDS_BUDGET_PROBE_FAILED,
      quota: budget ? budget.quota() : { remaining: null, used: null, last: null },
      budgetRecorded: false,
    }
  }
}
