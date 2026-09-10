/**
 * Phase B — Featured-cleared persist + grade.
 *
 * Quality stays in parlay-integrity (isFeaturedWorthyParlay /
 * isPublishedEligibleProp). This module is the tracked cohort:
 * snapshot identity, write plan, history filter, and settle math.
 *
 * Only Featured-cleared 3-leg Published-eligible cards enter this
 * track. Explorer Builder juice is rejected, not labeled-in.
 */
import { parseRecordInstant } from './published-picks.js'
import { unitsFromResult } from './odds-units.js'
import {
  FEATURED_LEG_COUNT,
  isFeaturedWorthyParlay,
} from './parlay-integrity.js'

export const FEATURED_COHORT_TAG = 'cohort:featured'
export const FEATURED_SOURCE = 'featured_cleared'
export const FEATURED_SNAPSHOT_PREFIX = 'snapshot:'

const WIN_RESULTS = new Set(['correct', 'win', 'won', 'hit'])
const LOSS_RESULTS = new Set(['incorrect', 'loss', 'lost', 'lose'])
const PUSH_RESULTS = new Set(['push', 'pushed', 'void'])
const SETTLED = new Set(['won', 'lost', 'push'])

function asDate(now) {
  if (now instanceof Date) return now
  const parsed = new Date(now)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function etDateString(instant) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
  }).format(instant)
}

function namesEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

export function isFeaturedClearedParlay(parlay, now = new Date()) {
  return isFeaturedWorthyParlay(parlay, now)
}

export function isFeaturedCohortRow(row) {
  if (!row || typeof row !== 'object') return false
  return String(row.notes || '').includes(FEATURED_COHORT_TAG)
}

export function filterFeaturedCohortRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.filter(isFeaturedCohortRow)
}

export function featuredSnapshotKind(parlay) {
  const type = String(parlay?.type || 'multi_game').toLowerCase()
  return type === 'single_game' ? 'sgp' : 'multi'
}

/**
 * ET calendar day for the snapshot slot. Prefer the earliest upcoming
 * first pitch so a late persist still belongs to the slate, not tomorrow.
 */
export function featuredSlateDay(parlay, now = new Date()) {
  const times = (parlay?.legs || [])
    .map((leg) => parseRecordInstant(leg.gameTime))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime())
  const instant = times[0] || asDate(now)
  return etDateString(instant)
}

export function featuredSnapshotKey(parlay, now = new Date()) {
  const sport = String(parlay?.sport || 'mlb').toLowerCase().trim() || 'mlb'
  return `featured:${sport}:${featuredSnapshotKind(parlay)}:${featuredSlateDay(parlay, now)}`
}

export function featuredCohortNotes(snapshotKey) {
  return `${FEATURED_COHORT_TAG} ${FEATURED_SNAPSHOT_PREFIX}${snapshotKey}`
}

export function parseFeaturedSnapshotKey(notes) {
  const text = String(notes || '')
  const match = text.match(/snapshot:(featured:[a-z0-9]+:[a-z0-9]+:\d{4}-\d{2}-\d{2})/i)
  return match ? match[1] : null
}

/**
 * First Featured-cleared write for a sport+kind+ET-day slot wins.
 * Do not churn the tracked card when live Featured regenerates.
 */
export function featuredPersistWritePlan(existing) {
  if (!existing) return 'insert'
  return 'skip'
}

function earliestExpiresAt(parlay) {
  const times = (parlay?.legs || [])
    .map((leg) => parseRecordInstant(leg.gameTime) || parseRecordInstant(leg.expiresAt))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime())
  return times[0] ? times[0].toISOString() : null
}

/**
 * Parlay insert payload. Null when the card is not Featured-cleared.
 * Does not assign an id — the persist layer does that.
 */
export function toFeaturedParlayRow(parlay, now = new Date()) {
  if (!isFeaturedClearedParlay(parlay, now)) return null
  return {
    sport: String(parlay.sport || 'mlb').toLowerCase(),
    type: parlay.type || 'multi_game',
    legCount: FEATURED_LEG_COUNT,
    totalOdds: Number(parlay.totalOdds) || 1,
    probability: Number(parlay.probability) || 0,
    edge: Number(parlay.edge) || 0,
    expectedValue: Number(parlay.expectedValue) || 0,
    confidence: parlay.confidence || 'medium',
    status: 'pending',
    outcome: 'pending',
    notes: featuredCohortNotes(featuredSnapshotKey(parlay, now)),
    expiresAt: earliestExpiresAt(parlay),
  }
}

export function toFeaturedParlayLegs(parlay, parlayId, now = new Date()) {
  if (!isFeaturedClearedParlay(parlay, now)) return []
  const instant = asDate(now).toISOString()
  return parlay.legs.map((leg, index) => ({
    parlayId,
    gameIdRef: String(leg.gameId || ''),
    betType: 'prop',
    selection: leg.selection || leg.pick || 'over',
    odds: leg.odds ?? -110,
    probability: Number(leg.probability) || 0.5,
    edge: Number(leg.edge) || 0,
    confidence: leg.confidence || 'medium',
    playerName: leg.playerName || null,
    propType: leg.propType || leg.type || 'prop',
    threshold: Number.isFinite(Number(leg.threshold)) ? Number(leg.threshold) : null,
    legOrder: index + 1,
    notes: leg.reasoning || null,
    outcome: 'pending',
    createdAt: instant,
    updatedAt: instant,
  }))
}

export function validationResultToOutcome(result) {
  const r = String(result || '').toLowerCase().trim()
  if (WIN_RESULTS.has(r)) return 'won'
  if (LOSS_RESULTS.has(r)) return 'lost'
  if (PUSH_RESULTS.has(r)) return 'push'
  return null
}

/**
 * Grade one Featured prop leg from the settled box-score value.
 * Same over/under vs threshold as Published prop validation.
 */
export function gradePropLegFromActual(leg, actualValue) {
  const actual = Number(actualValue)
  const line = Number(leg?.threshold)
  if (!Number.isFinite(actual) || !Number.isFinite(line)) return null
  if (actual === line) return 'push'
  const side = String(leg?.selection || leg?.pick || '').toLowerCase()
  if (side === 'under') return actual < line ? 'won' : 'lost'
  return actual > line ? 'won' : 'lost'
}

export function matchValidationToLeg(leg, validations) {
  const rows = Array.isArray(validations) ? validations : []
  const candidates = rows.filter((row) => (
    namesEqual(row.playerName, leg.playerName)
    && String(row.propType || '').toLowerCase() === String(leg.propType || '').toLowerCase()
  ))
  if (candidates.length === 0) return null

  const usable = (row) => {
    const status = String(row.status || '').toLowerCase()
    const completed = status === 'completed' || status === 'manual_closed'
    return completed && (
      validationResultToOutcome(row.result) != null
      || Number.isFinite(Number(row.actualValue))
    )
  }

  return [...candidates].sort((a, b) => {
    const usableDiff = Number(usable(b)) - Number(usable(a))
    if (usableDiff) return usableDiff
    const parlayDiff = Number(b.parlayId === leg.parlayId) - Number(a.parlayId === leg.parlayId)
    if (parlayDiff) return parlayDiff
    const gameDiff = Number(String(b.gameIdRef || '') === String(leg.gameIdRef || ''))
      - Number(String(a.gameIdRef || '') === String(leg.gameIdRef || ''))
    if (gameDiff) return gameDiff
    const aThresh = Number.isFinite(Number(leg.threshold)) && Number(a.threshold) === Number(leg.threshold)
    const bThresh = Number.isFinite(Number(leg.threshold)) && Number(b.threshold) === Number(leg.threshold)
    return Number(bThresh) - Number(aThresh)
  })[0]
}

/**
 * Lost settles the card immediately. Push only when every leg is
 * decided and at least one pushed. Pending otherwise.
 */
export function aggregateFeaturedParlayOutcome(outcomes) {
  const list = Array.isArray(outcomes) ? outcomes : []
  if (list.some((outcome) => outcome === 'lost')) return 'lost'
  const unresolved = list.filter((outcome) => !SETTLED.has(outcome)).length
  if (unresolved) return 'pending'
  if (list.some((outcome) => outcome === 'push')) return 'push'
  if (list.length > 0 && list.every((outcome) => outcome === 'won')) return 'won'
  return 'pending'
}

export function gradeFeaturedParlayFromValidations(legs, validations) {
  const list = Array.isArray(legs) ? legs : []
  const legOutcomes = list.map((leg) => {
    const validation = matchValidationToLeg(leg, validations)
    const status = String(validation?.status || '').toLowerCase()
    const completed = status === 'completed' || status === 'manual_closed'
    let outcome = null
    if (completed) {
      outcome = validationResultToOutcome(validation.result)
      if (!outcome && Number.isFinite(Number(validation.actualValue))) {
        outcome = gradePropLegFromActual(leg, validation.actualValue)
      }
    }
    return {
      leg,
      outcome,
      actualValue: Number.isFinite(Number(validation?.actualValue))
        ? Number(validation.actualValue)
        : null,
      validation,
    }
  })

  return {
    parlayOutcome: aggregateFeaturedParlayOutcome(legOutcomes.map((row) => row.outcome)),
    legOutcomes,
  }
}

export function featuredParlayGradePatch(grade, now = new Date()) {
  if (!grade || grade.parlayOutcome === 'pending') return null
  const lostLabels = (grade.legOutcomes || [])
    .filter((row) => row.outcome === 'lost')
    .map((row) => row.leg?.playerName || row.leg?.selection || row.leg?.propType || 'leg')

  let actualResult = `Lost on: ${lostLabels.join(', ')}`
  if (grade.parlayOutcome === 'won') {
    actualResult = `All ${(grade.legOutcomes || []).length} legs won`
  } else if (grade.parlayOutcome === 'push') {
    actualResult = 'Push — no losses, at least one push'
  }

  return {
    status: grade.parlayOutcome,
    outcome: grade.parlayOutcome,
    actualResult,
    updatedAt: asDate(now).toISOString(),
  }
}

export function featuredLegGradePatch(legOutcome, now = new Date()) {
  if (!legOutcome?.outcome) return null
  const actual = Number.isFinite(Number(legOutcome.actualValue))
    ? `Actual: ${legOutcome.actualValue}`
    : `Validated: ${legOutcome.outcome}`
  return {
    outcome: legOutcome.outcome,
    actualResult: actual,
    updatedAt: asDate(now).toISOString(),
  }
}

function emptyFeaturedSummary() {
  return {
    totalParlays: 0,
    wonParlays: 0,
    lostParlays: 0,
    pushParlays: 0,
    pendingParlays: 0,
    winRate: 0,
    avgEdge: 0,
    avgExpectedValue: 0,
    units: 0,
    roi: 0,
  }
}

/**
 * ROI / record for the Featured-cleared track only.
 * Untagged Builder rows are ignored even if mixed into the array.
 */
export function summarizeFeaturedParlays(parlays) {
  const rows = filterFeaturedCohortRows(parlays)
  if (rows.length === 0) return emptyFeaturedSummary()

  const won = rows.filter((row) => (row.outcome || row.status) === 'won')
  const lost = rows.filter((row) => (row.outcome || row.status) === 'lost')
  const push = rows.filter((row) => (row.outcome || row.status) === 'push')
  const pending = rows.filter((row) => {
    const state = row.outcome || row.status
    return !SETTLED.has(state)
  })
  const decided = won.length + lost.length
  const winRate = decided > 0 ? (won.length / decided) * 100 : 0
  const avgEdge = rows.reduce((sum, row) => sum + (Number(row.edge) || 0), 0) / rows.length
  const avgExpectedValue = rows.reduce((sum, row) => sum + (Number(row.expectedValue) || 0), 0) / rows.length

  let units = 0
  for (const row of won) units += unitsFromResult(row.totalOdds, 'won')
  for (const row of lost) units += unitsFromResult(row.totalOdds, 'lost')

  const roi = decided > 0 ? (units / decided) * 100 : 0

  return {
    totalParlays: rows.length,
    wonParlays: won.length,
    lostParlays: lost.length,
    pushParlays: push.length,
    pendingParlays: pending.length,
    winRate: Math.round(winRate * 100) / 100,
    avgEdge: Math.round(avgEdge * 1000) / 1000,
    avgExpectedValue: Math.round(avgExpectedValue * 1000) / 1000,
    units: Math.round(units * 100) / 100,
    roi: Math.round(roi * 100) / 100,
  }
}
