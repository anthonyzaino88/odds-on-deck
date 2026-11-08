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
 * 6. Public card sports: MLB + NFL + NHL
 *    Historical NHL rows tagged cohort:shadow-published stay off this
 *    card (isPublishedPick). New NHL persist uses cohort:published.
 * 7. Track source is system_generated (user_saved / parlay_leg / game_line stay off)
 * 8. Not a legacy NFL generator row (recorded before the current persist path)
 *
 * Shadow published: same filters 2–5 and 7, sport list
 * SHADOW_PUBLISHED_SPORTS (NHL), notes include cohort:shadow-published
 * (appended onto existing auto-saved tier notes). Recorded in the same
 * `record:published` run. Grade and CLV like Published.
 *
 * Public reads:
 * - ALL shadow-tagged rows stay off Published board / ROI / CLV.
 * - Shadow-only rows (tag, no auto-saved) stay off every public surface,
 *   including /validation archive, counts, accuracy-by-edge, /insights,
 *   and /api/validation.
 * - Auto-saved NHL rows that also carry the tag stay in the general
 *   archive / insights so tagging does not shift those NHL numbers.
 */
import { sanitizedErrorMessage } from './sanitize-error.js'
import { isJuiceTrap, getBookCount, attachNumBooks } from './juice-traps.js'
import { attachEntryBook } from './line-shopping.js'
import { GAME_LINE_SOURCE, GAME_LINE_SPORTS, isGameLineRecord } from './game-lines.js'
import { isLegacyNhlModelRecord } from './edge-nfl-nhl.js'
import {
  isAmericanOddsInPublishedBand,
  toDecimalOdds,
  toAmericanOdds,
  unitsFromResult,
} from './odds-units.js'
import { isPreStartStatus } from './game-status.js'

export const PUBLISHED_SPORTS = Object.freeze(['mlb', 'nfl', 'nhl'])
export const SHADOW_PUBLISHED_SPORTS = Object.freeze(['nhl'])
export const CLOSE_CAPTURE_SPORTS = Object.freeze([
  ...new Set([...PUBLISHED_SPORTS, ...SHADOW_PUBLISHED_SPORTS]),
])
export const PUBLISHED_MIN_QUALITY = 40
export const TODAYS_BOARD_CAP = 5
export const TODAYS_BOARD_MIN_PUBLISHED = 3
export const PUBLISHED_COHORT_TAG = 'cohort:published'
export const SHADOW_PUBLISHED_COHORT_TAG = 'cohort:shadow-published'
export const AUTO_SAVED_NOTES_TOKEN = 'auto-saved'
/** Existing notes column — source Odds API market, including *_alternate. */
export const ODDS_MARKET_NOTES_PREFIX = 'oddsMarket:'
export const PUBLISHED_SOURCE = 'system_generated'
const COHORT_TAG_PATTERN = /\bcohort:[a-z0-9-]+\b/g
/**
 * PostgREST `or()` that keeps NULL notes (legacy archive) while dropping
 * every shadow-tagged row. Used on Published-only surfaces. Quoted
 * because the tag contains a colon.
 */
export const SHADOW_PUBLISHED_NOTES_OR_FILTER =
  `notes.is.null,notes.not.ilike."%${SHADOW_PUBLISHED_COHORT_TAG}%"`
/**
 * Public archive / insights: drop shadow-only rows (tag and not
 * auto-saved) while keeping untagged rows and auto-saved+tagged NHL.
 */
export const PRIVATE_SHADOW_PUBLISHED_NOTES_OR_FILTER =
  `notes.is.null,notes.not.ilike."%${SHADOW_PUBLISHED_COHORT_TAG}%",notes.ilike."%${AUTO_SAVED_NOTES_TOKEN}%"`

/**
 * First instant the current Published persist path
 * (`toPublishedValidationFields` / `recordPublishedEligibleProp` /
 * `notes=cohort:published`) was producing the public track.
 *
 * Evidence from the Oct 2026 profitability review + monthly Published
 * breakdown: the only pre-2026 Published rows are 81 NFL picks from
 * 2025-10-27 through 2025-11-09. They carry the old-generator fingerprint
 * (probability 0.50–0.515, line-shop-impossible edges 15–49%, American
 * +125..+180). First modern MLB Published week is 2026-03-23; first
 * modern NFL Published week is 2026-09-07.
 *
 * Midnight America/New_York on 2026-03-01 = 05:00 UTC (EST).
 * Reversible: changing this constant (or `isLegacyNflPublishedRow`)
 * puts the rows back on the card. Rows are never deleted.
 */
export const PUBLISHED_PIPELINE_START = '2026-03-01T05:00:00.000Z'
export const PUBLISHED_PIPELINE_START_ET = '2026-03-01'

/**
 * SQL-side prefilter for Published stats fetches.
 * Equivalent to the locked edge / quality / sport checks — juice traps,
 * the odds band, and the legacy-NFL date rule still run in JS via
 * summarizePublishedPicks().
 */
export const PUBLISHED_STATS_PREFILTER = Object.freeze({
  sports: PUBLISHED_SPORTS,
  minQuality: PUBLISHED_MIN_QUALITY,
  // exclusive: edge must be > 0 (same as hasPositiveEdge)
  edgeGreaterThan: 0,
  source: PUBLISHED_SOURCE,
})

/** Same locked floors as Published, NHL-only, tagged privately. */
export const SHADOW_PUBLISHED_STATS_PREFILTER = Object.freeze({
  sports: SHADOW_PUBLISHED_SPORTS,
  minQuality: PUBLISHED_MIN_QUALITY,
  edgeGreaterThan: 0,
  source: PUBLISHED_SOURCE,
  notesTag: SHADOW_PUBLISHED_COHORT_TAG,
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
  'timestamp',
  'playerName',
  'probability',
  'gameIdRef',
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
 * Same locked sport / edge / quality / source checks the Published-stats
 * SQL prefilter applies. Used so the query and JS cohort cannot drift.
 */
export function matchesPublishedStatsPrefilter(record) {
  if (!record || typeof record !== 'object') return false
  return inPublishedSports(record)
    && hasPositiveEdge(record)
    && meetsQualityFloor(record)
    && isPublishedTrackSource(record)
}

/**
 * Graded Published / ROI rows must be system persist, not a visitor save.
 * Cache / board eligibility (isPublishedEligibleProp) does not use this —
 * PlayerPropCache rows have no source column.
 */
export function isPublishedTrackSource(record) {
  return String(record?.source || '').toLowerCase().trim() === PUBLISHED_SOURCE
}

/**
 * When we recorded the pick, not the slate / grade day.
 * Prefer PropValidation.timestamp (insert time), then completedAt.
 */
export function publishedRecordedAt(record) {
  if (!record || typeof record !== 'object') return null
  return parseRecordInstant(record.timestamp) || parseRecordInstant(record.completedAt)
}

/**
 * Old-generator signature from the Oct 2026 review. Corroboration only —
 * the exclusion rule is the pipeline-start date, not this fingerprint.
 */
export function legacyNflPublishedFingerprint(record) {
  const probability = Number(record?.probability)
  const edge = Number(record?.edge)
  const american = toAmericanOdds(record?.odds)
  return {
    probabilityInOldBand: Number.isFinite(probability)
      && probability >= 0.50
      && probability <= 0.515,
    edgeInOldBand: Number.isFinite(edge) && edge >= 0.15,
    americanInOldBand: Number.isFinite(american)
      && american >= 125
      && american <= 180,
  }
}

function recordHasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key)
}

/**
 * NFL rows written before the current Published persist path existed.
 * Used only on the graded public record — not on today's live board
 * (`isPublishedEligibleProp`) and not on persist.
 *
 * Record time is timestamp, then completedAt. Both-null (keys present,
 * no evidence) is not excluded. A narrower select that omits both
 * columns would otherwise silently readmit legacy rows — throw instead.
 */
export function isLegacyNflPublishedRow(record) {
  if (!record || typeof record !== 'object') return false
  if (normalizeSport(record.sport) !== 'nfl') return false
  const hasTimestamp = recordHasOwn(record, 'timestamp')
  const hasCompletedAt = recordHasOwn(record, 'completedAt')
  if (!hasTimestamp && !hasCompletedAt) {
    throw new Error(
      'isLegacyNflPublishedRow requires timestamp or completedAt on NFL rows. '
      + 'A narrower select would silently readmit legacy Published picks. '
      + 'Use PUBLISHED_STATS_SELECT (includes timestamp).',
    )
  }
  const at = publishedRecordedAt(record)
  if (!at) return false
  return at < new Date(PUBLISHED_PIPELINE_START)
}

function inPublishedSports(record, opts = {}) {
  const sports = opts.sports || PUBLISHED_SPORTS
  return sports.includes(normalizeSport(record?.sport))
}

export function cohortTagsFromNotes(notes) {
  return [...new Set(String(notes || '').match(COHORT_TAG_PATTERN) || [])]
}

export function isShadowPublishedCohort(record) {
  return String(record?.notes || '').includes(SHADOW_PUBLISHED_COHORT_TAG)
}

/**
 * True Published persist rows. Do not use String.includes(PUBLISHED_COHORT_TAG)
 * — `cohort:shadow-published` contains that substring.
 */
export function isPublishedCohort(record) {
  return cohortTagsFromNotes(record?.notes).includes(PUBLISHED_COHORT_TAG)
}

/** Public player-prop sports: same list as the homepage Published board. */
export function isPublicPropSport(sport) {
  return PUBLISHED_SPORTS.includes(normalizeSport(sport))
}

export function isAutoSavedNotes(notes) {
  return String(notes || '').includes(AUTO_SAVED_NOTES_TOKEN)
}

/** Shadow tag without the auto-saved token — brand-new shadow inserts. */
export function isPrivateShadowPublished(record) {
  const notes = String(record?.notes || '')
  return notes.includes(SHADOW_PUBLISHED_COHORT_TAG) && !notes.includes(AUTO_SAVED_NOTES_TOKEN)
}

/**
 * Keep cohort:* tags when grading overwrites notes. Without this, shadow
 * rows would look like ordinary NHL archive after validate:all.
 * Empty / null next notes return the tags alone — never a trailing " | ".
 */
export function withPreservedCohortNotes(existingNotes, nextNotes) {
  const next = nextNotes == null ? '' : String(nextNotes)
  const missing = cohortTagsFromNotes(existingNotes).filter((tag) => !next.includes(tag))
  if (missing.length === 0) return next
  if (!next) return missing.join(' ')
  return `${missing.join(' ')} | ${next}`
}

/**
 * Append a cohort tag onto existing notes (auto-saved `tier:…` stays).
 * Idempotent if the tag is already present.
 */
export function withAppendedCohortTag(existingNotes, tag) {
  const label = String(tag || '').trim()
  const current = existingNotes == null ? '' : String(existingNotes).trim()
  if (!label) return current
  if (!current) return label
  if (current.includes(label)) return current
  return `${current} | ${label}`
}

export function oddsMarketNotesTag(market) {
  const key = String(market || '').toLowerCase().trim()
  if (!key) return ''
  return `${ODDS_MARKET_NOTES_PREFIX}${key}`
}

export function sourceMarketFromNotes(notes) {
  const match = String(notes || '').match(/\boddsMarket:([a-z0-9_]+)/i)
  return match ? match[1].toLowerCase() : null
}

/** Prefer an explicit sourceMarket; otherwise parse oddsMarket: from notes. */
export function sourceMarketFromPick(pick) {
  const direct = String(pick?.sourceMarket || '').toLowerCase().trim()
  if (direct) return direct
  return sourceMarketFromNotes(pick?.notes)
}

export function notesHasExactTag(notes, tag) {
  const label = String(tag || '').trim()
  if (!label) return false
  return String(notes || '')
    .split('|')
    .map((part) => part.trim())
    .includes(label)
}

export function withAppendedNoteTokens(existingNotes, tokens) {
  let current = existingNotes == null ? '' : String(existingNotes)
  for (const token of tokens || []) {
    current = withAppendedCohortTag(current, token)
  }
  return current
}

export function withAppendedOddsMarketTag(existingNotes, market) {
  const tag = oddsMarketNotesTag(market)
  const current = existingNotes == null ? '' : String(existingNotes)
  if (!tag) return current
  if (notesHasExactTag(current, tag)) return current
  const trimmed = current.trim()
  if (!trimmed) return tag
  return `${trimmed} | ${tag}`
}

export function publishedPersistNotes(existingNotes, fieldsNotes, { shadow = false } = {}) {
  if (shadow) return withAppendedCohortTag(existingNotes, SHADOW_PUBLISHED_COHORT_TAG)
  return fieldsNotes
}

/**
 * Once a close is stored or first pitch has happened, the recorded
 * odds/line are the CLV entry and must not move with later board ticks.
 */
export function shouldLockPublishedRecordedPrice(existing, game, now = new Date()) {
  if (!existing || typeof existing !== 'object') return false
  if (existing.closeOdds != null || Boolean(existing.closeCapturedAt)) return true
  const start = parseRecordInstant(game?.date)
  const instant = now instanceof Date ? now : new Date(now)
  if (start && start.getTime() <= instant.getTime()) return true
  const status = game?.status
  if (status == null || String(status).trim() === '') return false
  return !isPreStartStatus(status)
}

export function publishedOddsChanged(existing, fields) {
  const prev = existing?.odds
  const next = fields?.odds
  if (prev == null && next == null) return false
  if (prev == null || next == null) return true
  return Number(prev) !== Number(next)
}

export function publishedValidationUpdateFields(existing, fields, game, { shadow = false } = {}) {
  if (!fields || typeof fields !== 'object') return null
  const lockPrice = shouldLockPublishedRecordedPrice(existing, game)
  const patch = {
    projectedValue: fields.projectedValue,
    confidence: fields.confidence,
    edge: fields.edge,
    qualityScore: fields.qualityScore,
    source: fields.source,
    notes: publishedPersistNotes(existing?.notes, fields.notes, { shadow }),
    ...(fields.numBooks != null ? { numBooks: fields.numBooks } : {}),
  }
  if (!lockPrice) {
    patch.threshold = fields.threshold
    patch.prediction = fields.prediction
    patch.odds = fields.odds
    patch.probability = fields.probability
    if (fields.entryBook) {
      patch.entryBook = fields.entryBook
    } else if (publishedOddsChanged(existing, fields)) {
      // New price with no book — do not keep attributing the old book.
      patch.entryBook = null
    }
  }
  return patch
}

/**
 * SQL-side shadow exclusion for Published-only surfaces (homepage board,
 * Published ROI/CLV). Drops every shadow-tagged row.
 */
export function applyShadowPublishedNotesExclusion(query) {
  if (!query || typeof query.or !== 'function') return query
  return query.or(SHADOW_PUBLISHED_NOTES_OR_FILTER)
}

/**
 * SQL-side exclusion for public archive / insights / counts / API.
 * Keeps auto-saved NHL that also carry the shadow tag.
 */
export function applyPrivateShadowPublishedNotesExclusion(query) {
  if (!query || typeof query.or !== 'function') return query
  return query.or(PRIVATE_SHADOW_PUBLISHED_NOTES_OR_FILTER)
}

export function applyPublicArchiveNotesFilter(query, options = {}) {
  if (options.excludePrivateShadowPublished === false) return query
  return applyPrivateShadowPublishedNotesExclusion(query)
}

export function withoutShadowPublished(records) {
  if (!Array.isArray(records)) return []
  return records.filter((record) => !isShadowPublishedCohort(record))
}

export function withoutPrivateShadowPublished(records) {
  if (!Array.isArray(records)) return []
  return records.filter((record) => !isPrivateShadowPublished(record))
}

export function filterPublicArchiveRows(records, options = {}) {
  if (options.excludePrivateShadowPublished === false) {
    return Array.isArray(records) ? records : []
  }
  return withoutPrivateShadowPublished(records)
}

/** Public JSON must not leak cohort:* tags. */
export function toPublicValidationRecord(record) {
  if (!record || typeof record !== 'object') return record
  const rest = { ...record }
  delete rest.notes
  return rest
}

/** Non-playable alt placeholders and any other stale cache row. */
export function isStalePropCacheRow(row) {
  return row?.isStale === true
}

export function omitStalePropCacheRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !isStalePropCacheRow(row))
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

/** Identical Published bar, sport list = SHADOW_PUBLISHED_SPORTS (NHL). */
export function isShadowPublishedEligibleProp(record) {
  return isPublishedEligibleProp(record, { sports: SHADOW_PUBLISHED_SPORTS })
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
  if (!isPublishedTrackSource(record)) return false
  if (!opts.includeLegacyNfl && isLegacyNflPublishedRow(record)) return false
  if (!opts.includeLegacyNhl && isLegacyNhlModelRecord(record)) return false
  if (isShadowPublishedCohort(record) && !opts.includeShadowPublished) return false
  // Former shadow sports only join the public card once tagged published.
  // Untagged NHL archive and leftover shadow rows stay off Published ROI.
  if (
    SHADOW_PUBLISHED_SPORTS.includes(normalizeSport(record?.sport))
    && !isPublishedCohort(record)
    && !opts.includeShadowPublished
  ) return false
  return isPublishedEligibleProp(record, opts)
}

export function isShadowPublishedPick(record, opts = {}) {
  if (!isShadowPublishedCohort(record)) return false
  return isPublishedPick(record, {
    ...opts,
    sports: SHADOW_PUBLISHED_SPORTS,
    includeShadowPublished: true,
  })
}

export function filterShadowPublishedPicks(records, opts = {}) {
  if (!Array.isArray(records)) return []
  return records.filter((record) => isShadowPublishedPick(record, opts))
}

export function summarizeShadowPublishedPicks(records, opts = {}) {
  return summarizeCohort(filterShadowPublishedPicks(records, opts))
}

export function filterPublishedPicks(records, opts = {}) {
  if (!Array.isArray(records)) return []
  return records.filter((record) => isPublishedPick(record, opts))
}

/**
 * Before/after the legacy-NFL exclusion. `before` uses the locked
 * Published rules including those rows; `after` is the honest card.
 */
export function comparePublishedLegacyNfl(records, opts = {}) {
  const rows = Array.isArray(records) ? records : []
  const beforeRows = filterPublishedPicks(rows, { ...opts, includeLegacyNfl: true })
  const afterRows = filterPublishedPicks(rows, { ...opts, includeLegacyNfl: false })
  const excluded = beforeRows.filter((record) => isLegacyNflPublishedRow(record))
  return {
    before: summarizeCohort(beforeRows),
    after: summarizeCohort(afterRows),
    excluded,
  }
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
  if (String(record.source || '').toLowerCase().trim() !== GAME_LINE_SOURCE) return false
  if (!isGameLineRecord(record)) return false
  if (!isGradedRecord(record)) return false
  if (!hasPositiveEdge(record)) return false
  if (!opts.includeLegacyNhl && isLegacyNhlModelRecord(record)) return false
  if (!inPublishedSports(record, { sports: opts.sports || GAME_LINE_SPORTS })) return false
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

function publishedPickSide(record) {
  return String(record?.pick || record?.prediction || '').toLowerCase().trim()
}

/**
 * Same player + market + line in one game, ignoring Over/Under.
 * Used so we never record both sides of one prop line.
 */
export function playerPropLineKey(record) {
  if (!record || typeof record !== 'object') return ''
  const gameId = record.gameId || record.gameIdRef || ''
  const player = String(record.playerName || '').toLowerCase().trim()
  const market = String(record.type || record.propType || '').toLowerCase().trim()
  const line = record.threshold == null ? '' : String(record.threshold)
  if (!gameId || !player || !market || line === '') return ''
  return [normalizeSport(record.sport), gameId, player, market, line].join('|')
}

export function isOppositePlayerPropSide(a, b) {
  if (!a || !b) return false
  const key = playerPropLineKey(a)
  if (!key || key !== playerPropLineKey(b)) return false
  const left = publishedPickSide(a)
  const right = publishedPickSide(b)
  return (left === 'over' && right === 'under') || (left === 'under' && right === 'over')
}

/**
 * 2 = cohort:published (non-shadow), 1 = Published-eligible cache row,
 * 0 = auto-save tier / shadow / ineligible. Higher always wins the
 * opposite-side choice, even against a bigger edge.
 */
function publishedPreferenceRank(record) {
  if (!record || typeof record !== 'object') return 0
  if (isShadowPublishedCohort(record)) return 0
  if (isPublishedCohort(record)) return 2
  if (isAutoSavedNotes(record?.notes)) return 0
  if (isPublishedEligibleProp(record)) return 1
  return 0
}

/**
 * Rows that may block the opposite player-prop side.
 * Auto-save tier and shadow rows do not.
 */
export function isPublishedOppositeBlocker(record) {
  return publishedPreferenceRank(record) > 0
}

export function hasOppositePublishedBlocker(candidate, records) {
  return (Array.isArray(records) ? records : []).some(
    (row) => isPublishedOppositeBlocker(row) && isOppositePlayerPropSide(candidate, row),
  )
}

function oppositeSideIdentity(record) {
  return publishedPropId(record) || boardRowKey(record) || String(record?.id || '')
}

function stableOppositeTiebreak(a, b) {
  const aId = String(a?.propId || a?.id || '')
  const bId = String(b?.propId || b?.id || '')
  if (aId !== bId) return aId < bId ? -1 : 1
  const aPick = publishedPickSide(a)
  const bPick = publishedPickSide(b)
  if (aPick !== bPick) return aPick < bPick ? -1 : 1
  const aName = String(a?.playerName || '')
  const bName = String(b?.playerName || '')
  if (aName !== bName) return aName < bName ? -1 : 1
  return 0
}

/** Negative → a ranks first (Published, then edge, then QS, then stable). */
function compareOppositeSideRank(a, b) {
  const rankDiff = publishedPreferenceRank(b) - publishedPreferenceRank(a)
  if (rankDiff !== 0) return rankDiff
  const edgeDiff = (Number(b?.edge) || 0) - (Number(a?.edge) || 0)
  if (edgeDiff !== 0) return edgeDiff
  const qsDiff = (Number(b?.qualityScore) || 0) - (Number(a?.qualityScore) || 0)
  if (qsDiff !== 0) return qsDiff
  return stableOppositeTiebreak(a, b)
}

function uniqueWinningSide(rows) {
  const byKey = new Map()
  for (const row of rows) {
    const key = oppositeSideIdentity(row)
    const existing = byKey.get(key)
    if (!existing || compareOppositeSideRank(row, existing) < 0) {
      byKey.set(key, row)
    }
  }
  return [...byKey.values()]
}

/**
 * Drop the weaker Over/Under when both sides of the same player+market+line
 * are present. Published (cohort or eligible) always beats a tier/auto-save
 * row. Equal strength uses a stable tiebreak — never drops both. Cache
 * propId ignores book, so same-identity winning rows collapse to one;
 * distinct propIds on the winning side are kept.
 */
export function filterOppositePlayerPropSides(records) {
  const rows = Array.isArray(records) ? records : []
  const groups = new Map()
  const passthrough = []
  for (const record of rows) {
    const key = playerPropLineKey(record)
    const side = publishedPickSide(record)
    if (!key || (side !== 'over' && side !== 'under')) {
      passthrough.push(record)
      continue
    }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }

  const kept = [...passthrough]
  for (const group of groups.values()) {
    const overs = group.filter((row) => publishedPickSide(row) === 'over')
    const unders = group.filter((row) => publishedPickSide(row) === 'under')
    if (!overs.length || !unders.length) {
      kept.push(...group)
      continue
    }
    const bestOver = [...overs].sort(compareOppositeSideRank)[0]
    const bestUnder = [...unders].sort(compareOppositeSideRank)[0]
    const winning = compareOppositeSideRank(bestOver, bestUnder) <= 0 ? overs : unders
    kept.push(...uniqueWinningSide(winning))
  }
  return kept
}

/**
 * Auto-save / tier persist: never write a side that Published already owns
 * or is about to record. Then collapse remaining Over/Under pairs.
 */
export function selectAutoSaveValidationProps(candidates, publishedRecords = [], { cap = 50 } = {}) {
  const top = (Array.isArray(candidates) ? candidates : [])
    .filter((prop) => !isJuiceTrap(prop))
    .slice(0, cap)
  return filterOppositePlayerPropSides(
    top.filter((prop) => !hasOppositePublishedBlocker(prop, publishedRecords)),
  )
}

/**
 * Upcoming Published-eligible cache rows for the auto-save opposite-side
 * guard. Ordered qualityScore desc, then propId asc so pagination cannot
 * skip or reshuffle a big slate. Callers must paginate — do not .limit().
 */
export function publishedEligibleAutoSaveCacheQuery(client, { sport, now }) {
  return client
    .from('PlayerPropCache')
    .select('*')
    .eq('sport', sport)
    .eq('isStale', false)
    .gte('expiresAt', now)
    .gt('edge', PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
    .gte('qualityScore', PUBLISHED_STATS_PREFILTER.minQuality)
    .order('qualityScore', { ascending: false })
    .order('propId', { ascending: true })
}

export const AUTO_SAVE_PUBLISHED_PREFETCH_MAX_PAGES = 20

export async function loadPublishedEligibleForAutoSave(client, {
  sport,
  now = new Date().toISOString(),
  paginate,
  maxPages = AUTO_SAVE_PUBLISHED_PREFETCH_MAX_PAGES,
  log = console.warn,
} = {}) {
  if (typeof paginate !== 'function') {
    throw new Error('loadPublishedEligibleForAutoSave requires paginate')
  }
  const { rows, error, capped } = await paginate(
    () => publishedEligibleAutoSaveCacheQuery(client, { sport, now }),
    { maxPages },
  )
  if (error) return { rows: [], error, capped: false }
  if (capped) {
    const capError = new Error(
      `Published-eligible prefetch for ${String(sport || '').toUpperCase()} `
      + `hit the ${maxPages}-page cap; later rows were not loaded`,
    )
    log(`⚠️ ${sanitizedErrorMessage(capError)}`)
    return { rows: [], error: capError, capped: true }
  }
  return {
    rows: omitStalePropCacheRows(rows).filter((prop) => isPublishedEligibleProp(prop)),
    error: null,
    capped: false,
  }
}

/** True when auto-save must not run because the Published-eligible prefetch failed. */
export function skipAutoSaveAfterPublishedPrefetchError(error, sport, log = console.warn) {
  if (!error) return false
  const detail = sanitizedErrorMessage(error) || String(error)
  log(
    `⚠️ Skipping auto-save for ${String(sport || '').toUpperCase()}: `
    + `cannot load Published-eligible props (${detail})`,
  )
  return true
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
/**
 * Same propId fetch-live-odds writes on PlayerPropCache:
 * `${gameId}-${playerName}-${market}-${line}-${pick}`.
 * Market is the Odds API key as stored, including `*_alternate`.
 * Stripping that suffix would write a second row beside the legacy id.
 * Short names such as `pass_yds` are not remapped; those still fall back to `pub-`.
 */
export function canonicalPlayerPropCacheId(record) {
  if (!record || typeof record !== 'object') return null
  const gameId = record.gameId || record.gameIdRef
  const playerName = record.playerName
  const market = String(sourceMarketFromPick(record) || record.type || record.propType || '').trim()
  const line = record.threshold ?? record.line
  const pick = String(record.pick || record.prediction || '').toLowerCase().trim()
  if (!gameId || playerName == null || String(playerName).trim() === '') return null
  if (!market || line == null || line === '' || !pick) return null
  return `${gameId}-${playerName}-${market}-${line}-${pick}`
}

export function publishedPropId(record) {
  if (!record || typeof record !== 'object') return null
  if (record.propId) return String(record.propId)
  const canonical = canonicalPlayerPropCacheId(record)
  if (canonical) return canonical
  const key = boardRowKey(record)
  if (!key) return null
  return `pub-${key.replace(/\|/g, '-')}`
}

/**
 * PropValidation insert/update payload from the cache row that cleared
 * the Published bar. Keeps that row's qualityScore / edge / odds — does
 * not recalculate QS, and never tags the row as a game line.
 */
export function toPublishedValidationFields(record, opts = {}) {
  const sports = opts.sports || PUBLISHED_SPORTS
  const notes = withAppendedNoteTokens(
    opts.notes ?? PUBLISHED_COHORT_TAG,
    record.availabilityFlags,
  )
  if (!isPublishedEligibleProp(record, { ...opts, sports })) return null
  const propId = publishedPropId(record)
  const gameIdRef = record.gameId || record.gameIdRef
  if (!propId || !gameIdRef || !record.playerName) return null

  return attachNumBooks(attachEntryBook({
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
    notes: withAppendedOddsMarketTag(notes, sourceMarketFromPick(record)),
  }, record), record)
}

/**
 * Pending Published or shadow-published rows that still need a close.
 * NHL (still listed in SHADOW_PUBLISHED_SPORTS) needs a published or
 * shadow tag so untagged archive does not start burning Odds API calls.
 * MLB / NFL stay on the live eligibility bar, tag optional.
 */
export function isCloseCaptureEligiblePick(record) {
  if (!record || typeof record !== 'object') return false
  if (!isPublishedTrackSource(record)) return false
  const sport = normalizeSport(record.sport)
  if (SHADOW_PUBLISHED_SPORTS.includes(sport)) {
    const tagged = isPublishedCohort(record) || isShadowPublishedCohort(record)
    if (!tagged) return false
    return isPublishedEligibleProp(record) || isShadowPublishedEligibleProp(record)
  }
  return isPublishedEligibleProp(record)
}

/**
 * insert = new row, update = refresh pending system fields from the live
 * board, skip = already graded (do not rewrite history), skip_foreign =
 * pending/other row is not system_generated. Never adopt or relabel a
 * user_saved / parlay_leg / untagged row into the Published persist path.
 * Skip (do not mint a second propId) because PropValidation.propId is unique.
 */
export function publishedValidationWritePlan(existing, opts = {}) {
  if (!existing) return 'insert'
  if (!isPublishedTrackSource(existing)) return 'skip_foreign'
  // Historical shadow NHL rows stay as written. New persist must not
  // retag them cohort:published or refresh their pending fields.
  if (!opts.shadow && isShadowPublishedCohort(existing)) return 'skip_shadow'
  const status = String(existing.status || '').toLowerCase().trim()
  if (status === 'completed' || status === 'needs_review' || status === 'manual_closed') {
    return 'skip'
  }
  return 'update'
}

/**
 * Homepage last-night list and yesterday W–L share this membership:
 * graded Published pick + cohort:published tag + prior-ET slate window.
 * Eligibility alone (isPublishedPick) is not enough — untagged archive
 * must not appear on one surface and the other.
 */
export function isHomepageYesterdayPublished(record, now = new Date()) {
  if (!isPublishedPick(record)) return false
  if (!isPublishedCohort(record)) return false
  const { start, end } = getEtCalendarDayRange(-1, now)
  const at = publishedSlateInstant(record)
  return at != null && at >= start && at < end
}

/**
 * Homepage "Last night · Published" rows.
 * Same prior-ET slate window and cohort tag as summarizeYesterdayPublished.
 */
export function selectLastNightPublished(records, now = new Date()) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => isHomepageYesterdayPublished(record, now))
    .slice()
    .sort((a, b) => {
      const aAt = publishedSlateInstant(a)?.getTime() || 0
      const bAt = publishedSlateInstant(b)?.getTime() || 0
      return bAt - aAt
    })
    .slice(0, TODAYS_BOARD_CAP)
}

export function summarizeYesterdayPublished(records, now = new Date()) {
  const inYesterday = (Array.isArray(records) ? records : [])
    .filter((record) => isHomepageYesterdayPublished(record, now))
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
