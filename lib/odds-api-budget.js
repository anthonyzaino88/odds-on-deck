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
const FENCE_MOVED = 'ODDS_BUDGET_FENCE_MOVED'

function budgetLockStaleMs() {
  return parseEnvNonNegInt(process.env.ODDS_BUDGET_LOCK_STALE_MS, 30 * 1000)
}
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
    settled: {},
    days: {},
  }
}

function settledEntry(row) {
  if (!row || typeof row !== 'object') return null
  const day = row.day ? String(row.day) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const actual = Number(row.actual)
  if (!Number.isFinite(actual) || actual < 0) return null
  return { day, actual }
}

function normalizeSettled(raw) {
  const settled = {}
  if (!raw || typeof raw !== 'object') return settled
  for (const [id, row] of Object.entries(raw)) {
    if (!id || id === '__proto__' || id === 'constructor' || id === 'prototype') continue
    const entry = settledEntry(row)
    if (entry) settled[id] = entry
  }
  return settled
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
  state.settled = normalizeSettled(raw.settled)
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

function fenceCommitPath(filePath, fence) {
  return `${filePath}.fence-${fenceValue(fence)}`
}

function readFenceCommit(filesystem, commitPath, fence) {
  try {
    if (typeof filesystem.existsSync === 'function' && !filesystem.existsSync(commitPath)) return null
    const parsed = normalizeState(JSON.parse(filesystem.readFileSync(commitPath, 'utf8')))
    if (fenceValue(parsed.fence) !== fenceValue(fence)) return null
    return parsed
  } catch {
    return null
  }
}

function highestFenceCommit(filesystem, filePath, above) {
  if (typeof filesystem.readdirSync !== 'function') return null
  const dir = path.dirname(filePath)
  const prefix = `${path.basename(filePath)}.fence-`
  let names = []
  try {
    names = filesystem.readdirSync(dir)
  } catch {
    return null
  }
  let best = null
  let bestFence = fenceValue(above)
  for (const name of names) {
    const label = String(name)
    if (!label.startsWith(prefix)) continue
    const n = Number(label.slice(prefix.length))
    if (!Number.isInteger(n) || n <= bestFence) continue
    const parsed = readFenceCommit(filesystem, path.join(dir, label), n)
    if (!parsed) continue
    best = parsed
    bestFence = n
  }
  return best
}

/**
 * The fence file is the commit. budget.json is only a pointer, so a
 * crash between link and the pointer update must still be visible.
 */
function adoptPublishedFence(filesystem, filePath, state) {
  let current = state || emptyState()
  for (let step = 0; step < 1000; step += 1) {
    const nextFence = fenceValue(current.fence) + 1
    const next = readFenceCommit(filesystem, fenceCommitPath(filePath, nextFence), nextFence)
    if (!next) break
    current = next
  }
  return highestFenceCommit(filesystem, filePath, current.fence) || current
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
  let parsed = null
  let missing = false
  let failed = null
  try {
    if (typeof filesystem.existsSync === 'function' && !filesystem.existsSync(filePath)) {
      missing = true
    } else {
      parsed = normalizeState(JSON.parse(filesystem.readFileSync(filePath, 'utf8')))
    }
  } catch (error) {
    failed = error
    parsed = null
  }
  const adopted = adoptPublishedFence(filesystem, filePath, parsed || emptyState())
  if (parsed || fenceValue(adopted.fence) > 0) return adopted
  if (warn) {
    if (missing) {
      emitLedgerWarn(log, `⚠️ Odds budget ledger missing at ${filePath}; starting empty`)
    } else {
      emitLedgerWarn(
        log,
        `⚠️ Odds budget ledger corrupt or unreadable at ${filePath}: ${failed?.message || 'unreadable'}; starting empty`,
      )
    }
  }
  return emptyState()
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
  out.fence = fenceValue(diskState.fence)
  out.settled = { ...diskState.settled, ...memState.settled }
  return out
}

function pruneSettled(state) {
  const months = new Set(
    Object.keys(state.days || {}).map((day) => String(day).slice(0, 7)),
  )
  const settled = {}
  for (const [id, row] of Object.entries(state.settled || {})) {
    if (row?.day && months.has(String(row.day).slice(0, 7))) settled[id] = row
  }
  state.settled = settled
  return state
}

function writeBudgetFile(filesystem, filePath, merged) {
  const dir = path.dirname(filePath)
  filesystem.mkdirSync?.(dir, { recursive: true })
  const payload = `${JSON.stringify(merged, null, 2)}\n`
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  filesystem.writeFileSync(tmp, payload, 'utf8')
  if (typeof filesystem.renameSync === 'function') {
    try {
      filesystem.renameSync(tmp, filePath)
      return
    } catch {
      // Windows rename does not replace an existing file.
    }
  }
  try {
    filesystem.unlinkSync?.(filePath)
  } catch {
    // missing pointer; the rename below creates it
  }
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

function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    const until = Date.now() + ms
    while (Date.now() < until) { /* publish gate wait */ }
  }
}

/**
 * Test-only pause immediately before the fence link. Unset in production.
 * The holder writes `<gate>.paused` and waits until `<gate>.go` exists.
 */
function waitForPublishGate(filesystem) {
  const gate = process.env.ODDS_BUDGET_PUBLISH_GATE
  if (!gate) return
  filesystem.mkdirSync?.(path.dirname(gate), { recursive: true })
  filesystem.writeFileSync(`${gate}.paused`, String(process.pid))
  const started = Date.now()
  while (!filesystem.existsSync?.(`${gate}.go`)) {
    if (Date.now() - started > 15000) {
      throw new Error('Odds budget publish gate timed out')
    }
    sleepMs(20)
  }
}

function pruneSupersededFences(filesystem, filePath, fence) {
  if (typeof filesystem.readdirSync !== 'function') return
  const dir = path.dirname(filePath)
  const prefix = `${path.basename(filePath)}.fence-`
  const current = fenceValue(fence)
  let names = []
  try {
    names = filesystem.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const label = String(name)
    if (!label.startsWith(prefix)) continue
    const n = Number(label.slice(prefix.length))
    if (!Number.isInteger(n) || n < 1 || n >= current) continue
    try {
      filesystem.unlinkSync(path.join(dir, label))
    } catch {
      // an older fence is only a backup
    }
  }
}

/**
 * Publish by hard-linking a fully written temp file onto
 * `<ledger>.fence-<seen+1>`. link fails with EEXIST on POSIX and NTFS
 * when that name exists, so the link is the commit. A later rename of
 * budget.json is only a pointer and must not decide the race.
 */
function publishBudgetCommit(filesystem, filePath, merged) {
  const dir = path.dirname(filePath)
  filesystem.mkdirSync?.(dir, { recursive: true })
  const payload = `${JSON.stringify(merged, null, 2)}\n`
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  filesystem.writeFileSync(tmp, payload, 'utf8')
  const commitPath = fenceCommitPath(filePath, merged.fence)
  try {
    waitForPublishGate(filesystem)
    if (typeof filesystem.linkSync !== 'function') {
      throw new Error('Odds budget filesystem cannot publish a fence commit')
    }
    filesystem.linkSync(tmp, commitPath)
  } catch (error) {
    try { filesystem.unlinkSync?.(tmp) } catch { /* loser tmp */ }
    if (error?.code === 'EEXIST') {
      const moved = new Error('Odds budget fence moved')
      moved.code = FENCE_MOVED
      throw moved
    }
    throw error
  }
  try {
    writeBudgetFile(filesystem, filePath, merged)
    pruneSupersededFences(filesystem, filePath, merged.fence)
  } catch {
    // The fence file is already the commit. The next read adopts it.
  }
  try { filesystem.unlinkSync?.(tmp) } catch { /* hard link keeps the bytes */ }
}

/**
 * Exclusive create of `<ledger>.lock`. The holder re-reads the ledger
 * and applies one reservation before the Odds API call. A stale lock
 * (crashed holder) can be removed. Nested calls from the same write
 * reuse the lock the outer reserve already holds. The commit itself is
 * the fence link, not a check that runs before a separate write.
 */
const budgetLockHeld = new Map()

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
        stale = Date.now() - Number(stat.mtimeMs || 0) > budgetLockStaleMs()
      } catch {
        stale = false
      }
      if (stale) {
        try { filesystem.unlinkSync(lockPath) } catch { /* raced */ }
        continue
      }
      if (Date.now() - started > budgetLockStaleMs()) {
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
  return withOddsBudgetLock(filePath, filesystem, () => {
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
    pruneSettled(merged)
    publishBudgetCommit(filesystem, filePath, merged)
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

  function reloadFromDisk({ replace = false } = {}) {
    if (!persistEnabled) return
    const disk = loadOddsBudgetState({ ...persistOpts, warn: false })
    if (replace) {
      // This attempt did not commit. Disk may have moved down (a reconcile
      // landed), so max(memory, disk) would resurrect the stale charge.
      state.days = {}
      for (const [day, row] of Object.entries(disk.days || {})) {
        state.days[day] = dayRow(row)
      }
      state.settled = { ...(disk.settled || {}) }
    } else {
      const merged = mergeBudgetStates(disk, state, {
        dayKey: currentDayKey(),
        thisCost: 0,
        thisCaptures: 0,
        thisGameLineCredits: 0,
        thisCalls: 0,
      })
      state.days = merged.days
      state.settled = { ...(state.settled || {}), ...(disk.settled || {}) }
    }
    state.fence = fenceValue(disk.fence)
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
    const settled = {}
    for (const [id, row] of Object.entries(state.settled || {})) {
      if (row?.day && keepMonths.has(String(row.day).slice(0, 7))) settled[id] = row
    }
    state.settled = settled
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
      state.settled = merged.settled || {}
      state.fence = fenceValue(merged.fence)
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

  function refusal(reason, forDay) {
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

  function commitWithFence(commit) {
    const filePath = resolveOddsBudgetPath(config.persistPath)
    const run = () => (
      persistEnabled && typeof filesystem?.openSync === 'function'
        ? withOddsBudgetLock(filePath, filesystem, commit)
        : commit()
    )
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return run()
      } catch (error) {
        if (error?.code !== FENCE_MOVED) throw error
        reloadFromDisk({ replace: true })
        if (attempt === 2) return null
      }
    }
    return null
  }

  function reserve(nextCredits = 1, extra = {}) {
    const commit = () => {
      reloadFromDisk()
      if (noteDay()) recomputeStatus()
      const forDay = currentDayKey()
      const next = Math.max(0, Number(nextCredits) || 0)
      const reason = wouldCross(next, extra)
      if (reason) return refusal(reason, forDay)
      const cost = paidCredits(next)
      const captures = captureCountForAllow(next, extra)
      const gameLineInc = Math.max(0, Number(extra.gameLineCredits) || 0)
      const id = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      applyUsage({ cost, captures, gameLineCredits: gameLineInc, calls: 1, day: forDay })
      log.log?.(redactOddsApiKey(`  💳 reserved Odds API credits=${cost}`, apiKey))
      return {
        ok: true,
        status: ODDS_BUDGET_OK,
        id,
        credits: cost,
        captures,
        gameLineCredits: gameLineInc,
        dayKey: forDay,
      }
    }
    const reserved = commitWithFence(commit)
    if (reserved) return reserved
    return refusal(wouldCross(nextCredits, extra) || ODDS_BUDGET_CLOSE_CAP, currentDayKey())
  }

  function reconcile(reservation, quota = {}, { credits } = {}) {
    if (!reservation?.ok) return null
    const id = reservation.id ? String(reservation.id) : ''
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
      if (id && state.settled?.[id]) return parsed
      const previousSettled = state.settled
      if (id) {
        state.settled = {
          ...(state.settled || {}),
          [id]: { day: forDay, actual },
        }
      }
      if (parsed.remaining != null) state.lastRemaining = parsed.remaining
      if (parsed.used != null) state.lastUsed = parsed.used
      if (parsed.remaining != null || parsed.used != null) state.quotaDay = forDay
      state.lastCost = actual
      try {
        applyUsage({
          cost: delta,
          captures: 0,
          gameLineCredits: gameLineDelta,
          calls: 0,
          day: forDay,
        })
      } catch (error) {
        state.settled = previousSettled
        throw error
      }
      return parsed
    }
    return commitWithFence(commit)
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
