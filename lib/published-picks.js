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
import { isJuiceTrap, getBookCount } from './juice-traps.js'
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

/** Columns needed to apply the locked cohort filters + ROI math. */
export const PUBLISHED_STATS_SELECT = [
  'id',
  'status',
  'result',
  'prediction',
  'pick',
  'propType',
  'type',
  'threshold',
  'odds',
  'edge',
  'qualityScore',
  'sport',
  'completedAt',
].join(', ')

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
  if (isJuiceTrap(record)) return false
  if (!isAmericanOddsInPublishedBand(record.odds)) return false
  if (!hasPositiveEdge(record)) return false
  if (!meetsQualityFloor(record)) return false
  if (!inPublishedSports(record, opts)) return false
  return true
}

/**
 * Editor's-Picks fill bar for the homepage board: no juice trap + odds band
 * + MLB/NFL. Does not pretend to be Published (no QS / edge floors).
 * @param {object} record
 * @param {{ sports?: string[] }} [opts]
 * @returns {boolean}
 */
export function isEditorsBoardFill(record, opts = {}) {
  if (!record || typeof record !== 'object') return false
  if (isJuiceTrap(record)) return false
  if (!isAmericanOddsInPublishedBand(record.odds)) return false
  if (!inPublishedSports(record, opts)) return false
  return true
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
 * Cap-5 homepage board. Prefer Published-eligible props; if fewer than 3
 * qualify, fill with Editor's rows that still pass juice + odds-band.
 * @param {{ publishedEligible?: object[], editorsFill?: object[], cap?: number, minPublished?: number }} input
 * @returns {{ prop: object, source: 'published' | 'editors' }[]}
 */
export function selectTodaysBoardRows({
  publishedEligible = [],
  editorsFill = [],
  cap = TODAYS_BOARD_CAP,
  minPublished = TODAYS_BOARD_MIN_PUBLISHED,
} = {}) {
  const published = uniqueByBoardKey(
    (Array.isArray(publishedEligible) ? publishedEligible : [])
      .filter((record) => isPublishedEligibleProp(record)),
  ).sort(compareByEdgeThenQuality)

  const selected = published.slice(0, cap).map((prop) => ({
    prop,
    source: 'published',
  }))

  if (selected.length >= minPublished || selected.length >= cap) {
    return selected.slice(0, cap)
  }

  const used = new Set(selected.map((row) => boardRowKey(row.prop)))
  const fill = uniqueByBoardKey(
    (Array.isArray(editorsFill) ? editorsFill : [])
      .filter((record) => isEditorsBoardFill(record)),
  )
    .filter((record) => !used.has(boardRowKey(record)))
    .sort(compareByEdgeThenQuality)

  for (const prop of fill) {
    if (selected.length >= cap) break
    selected.push({ prop, source: 'editors' })
    used.add(boardRowKey(prop))
  }

  return selected
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

function parseCompletedAt(record) {
  const raw = record?.completedAt
  if (!raw) return null
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  const text = String(raw)
  const iso = text.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(text) ? text : `${text}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * W–L among decided Published picks graded in the prior ET calendar day,
 * plus flat-1u units via odds-units. Pushes are graded but not in the W–L.
 */
export function summarizeYesterdayPublished(records, now = new Date()) {
  const { start, end } = getEtCalendarDayRange(-1, now)
  const inYesterday = (Array.isArray(records) ? records : []).filter((record) => {
    const at = parseCompletedAt(record)
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
