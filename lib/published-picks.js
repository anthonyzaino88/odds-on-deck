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
import { isJuiceTrap, getBookCount, attachNumBooks } from './juice-traps.js'
import { isGameLineRecord } from './game-lines.js'
import {
  isAmericanOddsInPublishedBand,
  toDecimalOdds,
  toAmericanOdds,
  unitsFromResult,
} from './odds-units.js'

export const PUBLISHED_SPORTS = Object.freeze(['mlb', 'nfl'])
export const PUBLISHED_MIN_QUALITY = 40
export const TODAYS_BOARD_CAP = 5
export const TODAYS_BOARD_MIN_PUBLISHED = 3
export const PUBLISHED_COHORT_TAG = 'cohort:published'
export const PUBLISHED_SOURCE = 'system_generated'

/**
 * SQL-side prefilter for Published stats fetches.
 * Equivalent to the locked edge / quality / sport checks — juice traps and
 * the odds band still run in JS via summarizePublishedPicks().
 */
export const PUBLISHED_STATS_PREFILTER = Object.freeze({
  sports: PUBLISHED_SPORTS,
  minQuality: PUBLISHED_MIN_QUALITY,
  // exclusive: edge must be > 0 (same as hasPositiveEdge)
  edgeGreaterThan: 0,
})

/**
 * PropValidation columns needed for the locked cohort filters + ROI math.
 * Do not include PlayerPropCache aliases (`pick`, `type`) — they are not
 * on this table and will 42703 the whole Published card.
 */
export const PUBLISHED_STATS_SELECT_FIELDS = Object.freeze([
  'id',
  'status',
  'result',
  'prediction',
  'propType',
  'threshold',
  'odds',
  'edge',
  'qualityScore',
  'sport',
  'source',
  'notes',
  'completedAt',
])

export const PUBLISHED_STATS_SELECT = PUBLISHED_STATS_SELECT_FIELDS.join(', ')

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
 * Same three checks the Published-stats SQL prefilter applies.
 * Used so the query and JS cohort cannot drift.
 */
export function matchesPublishedStatsPrefilter(record) {
  if (!record || typeof record !== 'object') return false
  return inPublishedSports(record) && hasPositiveEdge(record) && meetsQualityFloor(record)
}

function inPublishedSports(record, opts = {}) {
  const sports = opts.sports || PUBLISHED_SPORTS
  return sports.includes(normalizeSport(record?.sport))
}

/**
 * Same locked filters as isPublishedPick, minus grading.
 * Use for today's / upcoming slate rows that are not yet graded.
 * @param {object} record - PlayerPropCache-like or PropValidation-like row
 * @param {{ sports?: string[] }} [opts]
 * @returns {boolean}
 */
export function isPublishedEligibleProp(record, opts = {}) {
  if (!record || typeof record !== 'object') return false
  if (isGameLineRecord(record)) return false
  if (isJuiceTrap(record)) return false
  if (!isAmericanOddsInPublishedBand(record.odds)) return false
  if (!hasPositiveEdge(record)) return false
  if (!meetsQualityFloor(record)) return false
  if (!inPublishedSports(record, opts)) return false
  return true
}

/**
 * Editor's desk / public /picks bar. Same locked Published / Pile B
 * filters as the homepage board and /validation ROI card — bets we'd
 * actually take. Never a looser juice-favorite fill list.
 * @param {object} record
 * @param {{ sports?: string[] }} [opts]
 * @returns {boolean}
 */
export function isEditorsBoardFill(record, opts = {}) {
  return isPublishedEligibleProp(record, opts)
}

/**
 * @param {object} record - PropValidation-like row
 * @param {{ sports?: string[] }} [opts]
 * @returns {boolean}
 */
export function isPublishedPick(record, opts = {}) {
  if (!isGradedRecord(record)) return false
  return isPublishedEligibleProp(record, opts)
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
 * Graded sides & totals track. MLB + NFL moneyline / game totals with a
 * positive edge. Not the props Published bar (no QS / odds-band / juice
 * rules). Empty sample is honest.
 */
export function isSidesTotalsPick(record, opts = {}) {
  if (!record || typeof record !== 'object') return false
  if (!isGameLineRecord(record)) return false
  if (!isGradedRecord(record)) return false
  if (!hasPositiveEdge(record)) return false
  if (!inPublishedSports(record, opts)) return false
  return true
}

export function filterSidesTotalsPicks(records, opts = {}) {
  if (!Array.isArray(records)) return []
  return records.filter((record) => isSidesTotalsPick(record, opts))
}

/**
 * ROI / units for a published cohort. Pushes are graded (sample) but
 * excluded from the ROI denominator. Uses lib/odds-units.js only.
 * @param {object[]} records
 * @param {{ sports?: string[] }} [opts]
 */
function summarizeCohort(picks) {
  if (!picks || picks.length === 0) return emptyPublishedSummary()

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

export function summarizePublishedPicks(records, opts = {}) {
  return summarizeCohort(filterPublishedPicks(records, opts))
}

/**
 * Separate sides & totals ROI. Never fold these into Published props.
 */
export function summarizeSidesTotals(records, opts = {}) {
  return summarizeCohort(filterSidesTotalsPicks(records, opts))
}

/**
 * Stable identity for a board / validation row so fill does not duplicate
 * a Published-eligible prop as "Editor's".
 */
export function boardRowKey(record) {
  if (!record || typeof record !== 'object') return ''
  const gameId = record.gameId || record.gameIdRef || ''
  const player = String(record.playerName || '').toLowerCase().trim()
  const market = String(record.type || record.propType || '').toLowerCase().trim()
  const pick = String(record.pick || record.prediction || '').toLowerCase().trim()
  const line = record.threshold == null ? '' : String(record.threshold)
  return [normalizeSport(record.sport), gameId, player, market, pick, line].join('|')
}

function compareByEdgeThenQuality(a, b) {
  const edgeDiff = (Number(b?.edge) || 0) - (Number(a?.edge) || 0)
  if (edgeDiff !== 0) return edgeDiff
  return (Number(b?.qualityScore) || 0) - (Number(a?.qualityScore) || 0)
}

function uniqueByBoardKey(records) {
  const seen = new Set()
  const unique = []
  for (const record of records) {
    const key = boardRowKey(record)
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(record)
  }
  return unique
}

/**
 * Cap-5 public board. Published / Pile B only — never pad with juice
 * favorites, no-edge mid-prices, or Editor's fill. Empty or 1–2 rows is
 * the honest slate. Homepage and any digest that reuses this selector
 * must stay on this cohort.
 * @param {{ publishedEligible?: object[], cap?: number }} input
 * @returns {{ prop: object, source: 'published' }[]}
 */
export function selectTodaysBoardRows({
  publishedEligible = [],
  cap = TODAYS_BOARD_CAP,
} = {}) {
  const published = rankEditorsPicks(publishedEligible)

  return published.slice(0, cap).map((prop) => ({
    prop,
    source: 'published',
  }))
}

/**
 * Shared Editor's ranker. Full Published / Pile B cohort, ranked by
 * line-shop edge then qualityScore. No cap — empty or short is honest.
 * Does not invent juice / no-edge fill.
 * @param {object[]} records
 * @param {{ sports?: string[] }} [opts]
 * @returns {object[]}
 */
export function rankEditorsPicks(records, opts = {}) {
  return uniqueByBoardKey(
    (Array.isArray(records) ? records : [])
      .filter((record) => isPublishedEligibleProp(record, opts)),
  ).sort(compareByEdgeThenQuality)
}

/**
 * Honest slate size for the public board. Short (1–2) is a real state —
 * do not treat it as a cue to invent filler.
 * @param {number} count
 * @returns {'empty' | 'short' | 'full'}
 */
export function todaysBoardSlateState(count) {
  const n = Number(count)
  if (!Number.isFinite(n) || n <= 0) return 'empty'
  if (n < TODAYS_BOARD_MIN_PUBLISHED) return 'short'
  return 'full'
}

const ET = 'America/New_York'

function tzOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant)
  const get = (type) => parts.find((part) => part.type === type)?.value
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const asUtc = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    hour,
    Number(get('minute')),
    Number(get('second')),
  )
  return asUtc - instant.getTime()
}

function zonedLocalToDate(year, month, day, hour, minute, second, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  let offset = tzOffsetMs(new Date(utcGuess), timeZone)
  let utc = utcGuess - offset
  offset = tzOffsetMs(new Date(utc), timeZone)
  utc = utcGuess - offset
  return new Date(utc)
}

function etYmd(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type) => Number(parts.find((part) => part.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

/**
 * Half-open [start, end) for an ET calendar day.
 * offsetDays: 0 = today ET, -1 = yesterday ET.
 */
export function getEtCalendarDayRange(offsetDays = -1, now = new Date()) {
  const today = etYmd(now)
  const noonUtc = Date.UTC(today.year, today.month - 1, today.day, 16, 0, 0)
  const targetNoon = new Date(noonUtc)
  targetNoon.setUTCDate(targetNoon.getUTCDate() + offsetDays)
  const target = etYmd(targetNoon)

  const start = zonedLocalToDate(target.year, target.month, target.day, 0, 0, 0, ET)
  const nextNoon = new Date(Date.UTC(target.year, target.month - 1, target.day, 16, 0, 0))
  nextNoon.setUTCDate(nextNoon.getUTCDate() + 1)
  const next = etYmd(nextNoon)
  const end = zonedLocalToDate(next.year, next.month, next.day, 0, 0, 0, ET)
  return { start, end }
}

export function parseRecordInstant(raw) {
  if (!raw) return null
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  const text = String(raw)
  const iso = text.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(text) ? text : `${text}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Slate day for the homepage "yesterday" line.
 * Prefer the game's first pitch (ET calendar), then the time we recorded
 * the Published pick, then completedAt. Morning validate:all must not move
 * a Sep 8 slate into "today" just because it was graded Sep 9.
 */
export function publishedSlateInstant(record) {
  if (!record || typeof record !== 'object') return null
  return parseRecordInstant(record.gameDate)
    || parseRecordInstant(record.gameTime)
    || parseRecordInstant(record.timestamp)
    || parseRecordInstant(record.completedAt)
}

function publishedMarketType(record) {
  const type = String(record?.type || '').trim()
  if (type && type.toLowerCase() !== 'player_prop') return type
  return record?.propType || record?.type || 'unknown'
}

function publishedPrediction(record) {
  return String(record?.pick || record?.prediction || '').toLowerCase().trim() || 'over'
}

/**
 * Stable PropValidation.propId for a Published cache / board row.
 * Prefer the cache propId so odds-fetch and the homepage write the same row.
 */
export function publishedPropId(record) {
  if (!record || typeof record !== 'object') return null
  if (record.propId) return String(record.propId)
  const key = boardRowKey(record)
  if (!key) return null
  return `pub-${key.replace(/\|/g, '-')}`
}

/**
 * PropValidation insert/update payload from the cache row that cleared
 * the Published bar. Keeps that row's qualityScore / edge / odds — does
 * not recalculate QS, and never tags the row as a game line.
 */
export function toPublishedValidationFields(record) {
  if (!isPublishedEligibleProp(record)) return null
  const propId = publishedPropId(record)
  const gameIdRef = record.gameId || record.gameIdRef
  if (!propId || !gameIdRef || !record.playerName) return null

  return attachNumBooks({
    propId,
    gameIdRef,
    playerName: record.playerName,
    propType: publishedMarketType(record),
    threshold: record.threshold ?? 0,
    prediction: publishedPrediction(record),
    projectedValue: record.projection || record.projectedValue || 0,
    confidence: record.confidence || 'medium',
    edge: Number(record.edge),
    odds: record.odds ?? null,
    probability: record.probability ?? null,
    qualityScore: Number(record.qualityScore),
    source: PUBLISHED_SOURCE,
    parlayId: null,
    status: 'pending',
    sport: normalizeSport(record.sport),
    notes: PUBLISHED_COHORT_TAG,
  }, record)
}

/**
 * insert = new row, update = refresh pending fields from the live board,
 * skip = already graded (do not rewrite history).
 */
export function publishedValidationWritePlan(existing) {
  if (!existing) return 'insert'
  const status = String(existing.status || '').toLowerCase().trim()
  if (status === 'completed') return 'skip'
  return 'update'
}

/**
 * W–L among decided Published picks whose slate (game / recorded day)
 * falls in the prior ET calendar day, plus flat-1u units via odds-units.
 * Pushes are graded but not in the W–L.
 */
export function summarizeYesterdayPublished(records, now = new Date()) {
  const { start, end } = getEtCalendarDayRange(-1, now)
  const inYesterday = (Array.isArray(records) ? records : []).filter((record) => {
    const at = publishedSlateInstant(record)
    return at != null && at >= start && at < end
  })
  const summary = summarizePublishedPicks(inYesterday)
  if (summary.decided === 0) {
    return {
      decided: 0,
      correct: 0,
      incorrect: 0,
      units: 0,
      empty: true,
      line: 'No Published grades yesterday.',
    }
  }
  const sign = summary.units >= 0 ? '+' : ''
  return {
    decided: summary.decided,
    correct: summary.correct,
    incorrect: summary.incorrect,
    units: summary.units,
    empty: false,
    line: `Yesterday: ${summary.correct}–${summary.incorrect}, ${sign}${summary.units.toFixed(1)}u`,
  }
}

/**
 * One short why chip from real fields. Prefer stored book count, then edge,
 * then qualityScore. Never invent a book count.
 */
export function pickWhyChip(record) {
  if (!record || typeof record !== 'object') return null
  const books = getBookCount(record)
  if (books != null) return `${books}-book edge`
  const edge = Number(record.edge)
  if (Number.isFinite(edge) && edge > 0) return `+${(edge * 100).toFixed(1)}% edge`
  const qs = Number(record.qualityScore)
  if (Number.isFinite(qs)) return `QS ${Math.round(qs)}`
  return null
}
