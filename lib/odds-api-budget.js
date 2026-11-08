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
export const ODDS_BUDGET_LEDGER_UNREADABLE = 'ledger_unreadable'

export const DEFAULT_DAILY_CREDIT_CAP = 1500
export const DEFAULT_MONTHLY_CREDIT_CAP = 17000
export const DEFAULT_REMAINING_FLOOR = 3000
export const DEFAULT_CLOSE_CAPTURE_RESERVE = 200
export const DEFAULT_CLOSE_CAPTURE_DAILY_CAP = 40
/**
 * Documented leftover of the 40 prop-capture slots. Game-line calls no
 * longer draw from that pool; they use ODDS_GAME_LINE_RESERVED_SLOTS.
 */
export const DEFAULT_CLOSE_CAPTURE_PROP_HEADROOM = 28
/** Full Sunday NFL slate plus a full NHL night. One reserved call per game. */
export const DEFAULT_NFL_SLATE_GAMES = 16
export const DEFAULT_NHL_SLATE_GAMES = 15
export const DEFAULT_GAME_LINE_RESERVED_SLOTS = DEFAULT_NFL_SLATE_GAMES + DEFAULT_NHL_SLATE_GAMES
/**
 * h2h + puck line/spread + totals, one region. 31 slots × 3 markets = 93
 * so a full NFL+NHL slate with --spreads still closes. Together with the
 * 40 prop captures this stays under DEFAULT_DAILY_CREDIT_CAP (1500).
 */
export const DEFAULT_GAME_LINE_MARKETS_PER_CALL = 3
export const DEFAULT_GAME_LINE_CLOSE_DAILY_CAP = (
  DEFAULT_GAME_LINE_RESERVED_SLOTS * DEFAULT_GAME_LINE_MARKETS_PER_CALL
)
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
    gameLineReservedSlots: parseEnvNonNegInt(
      env.ODDS_GAME_LINE_RESERVED_SLOTS,
      DEFAULT_GAME_LINE_RESERVED_SLOTS,
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

/** A fence id is an integer before any flooring. 1.9 is not fence 1. */
function integerFence(value) {
  if (!Number.isInteger(value) || value < 0) return null
  return value
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

const SANITIZE_MAX_DEPTH = 8

/**
 * One scrub for Odds API failures. Bearer/Basic tokens are removed
 * before generic key=value replacement, then query strings.
 */
export function sanitizeOddsApiLogText(text, apiKey) {
  let raw = String(text ?? '')
  if (apiKey) raw = raw.split(String(apiKey)).join('[redacted]')
  raw = raw.replace(
    /((?:authorization\s*[:=]\s*)?(?:bearer|basic)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi,
    '$1[redacted]',
  )
  raw = raw.replace(
    /(authorization\s*[:=]\s*)(?!(?:bearer|basic)\b)(?:"[^"]*"|'[^']*'|\S+)/gi,
    '$1[redacted]',
  )
  raw = raw.replace(
    /((?:https?:\/\/|\/)[^\s"'<>)\\]*)\?[^\s"'<>)\\]*/gi,
    '$1?[redacted]',
  )
  raw = raw.replace(
    /((?:api[_-]?key|apikey|access[_-]?token|token|secret|password)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s&"',<>]+)/gi,
    '$1[redacted]',
  )
  return raw
}

/**
 * Fresh error chain. The input object is never returned or attached,
 * including when it is frozen or its cause points at itself.
 */
export function sanitizeOddsApiError(error, apiKey, seen = new Set(), depth = 0) {
  if (depth > SANITIZE_MAX_DEPTH) return new Error('[redacted]')
  if (error == null || typeof error !== 'object') {
    if (typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean') {
      return new Error(sanitizeOddsApiLogText(error, apiKey))
    }
    return error
  }
  if (seen.has(error)) return new Error('[redacted]')
  seen.add(error)
  const message = sanitizeOddsApiLogText(
    typeof error.message === 'string' ? error.message : '',
    apiKey,
  )
  const name = sanitizeOddsApiLogText(
    typeof error.name === 'string' && error.name ? error.name : 'Error',
    apiKey,
  )
  const stack = typeof error.stack === 'string'
    ? sanitizeOddsApiLogText(error.stack, apiKey)
    : undefined
  let cause
  if (typeof error.cause === 'string') {
    cause = sanitizeOddsApiLogText(error.cause, apiKey)
  } else if (error.cause != null) {
    cause = sanitizeOddsApiError(error.cause, apiKey, seen, depth + 1)
  }
  const fresh = new Error(message, cause !== undefined ? { cause } : undefined)
  fresh.name = name
  if (stack) fresh.stack = stack
  if (Array.isArray(error.errors)) {
    fresh.errors = error.errors.map((item) => (
      item && typeof item === 'object'
        ? sanitizeOddsApiError(item, apiKey, seen, depth + 1)
        : sanitizeOddsApiLogText(item, apiKey)
    ))
  }
  if (error.quota && typeof error.quota === 'object') fresh.quota = { ...error.quota }
  if (error.code != null && typeof error.code !== 'object') fresh.code = error.code
  return fresh
}

export function sanitizedErrorMessage(error, apiKey) {
  if (error == null) return ''
  if (typeof error !== 'object') return sanitizeOddsApiLogText(error, apiKey)
  return sanitizeOddsApiError(error, apiKey).message || ''
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
    gameLineCaptures: 0,
  }
}

function dayRow(row) {
  return {
    credits: Number(row?.credits) || 0,
    calls: Number(row?.calls) || 0,
    closeCaptures: Number(row?.closeCaptures) || 0,
    gameLineCredits: Number(row?.gameLineCredits) || 0,
    gameLineCaptures: Number(row?.gameLineCaptures) || 0,
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
    fenceDay: null,
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
  state.fenceDay = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.fenceDay || '')) ? String(raw.fenceDay) : null
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

const TEMP_PRUNE_AGE_MS = 48 * 60 * 60 * 1000

function fenceRoot(filePath) {
  return `${filePath}.fences`
}

function fenceCommitPath(filePath, fence) {
  return path.join(fenceRoot(filePath), String(fenceValue(fence)))
}

function totalCaptures(state) {
  let total = 0
  for (const row of Object.values(state?.days || {})) {
    total += Number(row?.closeCaptures) || 0
  }
  return total
}

function preferKnown(known, candidate, complete) {
  if (!candidate) return known
  if (!known) return candidate
  const knownFence = fenceValue(known.fence)
  const candidateFence = fenceValue(candidate.fence)
  const knownCaptures = totalCaptures(known)
  const candidateCaptures = totalCaptures(candidate)
  if (candidateFence > knownFence) {
    if (!complete && candidateCaptures < knownCaptures) return known
    return candidate
  }
  if (candidateFence === knownFence && candidateCaptures > knownCaptures) return candidate
  return known
}

function listDir(filesystem, dir) {
  try {
    if (typeof filesystem.existsSync === 'function' && !filesystem.existsSync(dir)) {
      return { names: [], disappeared: false }
    }
    if (typeof filesystem.readdirSync !== 'function') return { names: [], disappeared: false }
    return { names: filesystem.readdirSync(dir).map(String), disappeared: false }
  } catch (error) {
    return { names: [], disappeared: error?.code === 'ENOENT' || error?.code === 'ENOTDIR' }
  }
}

function readFenceFile(filesystem, commitPath, fence) {
  try {
    if (typeof filesystem.existsSync === 'function' && !filesystem.existsSync(commitPath)) {
      return { missing: true, parsed: null }
    }
    const raw = JSON.parse(filesystem.readFileSync(commitPath, 'utf8'))
    const filenameFence = integerFence(fence)
    if (integerFence(raw?.fence) === null || integerFence(raw?.fence) !== filenameFence) {
      return { missing: false, parsed: null }
    }
    return { missing: false, parsed: normalizeState(raw) }
  } catch (error) {
    return { missing: error?.code === 'ENOENT', parsed: null }
  }
}

function readPointerFile(filesystem, filePath) {
  try {
    if (typeof filesystem.existsSync === 'function' && !filesystem.existsSync(filePath)) {
      return { missing: true, invalid: false, parsed: null }
    }
    const raw = JSON.parse(filesystem.readFileSync(filePath, 'utf8'))
    if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'fence')
      && integerFence(raw.fence) === null) {
      return { missing: false, invalid: true, parsed: null }
    }
    return { missing: false, invalid: false, parsed: normalizeState(raw) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { missing: true, invalid: false, parsed: null }
    return { missing: false, invalid: true, parsed: null, error }
  }
}

const FENCE_PROBE_LIMIT = 100000

function fenceFileExists(filesystem, commitPath) {
  if (typeof filesystem.existsSync !== 'function') return true
  return Boolean(filesystem.existsSync(commitPath))
}

function listedFenceNumbers(filesystem, filePath) {
  const listed = listDir(filesystem, fenceRoot(filePath))
  const numbers = []
  let sawEntry = false
  let invalidName = false
  for (const name of listed.names) {
    if (!name) continue
    sawEntry = true
    const fence = Number(name)
    if (Number.isInteger(fence) && fence > 0 && String(fence) === name) numbers.push(fence)
    else invalidName = true
  }
  return { numbers, disappeared: listed.disappeared, sawEntry, invalidName }
}

/**
 * Only the highest numbered fence is the balance. A file that disappears
 * is a race. A file that is present but corrupt, or whose content fence
 * does not match the filename, is unreadable. A lower file is not a fallback.
 */
function readMaxFence(filesystem, filePath, numbers) {
  if (numbers.length === 0) return { raced: false, invalid: false, parsed: null }
  let fence = 0
  for (const number of numbers) if (number > fence) fence = number
  const read = readFenceFile(filesystem, fenceCommitPath(filePath, fence), fence)
  if (read.missing) return { raced: true, invalid: false, parsed: null }
  if (!read.parsed) return { raced: false, invalid: true, parsed: null }
  return { raced: false, invalid: false, parsed: read.parsed }
}

function scanAllFences(filesystem, filePath) {
  const listed = listedFenceNumbers(filesystem, filePath)
  if (listed.disappeared) {
    return { best: null, complete: false, unreadable: false, sawEntry: true }
  }
  if (listed.invalidName) {
    return { best: null, complete: true, unreadable: true, sawEntry: true }
  }
  const read = readMaxFence(filesystem, filePath, listed.numbers)
  if (read.raced) {
    return { best: null, complete: false, unreadable: false, sawEntry: true }
  }
  if (read.invalid) {
    return { best: null, complete: true, unreadable: true, sawEntry: true }
  }
  if (read.parsed) {
    return { best: read.parsed, complete: true, unreadable: false, sawEntry: true }
  }
  if (listed.sawEntry) {
    return { best: null, complete: true, unreadable: true, sawEntry: true }
  }
  return { best: null, complete: true, unreadable: false, sawEntry: false }
}

/**
 * The pointer is only a hint for where the contiguous tail starts.
 * The balance always comes from a fence file whose content matches its name.
 * A hint that is missing, corrupt, or names a file that is not there
 * falls through to a full scan. Hitting the probe cap does too: stopping
 * there would hide a higher fence.
 */
function scanFenceCommits(filesystem, filePath, hint) {
  const hinted = fenceValue(hint)
  if (hinted > 0 && fenceFileExists(filesystem, fenceCommitPath(filePath, hinted))) {
    let fence = hinted
    let hitCap = false
    for (let step = 0; step < FENCE_PROBE_LIMIT; step += 1) {
      const next = fence + 1
      if (!fenceFileExists(filesystem, fenceCommitPath(filePath, next))) break
      fence = next
      if (step === FENCE_PROBE_LIMIT - 1) hitCap = true
    }
    if (hitCap && fenceFileExists(filesystem, fenceCommitPath(filePath, fence + 1))) {
      return scanAllFences(filesystem, filePath)
    }
    const read = readFenceFile(filesystem, fenceCommitPath(filePath, fence), fence)
    if (read.missing) return { best: null, complete: false, unreadable: false, sawEntry: true }
    if (!read.parsed) return { best: null, complete: true, unreadable: true, sawEntry: true }
    const listed = listedFenceNumbers(filesystem, filePath)
    if (listed.disappeared) return { best: null, complete: false, unreadable: false, sawEntry: true }
    if (listed.invalidName) return { best: null, complete: true, unreadable: true, sawEntry: true }
    let maxListed = 0
    for (const number of listed.numbers) if (number > maxListed) maxListed = number
    if (maxListed !== fence) return scanAllFences(filesystem, filePath)
    return { best: read.parsed, complete: true, unreadable: false, sawEntry: true }
  }
  return scanAllFences(filesystem, filePath)
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
  const refuse = (why) => {
    const closed = emptyState()
    closed.unreadable = true
    if (warn) {
      emitLedgerWarn(
        log,
        `⚠️ Odds budget ledger at ${filePath} could not be validated (${why}); refusing paid calls`,
      )
    }
    return closed
  }
  let known = null
  let pointerState = null
  let missing = false
  let pointerInvalid = false
  let sawEntry = false
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const pointer = readPointerFile(filesystem, filePath)
    if (pointer.invalid) {
      pointerInvalid = true
      continue
    }
    pointerInvalid = false
    let hint = 0
    let attemptPointer = null
    if (pointer.missing) {
      if (attempt === 0) missing = true
    } else {
      attemptPointer = pointer.parsed
      hint = fenceValue(attemptPointer.fence)
    }
    const scanned = scanFenceCommits(filesystem, filePath, hint)
    if (scanned.sawEntry) sawEntry = true
    else if (attemptPointer) pointerState = attemptPointer
    known = preferKnown(known, scanned.best, scanned.complete)
    if (scanned.complete && !scanned.unreadable) break
    if (scanned.complete && scanned.unreadable && !known) break
  }
  if (pointerInvalid) return refuse('pointer')
  if (known) return known
  // A pointer-only ledger has not published a fence yet. The pointer
  // file has to parse. Once any fence file exists, that file is the balance.
  if (!sawEntry && pointerState) return pointerState
  if (sawEntry) return refuse('fence')
  if (warn && missing) {
    emitLedgerWarn(log, `⚠️ Odds budget ledger missing at ${filePath}; starting empty`)
  }
  return emptyState()
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
 * Test-only pause. Unset in production. The holder writes
 * `<gate>.paused` and waits until `<gate>.go` exists.
 */
function waitForBudgetGate(filesystem, envName) {
  const gate = process.env[envName]
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Fence files stay. Deleting one lets a holder that already chose that
 * number link it again. Temp files older than 48 hours are still removed.
 */
function pruneOldTempFiles(filesystem, filePath) {
  if (typeof filesystem.readdirSync !== 'function') return
  const oldest = Date.now() - TEMP_PRUNE_AGE_MS
  const parent = listDir(filesystem, path.dirname(filePath))
  const tmpRe = new RegExp(`^${escapeRegExp(path.basename(filePath))}\\.\\d+\\.(\\d+)\\.[a-z0-9]+\\.tmp$`, 'i')
  for (const name of parent.names) {
    const match = tmpRe.exec(name)
    if (!match) continue
    const stamped = Number(match[1])
    if (!Number.isFinite(stamped) || stamped >= oldest) continue
    try { filesystem.unlinkSync(path.join(path.dirname(filePath), name)) } catch { /* already gone */ }
  }
}

/**
 * Publish by hard-linking a fully written temp file onto
 * `<ledger>.fences/<snapshot fence + 1>`. link fails with EEXIST on
 * POSIX and NTFS when that name exists, so the link is the commit.
 * The ET day stays in the JSON. budget.json is only a pointer.
 */
function publishBudgetCommit(filesystem, filePath, merged) {
  const dir = path.dirname(filePath)
  filesystem.mkdirSync?.(dir, { recursive: true })
  const payload = `${JSON.stringify(merged, null, 2)}\n`
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  filesystem.writeFileSync(tmp, payload, 'utf8')
  const commitPath = fenceCommitPath(filePath, merged.fence)
  filesystem.mkdirSync?.(path.dirname(commitPath), { recursive: true })
  try {
    waitForBudgetGate(filesystem, 'ODDS_BUDGET_PUBLISH_GATE')
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
  } catch {
    // The fence file is already the commit. The next read adopts it.
  }
  pruneOldTempFiles(filesystem, filePath)
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
  dayKey,
  todayKey,
} = {}) {
  if (!persist) return state
  const filePath = resolveOddsBudgetPath(persistPath)
  return withOddsBudgetLock(filePath, filesystem, () => {
    // Publish this object only. A second load would merge a newer
    // balance into a decision that was made on a different snapshot.
    waitForBudgetGate(filesystem, 'ODDS_BUDGET_ALLOCATE_GATE')
    const published = normalizeState(state)
    published.fence = fenceValue(state.fence) + 1
    published.fenceDay = todayKey || dayKey || published.fenceDay || null
    pruneSettled(published)
    publishBudgetCommit(filesystem, filePath, published)
    return published
  })
}

/**
 * Line credits to keep after x-requests-last comes back.
 * A mixed call refunds missing prop markets first. Line credits stay
 * at the markets that were returned (markets × regions) and are never
 * scaled down just because a prop market was absent.
 * A game-line-only call (line reservation covers the whole estimate)
 * still settles to the actual cost.
 */
export function reconciledGameLineCredits({
  reservedLine = 0,
  reservedTotal = 0,
  actual = 0,
  lineMarketsReturned = null,
  regions = null,
} = {}) {
  const line = Math.max(0, Number(reservedLine) || 0)
  const total = Math.max(0, Number(reservedTotal) || 0)
  const spent = Math.max(0, Number(actual) || 0)
  if (line <= 0) return 0
  if (total <= 0 || line >= total) return spent
  const propReserved = Math.max(0, total - line)
  const shortfall = Math.max(0, total - spent)
  const lineRefund = Math.max(0, shortfall - propReserved)
  let lineSpent = Math.max(0, line - lineRefund)
  if (lineMarketsReturned != null && regions != null) {
    const regionCount = Math.max(1, Math.floor(Number(regions) || 1))
    const attributed = Math.max(0, Math.floor(Number(lineMarketsReturned) || 0)) * regionCount
    lineSpent = Math.max(lineSpent, Math.min(attributed, spent))
  }
  return Math.min(lineSpent, spent)
}

function returnedGameLineMarketCount(data) {
  const events = Array.isArray(data) ? data : [data]
  const keys = new Set()
  let sawBookmakers = false
  for (const event of events) {
    if (!event || typeof event !== 'object' || !Array.isArray(event.bookmakers)) continue
    sawBookmakers = true
    for (const book of event.bookmakers) {
      for (const market of book?.markets || []) {
        const key = String(market?.key || '').toLowerCase().trim()
        if (key === 'h2h' || key === 'spreads' || key === 'totals') keys.add(key)
      }
    }
  }
  return sawBookmakers ? keys.size : null
}

function regionCountFromOddsUrl(url) {
  try {
    const count = countCsvParam(new URL(String(url)).searchParams, 'regions')
    return count || 1
  } catch {
    return 1
  }
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
  const loaded = seeded || loadOddsBudgetState(persistOpts)
  const state = normalizeState(loaded)
  if (loaded?.unreadable) state.unreadable = true
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

  function todayGameLineCaptures() {
    return Number(state.days[currentDayKey()]?.gameLineCaptures) || 0
  }

  function remainingCloseCaptures() {
    return Math.max(0, config.closeCaptureDailyCap - todayCloseCaptures())
  }

  function remainingGameLineCredits() {
    return Math.max(0, config.gameLineCloseDailyCap - todayGameLineCredits())
  }

  /**
   * Game-line HTTP calls left today. Prop closeCaptures do not draw
   * this down. Sized for a full NFL + NHL slate unless overridden.
   */
  function remainingGameLineSlots() {
    return Math.max(0, config.gameLineReservedSlots - todayGameLineCaptures())
  }

  function reloadFromDisk() {
    if (!persistEnabled) return
    const filePath = resolveOddsBudgetPath(config.persistPath)
    const hasPointer = typeof filesystem.existsSync === 'function' && filesystem.existsSync(filePath)
    const hasFences = typeof filesystem.existsSync === 'function' && filesystem.existsSync(fenceRoot(filePath))
    // Nothing has been committed. Keep an in-memory seed.
    if (!hasPointer && !hasFences) return
    const disk = loadOddsBudgetState({ ...persistOpts, warn: false })
    if (disk.unreadable) {
      state.unreadable = true
      return
    }
    state.unreadable = false
    // Replace. max(memory, disk) would resurrect a charge this attempt
    // did not commit, including a refund that already landed.
    state.days = {}
    for (const [day, row] of Object.entries(disk.days || {})) {
      state.days[day] = dayRow(row)
    }
    state.settled = { ...(disk.settled || {}) }
    state.fence = fenceValue(disk.fence)
    state.fenceDay = disk.fenceDay || null
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
    if (state.unreadable) return ODDS_BUDGET_LEDGER_UNREADABLE
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
    const gameLineCall = isCloseCapture && Number(extra.gameLineCredits) > 0
    const countPropCapture = extra.countPropCapture === true
    if (gameLineCall) {
      const gameLineCost = Math.max(0, Number(extra.gameLineCredits) || 0)
      if (todayGameLineCredits() + gameLineCost > config.gameLineCloseDailyCap) {
        return ODDS_BUDGET_GAME_LINE_CAP
      }
      const slots = Math.max(captures, 1)
      if (todayGameLineCaptures() + slots > config.gameLineReservedSlots) {
        return ODDS_BUDGET_GAME_LINE_CAP
      }
    }
    if (isCloseCapture && captures > 0 && (countPropCapture || !gameLineCall)
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
    if (state.unreadable) {
      status = ODDS_BUDGET_LEDGER_UNREADABLE
      return
    }
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
    const gameLineCall = Number(extra.gameLineCredits) > 0
    if (status === ODDS_BUDGET_GAME_LINE_CAP && !gameLineCall) {
      recomputeStatus()
    }
    if (probeFailedWithoutTodayHeaders) {
      return !wouldCross(next, extra)
    }
    const propCapBlocksGameLine = status === ODDS_BUDGET_CLOSE_CAP && gameLineCall
    if (status !== ODDS_BUDGET_OK && !propCapBlocksGameLine) return false
    const reason = wouldCross(next, extra)
    if (reason) {
      status = reason
      return false
    }
    if (propCapBlocksGameLine) status = ODDS_BUDGET_OK
    return true
  }

  function persistState(forDay = currentDayKey()) {
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
      todayKey: currentDayKey(),
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
      state.fenceDay = merged.fenceDay || state.fenceDay || null
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
    gameLineCaptures = 0,
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
    row.gameLineCaptures = Math.max(0, row.gameLineCaptures + gameLineCaptures)
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
      persistState(forDay)
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

  function record(quota = {}, {
    credits,
    captures,
    isProbe = false,
    gameLineCredits = 0,
    countPropCapture = false,
  } = {}) {
    const parsed = parseQuotaInput(quota)
    const cost = creditCost(parsed, credits)
    const captureInc = isCloseCapture && !isProbe && cost > 0
      ? Math.max(0, captures != null ? Number(captures) || 0 : 1)
      : 0
    const gameLineInc = Math.max(0, Number(gameLineCredits) || 0)
    const commit = () => {
      reloadFromDisk()
      if (state.unreadable) {
        status = ODDS_BUDGET_LEDGER_UNREADABLE
        return parsed
      }
      if (noteDay()) recomputeStatus()
      const forDay = currentDayKey()
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
      row.closeCaptures += gameLineInc > 0 && !countPropCapture ? 0 : captureInc
      row.gameLineCredits += gameLineInc
      row.gameLineCaptures += gameLineInc > 0 ? Math.max(captureInc, 1) : 0
      state.days[forDay] = row
      try {
        persistState(forDay)
      } catch (error) {
        state.days[forDay] = beforeRow
        restoreQuota(beforeQuota)
        runCredits = beforeRunCredits
        runCalls = beforeRunCalls
        throw error
      }
      recomputeStatus()
      return parsed
    }
    const saved = commitWithFence(commit)
    if (!saved) {
      const moved = new Error('Odds budget fence moved')
      moved.code = FENCE_MOVED
      throw moved
    }
    if (status === ODDS_BUDGET_LEDGER_UNREADABLE) return saved
    const line = `  💳 Odds API credits last=${parsed.last ?? cost} used=${parsed.used ?? state.lastUsed ?? '?'} remaining=${parsed.remaining ?? state.lastRemaining ?? '?'}`
    log.log?.(sanitizeOddsApiLogText(line, apiKey))
    return saved
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
        reloadFromDisk()
        if (attempt === 2) return null
      }
    }
    return null
  }

  function reserve(nextCredits = 1, extra = {}) {
    const commit = () => {
      // Admission and the linked fence share this snapshot. A later
      // disk merge would add the same charge on top of a newer balance.
      reloadFromDisk()
      if (noteDay()) recomputeStatus()
      const forDay = currentDayKey()
      const next = Math.max(0, Number(nextCredits) || 0)
      const reason = wouldCross(next, extra)
      if (reason) return refusal(reason, forDay)
      waitForBudgetGate(filesystem, 'ODDS_BUDGET_ADMIT_GATE')
      const cost = paidCredits(next)
      const captures = captureCountForAllow(next, extra)
      const gameLineInc = Math.max(0, Number(extra.gameLineCredits) || 0)
      const countPropCapture = extra.countPropCapture === true
      const id = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      applyUsage({
        cost,
        captures: gameLineInc > 0 && !countPropCapture ? 0 : captures,
        gameLineCredits: gameLineInc,
        gameLineCaptures: gameLineInc > 0 ? Math.max(captures, 1) : 0,
        calls: 1,
        day: forDay,
      })
      log.log?.(sanitizeOddsApiLogText(`  💳 reserved Odds API credits=${cost}`, apiKey))
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

  function reconcile(reservation, quota = {}, {
    credits,
    lineMarketsReturned = null,
    regions = null,
  } = {}) {
    if (!reservation?.ok) return null
    const id = reservation.id ? String(reservation.id) : ''
    const parsed = parseQuotaInput(quota)
    const estimate = credits != null && usableRequestCost(credits) != null
      ? credits
      : reservation.credits
    const actual = creditCost({ ...parsed, last: usableRequestCost(parsed.last) }, estimate)
    const delta = actual - (Number(reservation.credits) || 0)
    const reservedLine = Number(reservation.gameLineCredits) || 0
    const reservedTotal = Number(reservation.credits) || 0
    const gameLineDelta = reservedLine > 0
      ? reconciledGameLineCredits({
        reservedLine,
        reservedTotal,
        actual,
        lineMarketsReturned,
        regions,
      }) - reservedLine
      : 0
    const forDay = reservation.dayKey || currentDayKey()
    const commit = () => {
      // Settled check, delta, and the fence link share this snapshot.
      // Merging a newer ledger afterward would apply the refund to a
      // charge that was not in the snapshot.
      reloadFromDisk()
      if (id && state.settled?.[id]) return parsed
      waitForBudgetGate(filesystem, 'ODDS_BUDGET_RECONCILE_GATE')
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
    todayGameLineCaptures,
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
  gameLineCredits = null,
  countPropCapture = false,
  reservation = null,
} = {}) {
  const nextCredits = estimatedCredits ?? estimateCreditsFromOddsEndpoint(url)
  const lineCharge = gameLineCredits != null
    ? Math.max(0, Number(gameLineCredits) || 0)
    : (gameLine ? nextCredits : 0)
  let held = reservation
  if (budget && !isProbe && !held && typeof budget.reserve === 'function') {
    held = budget.reserve(nextCredits, {
      gameLineCredits: lineCharge,
      countPropCapture,
      captures: countPropCapture ? 1 : (lineCharge > 0 ? 0 : undefined),
    })
    if (!held?.ok) {
      const status = held?.status || budget.status()
      log.log?.(sanitizeOddsApiLogText(`  ⏸️  ${formatOddsBudgetStatus(status)}`, apiKey))
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
    gameLineCredits: lineCharge,
    countPropCapture,
    captures: countPropCapture ? 1 : (lineCharge > 0 ? 0 : undefined),
  })) {
    const status = budget.status()
    log.log?.(sanitizeOddsApiLogText(`  ⏸️  ${formatOddsBudgetStatus(status)}`, apiKey))
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
    throw sanitizeOddsApiError(error, apiKey)
  }
  const quota = parseOddsApiQuota(response.headers)
  const settle = (extra = {}) => {
    if (budget && held?.ok && typeof budget.reconcile === 'function') {
      budget.reconcile(held, quota, { credits: quota.last ?? nextCredits, ...extra })
    } else if (budget) {
      budget.record(quota, {
        credits: quota.last ?? nextCredits,
        isProbe,
        captures: countPropCapture ? 1 : (lineCharge > 0 ? 0 : undefined),
        gameLineCredits: lineCharge > 0 ? lineCharge : 0,
        countPropCapture,
      })
    }
  }
  let data = null
  if (response.ok) {
    try {
      data = await response.json()
    } catch (error) {
      settle()
      const safe = sanitizeOddsApiError(error, apiKey)
      safe.quota = quota
      throw safe
    }
  }
  const lineMarketsReturned = lineCharge > 0 ? returnedGameLineMarketCount(data) : null
  settle(lineMarketsReturned == null ? {} : {
    lineMarketsReturned,
    regions: regionCountFromOddsUrl(url),
  })
  if (!response.ok) {
    let text = ''
    try {
      text = await response.text()
    } catch (error) {
      const safe = sanitizeOddsApiError(error, apiKey)
      safe.quota = quota
      throw safe
    }
    const error = sanitizeOddsApiError(
      new Error(`Odds API ${response.status}: ${text}`),
      apiKey,
    )
    error.quota = quota
    throw error
  }
  return {
    skipped: false,
    status: budget ? budget.status() : ODDS_BUDGET_OK,
    data,
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
    const safe = sanitizeOddsApiError(error, apiKey)
    const redacted = `⚠️ Quota probe failed (${safe.message})`
    if (budget?.markProbeFailed?.()) {
      log.log?.(redacted)
      emitOddsBudgetStatus(budget.status(), log)
    } else {
      log.log?.(`${redacted}; continuing with today's quota headers.`)
    }
    return {
      skipped: true,
      probeFailed: true,
      error: safe,
      status: budget ? budget.status() : ODDS_BUDGET_PROBE_FAILED,
      quota: budget ? budget.quota() : { remaining: null, used: null, last: null },
      budgetRecorded: false,
    }
  }
}
