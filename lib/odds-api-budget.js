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

export const DEFAULT_DAILY_CREDIT_CAP = 1500
export const DEFAULT_MONTHLY_CREDIT_CAP = 17000
export const DEFAULT_REMAINING_FLOOR = 3000
export const DEFAULT_CLOSE_CAPTURE_RESERVE = 200
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
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
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

function emptyState() {
  return {
    version: 1,
    lastRemaining: null,
    lastUsed: null,
    lastCost: null,
    quotaDay: null,
    updatedAt: null,
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
  const days = raw.days && typeof raw.days === 'object' ? raw.days : {}
  for (const [day, row] of Object.entries(days)) {
    state.days[day] = {
      credits: Number(row?.credits) || 0,
      calls: Number(row?.calls) || 0,
    }
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

function mergeBudgetStates(disk, memory, { dayKey, thisCost = 0 } = {}) {
  const out = emptyState()
  const diskState = normalizeState(disk)
  const memState = normalizeState(memory)
  const allDays = new Set([
    ...Object.keys(diskState.days),
    ...Object.keys(memState.days),
  ])
  const cost = Math.max(0, Number(thisCost) || 0)
  for (const day of allDays) {
    const d = diskState.days[day] || { credits: 0, calls: 0 }
    const m = memState.days[day] || { credits: 0, calls: 0 }
    if (day === dayKey) {
      const inMemoryBefore = Math.max(0, m.credits - cost)
      const inMemoryCallsBefore = Math.max(0, m.calls - 1)
      out.days[day] = {
        credits: Math.max(d.credits, inMemoryBefore) + cost,
        calls: Math.max(d.calls, inMemoryCallsBefore) + 1,
      }
    } else {
      out.days[day] = {
        credits: Math.max(d.credits, m.credits),
        calls: Math.max(d.calls, m.calls),
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

export function saveOddsBudgetState(state, {
  persistPath,
  filesystem = fs,
  persist = true,
  log,
  dayKey,
  thisCost = 0,
} = {}) {
  if (!persist) return state
  const filePath = resolveOddsBudgetPath(persistPath)
  const disk = loadOddsBudgetState({
    persistPath,
    filesystem,
    persist: true,
    log,
    warn: false,
  })
  const merged = mergeBudgetStates(disk, state, { dayKey, thisCost })
  const dir = path.dirname(filePath)
  filesystem.mkdirSync?.(dir, { recursive: true })
  const payload = `${JSON.stringify(merged, null, 2)}\n`
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  filesystem.writeFileSync(tmp, payload, 'utf8')
  if (typeof filesystem.renameSync === 'function') {
    try {
      filesystem.renameSync(tmp, filePath)
      return merged
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
  return merged
}

function creditCost(quota, estimatedCredits) {
  if (quota && Number.isFinite(Number(quota.last))) return Number(quota.last)
  if (Number.isFinite(Number(estimatedCredits))) return Math.max(0, Number(estimatedCredits))
  return 1
}

export function createOddsApiBudget({
  env = process.env,
  now = new Date(),
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
  const dayKey = etDayKey(now)
  if (!state.days[dayKey]) state.days[dayKey] = { credits: 0, calls: 0 }

  const isCloseCapture = purpose === 'close-capture'
  const effectiveDailyCap = isCloseCapture
    ? config.dailyCap
    : Math.max(0, config.dailyCap - config.closeCaptureReserve)

  let status = ODDS_BUDGET_OK
  let runCredits = 0
  let runCalls = 0
  let probeFailedWithoutTodayHeaders = false

  function todayCredits() {
    return Number(state.days[dayKey]?.credits) || 0
  }

  function quotaSnapshot() {
    return {
      remaining: state.lastRemaining,
      used: state.lastUsed,
      last: state.lastCost,
    }
  }

  function hasFreshQuota() {
    return state.quotaDay === dayKey
  }

  function dailyCapNow() {
    if (probeFailedWithoutTodayHeaders) {
      return Math.min(effectiveDailyCap, config.probeFailCreditCap)
    }
    return effectiveDailyCap
  }

  function wouldCross(nextCredits = 1) {
    const next = Math.max(0, Number(nextCredits) || 0)
    if (next === 0) return null
    if (hasFreshQuota() && state.lastRemaining != null
      && (state.lastRemaining - next) < config.remainingFloor) {
      return ODDS_BUDGET_FLOOR
    }
    if (hasFreshQuota() && state.lastUsed != null
      && (state.lastUsed + next) > config.monthlyCap) {
      return ODDS_BUDGET_MONTHLY_CAP
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

  function allow(nextCredits = 1) {
    const next = Math.max(0, Number(nextCredits) || 0)
    if (probeFailedWithoutTodayHeaders) {
      return !wouldCross(next)
    }
    if (status !== ODDS_BUDGET_OK) return false
    const reason = wouldCross(next)
    if (reason) {
      status = reason
      return false
    }
    return true
  }

  function persistState(thisCost = 0) {
    const keepMonth = dayKey.slice(0, 7)
    const days = {}
    for (const [day, row] of Object.entries(state.days)) {
      if (String(day).startsWith(keepMonth)) days[day] = row
    }
    state.days = days
    state.updatedAt = new Date().toISOString()
    const merged = saveOddsBudgetState(state, {
      ...persistOpts,
      dayKey,
      thisCost,
    })
    if (merged && persistEnabled) {
      state.lastRemaining = merged.lastRemaining
      state.lastUsed = merged.lastUsed
      state.lastCost = merged.lastCost
      state.quotaDay = merged.quotaDay
      state.updatedAt = merged.updatedAt
      state.days = merged.days
      if (!state.days[dayKey]) state.days[dayKey] = { credits: 0, calls: 0 }
    }
  }

  function record(quota = {}, { credits } = {}) {
    const parsed = quota && typeof quota === 'object' && ('remaining' in quota || 'used' in quota || 'last' in quota)
      ? {
        remaining: quota.remaining ?? null,
        used: quota.used ?? null,
        last: quota.last ?? null,
      }
      : parseOddsApiQuota(quota)
    const cost = creditCost(parsed, credits)
    runCredits += cost
    runCalls += 1
    if (parsed.remaining != null) state.lastRemaining = parsed.remaining
    if (parsed.used != null) state.lastUsed = parsed.used
    if (parsed.remaining != null || parsed.used != null) state.quotaDay = dayKey
    state.lastCost = cost
    const row = state.days[dayKey] || { credits: 0, calls: 0 }
    row.credits += cost
    row.calls += 1
    state.days[dayKey] = row
    persistState(cost)
    const line = `  💳 Odds API credits last=${parsed.last ?? cost} used=${parsed.used ?? state.lastUsed ?? '?'} remaining=${parsed.remaining ?? state.lastRemaining ?? '?'}`
    log.log?.(redactOddsApiKey(line, apiKey))
    recomputeStatus()
    return parsed
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
    record,
    logSummary,
    quota: quotaSnapshot,
    status: () => status,
    runCredits: () => runCredits,
    runCalls: () => runCalls,
    remaining: () => state.lastRemaining,
    used: () => state.lastUsed,
    todayCredits,
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
} = {}) {
  const nextCredits = estimatedCredits ?? estimateCreditsFromOddsEndpoint(url)
  if (budget && !isProbe && !budget.allow(nextCredits)) {
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
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': ODDS_API_USER_AGENT },
  })
  const quota = parseOddsApiQuota(response.headers)
  if (budget) budget.record(quota, { credits: quota.last ?? nextCredits })
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
