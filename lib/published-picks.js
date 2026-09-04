/**
 * Locked "Published picks" cohort for the public ROI card.
 * Thresholds are product rules — do not loosen or invent extras here.
 *
 * A published pick is ALL of:
 * 1. Graded (won / lost / push). Pending is excluded from ROI math.
 * 2. Not a juice trap (counting-stat UNDER with threshold ≤ 0.5)
 * 3. Odds in American −200 to +250 after honest parse
 * 4. Line-shop edge > 0 (same PropValidation.edge field used at save)
 * 5. qualityScore ≥ 40
 * 6. Public card sports: MLB + NFL only (NHL stays in the full archive)
 */
import { isJuiceTrap } from './juice-traps.js'
import {
  isAmericanOddsInPublishedBand,
  toDecimalOdds,
  toAmericanOdds,
  unitsFromResult,
} from './odds-units.js'

export const PUBLISHED_SPORTS = Object.freeze(['mlb', 'nfl'])
export const PUBLISHED_MIN_QUALITY = 40

const GRADED_RESULTS = new Set([
  'correct', 'win', 'won', 'hit',
  'incorrect', 'loss', 'lost', 'lose',
  'push', 'pushed', 'void',
])

const WIN_RESULTS = new Set(['correct', 'win', 'won', 'hit'])
const LOSS_RESULTS = new Set(['incorrect', 'loss', 'lost', 'lose'])
const PUSH_RESULTS = new Set(['push', 'pushed', 'void'])

function normalizeSport(sport) {
  return String(sport || '').toLowerCase().trim()
}

function normalizeResult(result) {
  return String(result || '').toLowerCase().trim()
}

function isGradedRecord(record) {
  if (!record || typeof record !== 'object') return false
  const status = String(record.status || '').toLowerCase().trim()
  if (status && status !== 'completed') return false
  return GRADED_RESULTS.has(normalizeResult(record.result))
}

function hasPositiveEdge(record) {
  const edge = Number(record?.edge)
  return Number.isFinite(edge) && edge > 0
}

function meetsQualityFloor(record) {
  const score = Number(record?.qualityScore)
  return Number.isFinite(score) && score >= PUBLISHED_MIN_QUALITY
}

/**
 * @param {object} record - PropValidation-like row
 * @param {{ sports?: string[] }} [opts]
 * @returns {boolean}
 */
export function isPublishedPick(record, opts = {}) {
  if (!record || typeof record !== 'object') return false
  if (!isGradedRecord(record)) return false
  if (isJuiceTrap(record)) return false
  if (!isAmericanOddsInPublishedBand(record.odds)) return false
  if (!hasPositiveEdge(record)) return false
  if (!meetsQualityFloor(record)) return false

  const sports = opts.sports || PUBLISHED_SPORTS
  const sport = normalizeSport(record.sport)
  if (!sports.includes(sport)) return false

  return true
}

export function filterPublishedPicks(records, opts = {}) {
  if (!Array.isArray(records)) return []
  return records.filter((record) => isPublishedPick(record, opts))
}

function emptyPublishedSummary() {
  return {
    sample: 0,
    graded: 0,
    decided: 0,
    correct: 0,
    incorrect: 0,
    pushes: 0,
    units: 0,
    roi: 0,
    avgDecimal: null,
    avgAmerican: null,
    record: '0–0',
  }
}

/**
 * ROI / units for a published cohort. Pushes are graded (sample) but
 * excluded from the ROI denominator. Uses lib/odds-units.js only.
 * @param {object[]} records
 * @param {{ sports?: string[] }} [opts]
 */
export function summarizePublishedPicks(records, opts = {}) {
  const picks = filterPublishedPicks(records, opts)
  if (picks.length === 0) return emptyPublishedSummary()

  let units = 0
  let correct = 0
  let incorrect = 0
  let pushes = 0
  const decimals = []

  for (const pick of picks) {
    const dec = toDecimalOdds(pick.odds)
    if (dec != null) decimals.push(dec)

    const result = normalizeResult(pick.result)
    if (PUSH_RESULTS.has(result)) {
      pushes++
      continue
    }
    if (WIN_RESULTS.has(result)) {
      correct++
      units += unitsFromResult(pick.odds, 'correct')
      continue
    }
    if (LOSS_RESULTS.has(result)) {
      incorrect++
      units += unitsFromResult(pick.odds, 'incorrect')
    }
  }

  const decided = correct + incorrect
  const graded = decided + pushes
  const roi = decided > 0 ? units / decided : 0
  const avgDecimal = decimals.length > 0
    ? decimals.reduce((sum, n) => sum + n, 0) / decimals.length
    : null
  const avgAmerican = avgDecimal != null ? toAmericanOdds(avgDecimal) : null

  return {
    sample: graded,
    graded,
    decided,
    correct,
    incorrect,
    pushes,
    units,
    roi,
    avgDecimal,
    avgAmerican,
    record: pushes > 0 ? `${correct}–${incorrect}–${pushes}` : `${correct}–${incorrect}`,
  }
}
