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
 */

import fs from 'node:fs'
import path from 'node:path'

export const ODDS_BUDGET_OK = 'ok'
export const ODDS_BUDGET_FLOOR = 'floor'
export const ODDS_BUDGET_DAILY_CAP = 'daily_cap'
export const ODDS_BUDGET_MONTHLY_CAP = 'monthly_cap'

export const DEFAULT_DAILY_CREDIT_CAP = 1500
export const DEFAULT_MONTHLY_CREDIT_CAP = 17000
export const DEFAULT_REMAINING_FLOOR = 3000
export const DEFAULT_BUDGET_REL_PATH = path.join('.local', 'odds-api-budget.json')
export const ODDS_API_USER_AGENT = 'OddsOnDeck/1.0'

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
    persistPath: env.ODDS_BUDGET_PATH
      ? String(env.ODDS_BUDGET_PATH)
      : DEFAULT_BUDGET_REL_PATH,
  }
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
  const markets = new URLSearchParams(search).get('markets')
  if (!markets) return 0
  return markets.split(',').map((part) => part.trim()).filter(Boolean).length
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

export function formatOddsCreditsUsed(credits) {
  return `ODDS_CREDITS_USED=${Number(credits) || 0}`
}

export function formatOddsCreditsRemaining(remaining) {
  return remaining == null || remaining === ''
    ? 'ODDS_CREDITS_REMAINING=unknown'
    : `ODDS_CREDITS_REMAINING=${remaining}`
}

function emptyState() {
  return {
    version: 1,
    lastRemaining: null,
    lastUsed: null,
    lastCost: null,
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
  if (env.JEST_WORKER_ID) return false
  if (env.NODE_ENV === 'test') return false
  return true
}

export function loadOddsBudgetState({ persistPath, filesystem = fs, persist = true } = {}) {
  if (!persist) return emptyState()
  const filePath = path.resolve(process.cwd(), persistPath || DEFAULT_BUDGET_REL_PATH)
  try {
    if (!filesystem.existsSync?.(filePath) && typeof filesystem.readFileSync !== 'function') {
      return emptyState()
    }
    if (filesystem.existsSync && !filesystem.existsSync(filePath)) return emptyState()
    const parsed = JSON.parse(filesystem.readFileSync(filePath, 'utf8'))
    return normalizeState(parsed)
  } catch {
    return emptyState()
  }
}

export function saveOddsBudgetState(state, { persistPath, filesystem = fs, persist = true } = {}) {
  if (!persist) return
  const filePath = path.resolve(process.cwd(), persistPath || DEFAULT_BUDGET_REL_PATH)
  const dir = path.dirname(filePath)
  filesystem.mkdirSync?.(dir, { recursive: true })
  const tmp = `${filePath}.tmp`
  const payload = `${JSON.stringify(state, null, 2)}\n`
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
} = {}) {
  const config = readOddsBudgetConfig(env)
  const persistEnabled = persist == null ? shouldPersistToDisk(env) : Boolean(persist)
  const persistOpts = {
    persistPath: config.persistPath,
    filesystem,
    persist: persistEnabled,
  }
  const state = normalizeState(seeded || loadOddsBudgetState(persistOpts))
  const dayKey = etDayKey(now)
  if (!state.days[dayKey]) state.days[dayKey] = { credits: 0, calls: 0 }

  let status = ODDS_BUDGET_OK
  let runCredits = 0
  let runCalls = 0

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

  function wouldCross(nextCredits = 1) {
    const next = Math.max(0, Number(nextCredits) || 0)
    if (state.lastRemaining != null && (state.lastRemaining - next) < config.remainingFloor) {
      return ODDS_BUDGET_FLOOR
    }
    if (state.lastUsed != null && (state.lastUsed + next) > config.monthlyCap) {
      return ODDS_BUDGET_MONTHLY_CAP
    }
    if ((todayCredits() + next) > config.dailyCap) {
      return ODDS_BUDGET_DAILY_CAP
    }
    return null
  }

  function allow(nextCredits = 1) {
    if (status !== ODDS_BUDGET_OK) return false
    const reason = wouldCross(nextCredits)
    if (reason) {
      status = reason
      return false
    }
    return true
  }

  function persistState() {
    const keepMonth = dayKey.slice(0, 7)
    const days = {}
    for (const [day, row] of Object.entries(state.days)) {
      if (String(day).startsWith(keepMonth)) days[day] = row
    }
    state.days = days
    state.updatedAt = new Date().toISOString()
    saveOddsBudgetState(state, persistOpts)
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
    state.lastCost = cost
    const row = state.days[dayKey] || { credits: 0, calls: 0 }
    row.credits += cost
    row.calls += 1
    state.days[dayKey] = row
    persistState()
    const line = `  💳 Odds API credits last=${parsed.last ?? cost} used=${parsed.used ?? state.lastUsed ?? '?'} remaining=${parsed.remaining ?? state.lastRemaining ?? '?'}`
    log.log?.(redactOddsApiKey(line, apiKey))
    if (status === ODDS_BUDGET_OK) {
      const next = wouldCross(1)
      if (next && parsed.remaining != null && parsed.remaining < config.remainingFloor) {
        status = ODDS_BUDGET_FLOOR
      } else if (next && parsed.used != null && parsed.used > config.monthlyCap) {
        status = ODDS_BUDGET_MONTHLY_CAP
      } else if (next && todayCredits() > config.dailyCap) {
        status = ODDS_BUDGET_DAILY_CAP
      }
    }
    return parsed
  }

  function logSummary() {
    log.log?.(formatOddsBudgetStatus(status))
    log.log?.(formatOddsCreditsUsed(runCredits))
    log.log?.(formatOddsCreditsRemaining(state.lastRemaining))
  }

  return {
    config,
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
    persistPath: config.persistPath,
  }
}

export async function fetchOddsApiJson(url, {
  budget,
  fetchImpl = fetch,
  estimatedCredits,
  log = console,
  apiKey,
} = {}) {
  const nextCredits = estimatedCredits ?? estimateCreditsFromOddsEndpoint(url)
  if (budget && !budget.allow(nextCredits)) {
    log.log?.(redactOddsApiKey(`  ⏸️  ${formatOddsBudgetStatus(budget.status())}`, apiKey))
    return {
      skipped: true,
      status: budget.status(),
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
