/**
 * Hard credit-cap guard for The Odds API historical pulls.
 *
 * Research only. Aborts BEFORE a call that would push spend past the
 * hard cap. Tracks x-requests-last / x-requests-remaining after every
 * call. Does not import Supabase, Prisma, or flip public NFL eligibility.
 */

export const HARD_CREDIT_CAP = 3000
export const PLANNED_SNAPSHOT_MARGIN_MAX = 140
export const HISTORICAL_COST_PER_REGION_PER_MARKET = 10
export const DEFAULT_HISTORICAL_REGIONS = 'us'
export const DEFAULT_HISTORICAL_MARKETS = 'h2h,totals'
export const DEFAULT_EXPECTED_SNAPSHOT_COST = 20

export class CreditCapError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'CreditCapError'
    this.details = details
  }
}

export function countCsvTokens(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean).length
}

export function expectedHistoricalOddsCost({
  regions = DEFAULT_HISTORICAL_REGIONS,
  markets = DEFAULT_HISTORICAL_MARKETS,
} = {}) {
  const nRegions = countCsvTokens(regions)
  const nMarkets = countCsvTokens(markets)
  if (nRegions < 1 || nMarkets < 1) return 0
  return nRegions * nMarkets * HISTORICAL_COST_PER_REGION_PER_MARKET
}

export function parseHeaderInt(headers, name) {
  if (!headers) return null
  const raw = typeof headers.get === 'function'
    ? headers.get(name)
    : headers[name] ?? headers[name.toLowerCase()]
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function redactOddsApiUrl(url) {
  return String(url || '').replace(/([?&](?:apiKey|api_key)=)[^&]*/gi, '$1REDACTED')
}

export function createCreditGuard({
  hardCap = HARD_CREDIT_CAP,
  spent = 0,
  remaining = null,
  used = null,
} = {}) {
  const cap = Number(hardCap)
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error('Credit guard hardCap must be a positive number')
  }
  if (cap > HARD_CREDIT_CAP) {
    throw new Error(`Credit guard hardCap cannot exceed ${HARD_CREDIT_CAP}`)
  }

  return {
    hardCap: cap,
    spent: Number.isFinite(Number(spent)) ? Number(spent) : 0,
    remaining: remaining == null ? null : Number(remaining),
    used: used == null ? null : Number(used),
    calls: [],
    aborted: false,
    abortReason: null,
  }
}

export function remainingBudget(guard) {
  const toCap = guard.hardCap - guard.spent
  if (guard.remaining == null || !Number.isFinite(guard.remaining)) return toCap
  return Math.min(toCap, guard.remaining)
}

export function canAfford(guard, nextCost) {
  const cost = Number(nextCost)
  if (!guard || guard.aborted) return false
  if (!Number.isFinite(cost) || cost < 0) return false
  if (cost === 0) return true
  if (guard.spent + cost > guard.hardCap) return false
  if (guard.remaining != null && Number.isFinite(guard.remaining) && cost > guard.remaining) {
    return false
  }
  return true
}

export function abortGuard(guard, reason, details = {}) {
  guard.aborted = true
  guard.abortReason = reason
  const error = new CreditCapError(reason, {
    spent: guard.spent,
    remaining: guard.remaining,
    hardCap: guard.hardCap,
    ...details,
  })
  return error
}

export function assertCanAfford(guard, nextCost, { label = 'odds-api-call' } = {}) {
  const cost = Number(nextCost)
  if (canAfford(guard, cost)) return true
  const reason = guard.aborted
    ? `Credit guard already aborted (${guard.abortReason})`
    : `Aborting ${label}: next cost ${cost} would exceed hard cap ${guard.hardCap} (spent=${guard.spent}, remaining=${guard.remaining ?? 'unknown'})`
  throw abortGuard(guard, reason, { nextCost: cost, label })
}

export function recordCall(guard, {
  cost,
  remaining = null,
  used = null,
  url = null,
  snapshotId = null,
  status = null,
} = {}) {
  const actual = Number(cost)
  const safeCost = Number.isFinite(actual) && actual >= 0 ? actual : 0
  guard.spent += safeCost
  if (remaining != null && Number.isFinite(Number(remaining))) {
    guard.remaining = Number(remaining)
  }
  if (used != null && Number.isFinite(Number(used))) {
    guard.used = Number(used)
  }
  const entry = {
    snapshotId,
    cost: safeCost,
    remaining: guard.remaining,
    used: guard.used,
    spent: guard.spent,
    status,
    url: url ? redactOddsApiUrl(url) : null,
    at: new Date().toISOString(),
  }
  guard.calls.push(entry)

  if (guard.spent > guard.hardCap) {
    abortGuard(guard, `Spend ${guard.spent} exceeded hard cap ${guard.hardCap} after a call`, {
      snapshotId,
      cost: safeCost,
    })
  }
  return entry
}

/**
 * Fetch only if the expected cost fits under the hard cap.
 * Records x-requests-last / remaining after the response.
 * Never logs a raw API key.
 */
export async function guardedFetch(guard, url, {
  expectedCost,
  fetchImpl = globalThis.fetch,
  snapshotId = null,
  headers = {},
} = {}) {
  const cost = Number(expectedCost)
  if (!Number.isFinite(cost) || cost < 0) {
    throw new CreditCapError('expectedCost must be a non-negative number', { expectedCost })
  }
  assertCanAfford(guard, cost, { label: snapshotId || redactOddsApiUrl(url) })

  const response = await fetchImpl(url, { headers })
  const last = parseHeaderInt(response.headers, 'x-requests-last')
  const remaining = parseHeaderInt(response.headers, 'x-requests-remaining')
  const used = parseHeaderInt(response.headers, 'x-requests-used')
  const recordedCost = last == null ? cost : last

  recordCall(guard, {
    cost: recordedCost,
    remaining,
    used,
    url,
    snapshotId,
    status: response.status,
  })

  if (guard.aborted) {
    throw new CreditCapError(guard.abortReason, {
      spent: guard.spent,
      remaining: guard.remaining,
      hardCap: guard.hardCap,
      snapshotId,
    })
  }

  return response
}

export function summarizeGuard(guard) {
  return {
    hardCap: guard.hardCap,
    spent: guard.spent,
    remaining: guard.remaining,
    used: guard.used,
    calls: guard.calls.length,
    aborted: guard.aborted,
    abortReason: guard.abortReason,
    remainingBudget: remainingBudget(guard),
  }
}
