/**
 * Plan and apply retirement of ghost / flipped scheduled Game rows.
 *
 * Pure planner: planReconcile(). I/O (ESPN, StatsAPI, Supabase) lives in
 * the run/apply helpers so jest can inject clients. Retire means
 * status='not_needed' — this module never deletes Game rows.
 */

import { etDateKey } from './game-grade-eligibility.js'
import { isMlbStatsDoubleheader } from './mlb-confirmed-lineup.js'
import { isOpsWriteQuietPeriod } from './mlb-recording-window.js'
import { parseStoredGameDate } from './score-updater.js'
import {
  MLB_TEAM_CODE_ALIASES,
  canonicalizeMlbAbbr,
} from './team-mapping.js'
import {
  isDeadStatus,
  isFinalStatus,
  isLiveStatus,
  isPreStartStatus,
  isStartedOrEndedStatus,
  RETIRABLE_PRE_START,
} from './game-status.js'

export { RETIRABLE_PRE_START }

export const DEFAULT_RECONCILE_SPORT = 'mlb'
export const DEFAULT_RECONCILE_DAYS = 3
export const DEFAULT_MAX_RETIRES = 5
export const DEFAULT_MAX_RETIRE_PCT = 0.30
export const MIN_PCT_CANDIDATES = 5
/** Dates with fewer than MIN_PCT_CANDIDATES abort if either bound is exceeded. */
export const SMALL_DATE_MAX_RETIRES = 1
export const SMALL_DATE_MAX_PCT = 0.50
export const DEFAULT_RECONCILE_CAPS = Object.freeze({
  maxRetires: DEFAULT_MAX_RETIRES,
  maxPct: DEFAULT_MAX_RETIRE_PCT,
  minPctCandidates: MIN_PCT_CANDIDATES,
})

/** Optional (b) retire of a true one-day drift when both feeds already started/final. Off by default. */
export const ENABLE_DRIFT_DUPLICATE_RETIRE = false

/** Shared ESPN-canonical aliases (ATH/CHW stored; OAK/CWS accepted). */
export const MLB_ABBR_ALIASES = MLB_TEAM_CODE_ALIASES

export const RECONCILE_CLI_USAGE = `Usage:
  node scripts/reconcile-games.js [--sport mlb] [--date YYYY-MM-DD] [--days N] [--apply] [--max N] [--max-pct N] [--include-past] [--json]

Retire ghost / flipped scheduled games by setting status=not_needed.
Never deletes rows. Dry-run is the default (no writes).

Options:
  --sport mlb          Sport to reconcile (only mlb is supported)
  --date YYYY-MM-DD    First ET date (default: today ET)
  --days N             Inclusive ET-day span from --date (default ${DEFAULT_RECONCILE_DAYS})
  --include-past       Allow candidates on --date when that date is before today ET
  --apply              Write status=not_needed. Refused during :05–:15 ET.
  --max N              Abort if planned retires exceed N (default ${DEFAULT_MAX_RETIRES})
  --max-pct N          Percentage 0-100 cap when a date has ${MIN_PCT_CANDIDATES}+ candidates (default 30)
  --json               Print a final JSON summary
  --help, -h           Print usage and exit

Windows: run with node scripts/reconcile-games.js (not npm run).
`

const SETTLED_PARLAY_OUTCOMES = new Set([
  'won', 'lost', 'push', 'void', 'cancelled', 'canceled',
])

const SOURCE_HARD_ABORT = new Set(['unavailable', 'malformed'])
const SOURCE_EMPTY_STATES = new Set(['empty', 'zero'])

function freezeCaps(caps) {
  const maxRetires = Number(caps?.maxRetires)
  const maxPct = Number(caps?.maxPct)
  const minPctCandidates = Number(caps?.minPctCandidates)
  return {
    maxRetires: Number.isFinite(maxRetires) && maxRetires >= 0 ? maxRetires : DEFAULT_MAX_RETIRES,
    maxPct: Number.isFinite(maxPct) && maxPct >= 0 ? maxPct : DEFAULT_MAX_RETIRE_PCT,
    minPctCandidates: Number.isFinite(minPctCandidates) && minPctCandidates >= 0
      ? minPctCandidates
      : MIN_PCT_CANDIDATES,
  }
}

/**
 * Per-date retire cap. Dates with 5+ candidates keep the 30% rule.
 * Smaller dates abort when the run would retire more than 1 game or
 * 50% or more of that date's candidates. A lone 1-of-1 retire is
 * allowed; 1-of-2 (50%) aborts.
 */
export function dateRetireCapHit(dateRetires, dateCandidates, caps = DEFAULT_RECONCILE_CAPS) {
  const limits = freezeCaps(caps)
  const nCand = Number(dateCandidates) || 0
  const nRet = Number(dateRetires) || 0
  if (nCand <= 0 || nRet <= 0) return null
  if (nCand < limits.minPctCandidates) {
    const pctExceeded = nCand > 1 && nRet / nCand >= SMALL_DATE_MAX_PCT
    if (nRet > SMALL_DATE_MAX_RETIRES || pctExceeded) {
      return {
        reason: 'cap_exceeded',
        retires: nRet,
        candidates: nCand,
        maxRetires: SMALL_DATE_MAX_RETIRES,
        maxPct: SMALL_DATE_MAX_PCT,
        smallDate: true,
      }
    }
    return null
  }
  if (nRet / nCand > limits.maxPct) {
    return {
      reason: 'cap_exceeded',
      retires: nRet,
      candidates: nCand,
      maxRetires: limits.maxRetires,
      maxPct: limits.maxPct,
    }
  }
  return null
}

export function isSourceEmptyState(state) {
  return SOURCE_EMPTY_STATES.has(String(state || '').toLowerCase())
}

export function shouldAbortReconcileSources(espnState, statsState) {
  if (SOURCE_HARD_ABORT.has(espnState)) {
    return { abort: true, source: 'espn', state: espnState }
  }
  if (SOURCE_HARD_ABORT.has(statsState)) {
    return { abort: true, source: 'statsapi', state: statsState }
  }
  const espnEmpty = isSourceEmptyState(espnState)
  const statsEmpty = isSourceEmptyState(statsState)
  if (espnEmpty && statsEmpty) return { abort: false, bothEmpty: true }
  if (espnEmpty || statsEmpty) {
    return {
      abort: true,
      source: espnEmpty ? 'espn' : 'statsapi',
      state: espnEmpty ? espnState : statsState,
    }
  }
  return { abort: false }
}

export function normalizeMlbAbbr(value) {
  return canonicalizeMlbAbbr(value)
}

export function etTodayKey(now = new Date()) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

/** UTC ISO of 00:00 America/New_York on an ET calendar date. */
export function etDayStartIso(etDateStr) {
  const key = String(etDateStr || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const asEdt = new Date(`${key}T00:00:00-04:00`)
  const asEst = new Date(`${key}T00:00:00-05:00`)
  const seen = (instant) => instant.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  if (seen(asEdt) === key) return asEdt.toISOString()
  return asEst.toISOString()
}

export function shiftEtDate(dateStr, days) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0))
  return dt.toISOString().slice(0, 10)
}

export function parseGameIdParts(id) {
  const raw = String(id || '').trim()
  const match = raw.match(/^([A-Za-z0-9]+)_at_([A-Za-z0-9]+)_(\d{4}-\d{2}-\d{2})(?:_(.+))?$/)
  if (!match) return null
  return {
    awayAbbr: normalizeMlbAbbr(match[1]),
    homeAbbr: normalizeMlbAbbr(match[2]),
    date: match[3],
    suffix: match[4] || null,
  }
}

export function unorderedPairKey(a, b) {
  const left = normalizeMlbAbbr(a)
  const right = normalizeMlbAbbr(b)
  if (!left || !right) return ''
  return [left, right].sort().join('|')
}

export function orientationKey(away, home) {
  const awayAbbr = normalizeMlbAbbr(away)
  const homeAbbr = normalizeMlbAbbr(home)
  if (!awayAbbr || !homeAbbr) return ''
  return `${awayAbbr}_at_${homeAbbr}`
}

export function rowEtDate(row) {
  const fromId = parseGameIdParts(row?.id)?.date
  if (fromId) return fromId
  return etDateKey(row?.date) || null
}

export function emptyDependents() {
  return {
    propValidation: 0,
    propValidationPending: 0,
    propValidationGraded: 0,
    propValidationPublished: 0,
    parlayLeg: 0,
    parlayLegPending: 0,
    playerPropCache: 0,
    odds: 0,
    edgeSnapshot: 0,
  }
}

export function isPendingParlayOutcome(outcome) {
  const raw = String(outcome == null ? 'pending' : outcome).toLowerCase().trim()
  if (!raw || raw === 'pending' || raw === 'null') return true
  return !SETTLED_PARLAY_OUTCOMES.has(raw)
}

function isGradedValidationStatus(status) {
  const raw = String(status || '').toLowerCase().trim()
  return raw === 'completed' || raw === 'manual_closed' || raw === 'needs_review'
}

function isPublishedValidationRow(row) {
  const notes = String(row?.notes || '')
  return notes.includes('cohort:published')
}

export function hasProtectedPicks(dependents = {}) {
  return Number(dependents.propValidationPending || 0) > 0
    || Number(dependents.parlayLegPending || 0) > 0
    || Number(dependents.propValidationGraded || 0) > 0
    || Number(dependents.propValidationPublished || 0) > 0
}

function rowDependents(row) {
  return { ...emptyDependents(), ...(row?.dependents || {}) }
}

function hasNumericScore(value) {
  if (value === null || value === undefined || value === '') return false
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

export function classifyReconcileCandidate(row, {
  todayEt,
  lastFetchedDate,
  includePast = false,
  fetchedDates = null,
} = {}) {
  const date = rowEtDate(row)
  if (!date) return { candidate: false, reason: 'undated' }
  const windowStart = includePast && fetchedDates?.[0] ? fetchedDates[0] : todayEt
  if (windowStart && date < windowStart) return { candidate: false, reason: 'out_of_range', date }
  if (lastFetchedDate && date > lastFetchedDate) return { candidate: false, reason: 'out_of_range', date }
  if (isDeadStatus(row?.status) || isFinalStatus(row?.status) || isLiveStatus(row?.status)) {
    return { candidate: false, reason: 'not_retirable_status', date }
  }
  if (!isPreStartStatus(row?.status)) return { candidate: false, reason: 'not_pre_start', date }
  if (hasNumericScore(row?.homeScore) || hasNumericScore(row?.awayScore)) {
    return { candidate: false, reason: 'has_score', date }
  }
  return { candidate: true, date }
}

function sourceState(statusByDate, date) {
  return String(statusByDate?.[date] || '').toLowerCase() || null
}

function inferSourceState(entries, date, statusByDate) {
  const explicit = sourceState(statusByDate, date)
  if (explicit) return explicit
  const forDate = (entries || []).filter((entry) => entry?.date === date)
  if (forDate.some((entry) => entry?.unavailable)) return 'unavailable'
  if (forDate.some((entry) => entry?.malformed)) return 'malformed'
  if (forDate.length === 0) return 'empty'
  return 'ok'
}

function normalizeSourceEntry(entry, fallbackDate) {
  if (!entry || typeof entry !== 'object') return null
  if (entry.unavailable || entry.malformed) {
    return {
      date: entry.date || fallbackDate,
      unavailable: Boolean(entry.unavailable),
      malformed: Boolean(entry.malformed),
    }
  }
  const parts = parseGameIdParts(entry.id)
  const awayAbbr = normalizeMlbAbbr(
    entry.awayAbbr || entry.away || parts?.awayAbbr || entry._awayTeam?.abbreviation || entry._awayTeam?.abbr,
  )
  const homeAbbr = normalizeMlbAbbr(
    entry.homeAbbr || entry.home || parts?.homeAbbr || entry._homeTeam?.abbreviation || entry._homeTeam?.abbr,
  )
  const date = entry.dateKey
    || (typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : null)
    || parts?.date
    || etDateKey(entry.date)
    || fallbackDate
    || null
  if (!date || !awayAbbr || !homeAbbr) return null
  return {
    date,
    awayAbbr,
    homeAbbr,
    pair: unorderedPairKey(awayAbbr, homeAbbr),
    orientation: orientationKey(awayAbbr, homeAbbr),
    espnGameId: entry.espnGameId != null ? String(entry.espnGameId) : '',
    gamePk: entry.gamePk != null ? String(entry.gamePk) : (entry.mlbGameId != null ? String(entry.mlbGameId) : ''),
    doubleHeader: entry.doubleHeader,
    status: entry.status,
  }
}

function indexSources(entries) {
  const byDatePair = new Map()
  const byEspnId = new Map()
  const byGamePk = new Map()
  const byPair = new Map()
  for (const raw of entries || []) {
    const entry = normalizeSourceEntry(raw)
    if (!entry || entry.unavailable || entry.malformed) continue
    const datePair = `${entry.date}|${entry.pair}`
    const list = byDatePair.get(datePair) || []
    list.push(entry)
    byDatePair.set(datePair, list)
    if (entry.espnGameId) byEspnId.set(`${entry.date}|${entry.espnGameId}`, entry)
    if (entry.gamePk) byGamePk.set(`${entry.date}|${entry.gamePk}`, entry)
    const pairList = byPair.get(entry.pair) || []
    pairList.push(entry)
    byPair.set(entry.pair, pairList)
  }
  return { byDatePair, byEspnId, byGamePk, byPair }
}

function rowHasVendorId(row) {
  return Boolean(String(row?.espnGameId || '').trim() || String(row?.mlbGameId || '').trim())
}

function rowVendorIds(row) {
  return {
    espn: String(row?.espnGameId || '').trim(),
    pk: String(row?.mlbGameId || '').trim(),
  }
}

function idMatch(row, hit) {
  const ids = rowVendorIds(row)
  return Boolean(
    (ids.espn && String(hit?.espnGameId || '') === ids.espn)
    || (ids.pk && String(hit?.gamePk || '') === ids.pk),
  )
}

/** Value-keyed id lookup. byEspnId / byGamePk stay date|id for same-day lookup. */
function hitIds(index) {
  const byEspn = new Map()
  const byPk = new Map()
  for (const list of index?.byPair?.values() || []) {
    for (const hit of list) {
      if (hit.espnGameId) {
        const found = byEspn.get(hit.espnGameId) || []
        found.push(hit)
        byEspn.set(hit.espnGameId, found)
      }
      if (hit.gamePk) {
        const found = byPk.get(hit.gamePk) || []
        found.push(hit)
        byPk.set(hit.gamePk, found)
      }
    }
  }
  return { byEspn, byPk }
}

function knownVendorIdAnywhere(row, espnIndex, statsIndex) {
  const ids = rowVendorIds(row)
  const espnHits = hitIds(espnIndex)
  const statsHits = hitIds(statsIndex)
  if (ids.espn && (espnHits.byEspn.has(ids.espn) || statsHits.byEspn.has(ids.espn))) return true
  if (ids.pk && (espnHits.byPk.has(ids.pk) || statsHits.byPk.has(ids.pk))) return true
  return false
}

function sourceStateOkOrZero(state) {
  const raw = String(state || '').toLowerCase()
  return raw === 'ok' || raw === 'zero'
}

function pairRowsOnDate(dbRows, pair, date, { excludeId } = {}) {
  return (dbRows || []).filter((row) => {
    if (excludeId && row.id === excludeId) return false
    const meta = rowOrientationMeta(row)
    return meta?.pair === pair && rowEtDate(row) === date
  })
}

function qualifiesDriftDuplicate({
  row,
  date,
  pair,
  orientation,
  espnIndex,
  statsIndex,
  espnEvents,
  statsApiGames,
  espnStatusByDate,
  statsStatusByDate,
  espnGlobalDown,
  statsGlobalDown,
  espnState,
  statsState,
  dbRows,
  enabled,
}) {
  if (!enabled) return false
  if (hasProtectedPicks(rowDependents(row))) return false
  if (!sourceStateOkOrZero(espnState) || !sourceStateOkOrZero(statsState)) return false
  if (pairRowsOnDate(dbRows, pair, date, { excludeId: row.id }).length > 0) return false

  for (const offset of [-1, 1]) {
    const adjacentDate = shiftEtDate(date, offset)
    if (!adjacentDate) continue
    const espnHits = espnIndex.byDatePair.get(`${adjacentDate}|${pair}`) || []
    const statsHits = statsIndex.byDatePair.get(`${adjacentDate}|${pair}`) || []
    if (espnHits.length !== 1 || statsHits.length !== 1) continue
    const espnHit = espnHits[0]
    const statsHit = statsHits[0]
    if (isMlbStatsDoubleheader(espnHit.doubleHeader) || isMlbStatsDoubleheader(espnHit)) continue
    if (isMlbStatsDoubleheader(statsHit.doubleHeader) || isMlbStatsDoubleheader(statsHit)) continue
    if (pairIsDoubleheader(statsIndex, adjacentDate, pair)) continue
    if (!espnHit.orientation || espnHit.orientation !== statsHit.orientation) continue
    if (orientation && espnHit.orientation !== orientation) continue
    if (!isStartedOrEndedStatus(espnHit.status) || !isStartedOrEndedStatus(statsHit.status)) continue
    const adjEspnState = espnGlobalDown
      ? 'unavailable'
      : inferSourceState(espnEvents, adjacentDate, espnStatusByDate)
    const adjStatsState = statsGlobalDown
      ? 'unavailable'
      : inferSourceState(statsApiGames, adjacentDate, statsStatusByDate)
    if (!sourceStateOkOrZero(adjEspnState) || !sourceStateOkOrZero(adjStatsState)) continue
    const matchedIds = idMatch(row, espnHit) || idMatch(row, statsHit)
    const sibling = pairRowsOnDate(dbRows, pair, adjacentDate).some((other) => (
      isLiveStatus(other.status) || isFinalStatus(other.status)
    ))
    if (!matchedIds && !sibling) continue
    return true
  }
  return false
}

function lookupOnDate(index, row, date) {
  const parts = parseGameIdParts(row?.id)
  const pair = parts ? unorderedPairKey(parts.awayAbbr, parts.homeAbbr) : ''
  const orientation = parts ? orientationKey(parts.awayAbbr, parts.homeAbbr) : ''
  const pairHits = pair ? (index.byDatePair.get(`${date}|${pair}`) || []) : []
  const sameOrientation = pairHits.filter((hit) => !orientation || hit.orientation === orientation)
  if (sameOrientation.length) return sameOrientation
  if (row?.espnGameId && index.byEspnId.get(`${date}|${String(row.espnGameId)}`)) {
    return [index.byEspnId.get(`${date}|${String(row.espnGameId)}`)]
  }
  if (row?.mlbGameId && index.byGamePk.get(`${date}|${String(row.mlbGameId)}`)) {
    return [index.byGamePk.get(`${date}|${String(row.mlbGameId)}`)]
  }
  return []
}

/** Opposite-orientation feed hit with no vendor id — do not retire as a ghost. */
export function isFlipNoTwin(row, espnIndex, statsIndex, date) {
  if (rowHasVendorId(row)) return false
  const meta = rowOrientationMeta(row)
  if (!meta) return false
  const keep = agreedOrientation(
    espnIndex?.byDatePair?.get(`${date}|${meta.pair}`) || [],
    statsIndex?.byDatePair?.get(`${date}|${meta.pair}`) || [],
  )
  return Boolean(keep && keep !== meta.orientation)
}

function rowOrientationMeta(row) {
  const parts = parseGameIdParts(row?.id)
  if (!parts) return null
  return {
    parts,
    pair: unorderedPairKey(parts.awayAbbr, parts.homeAbbr),
    orientation: orientationKey(parts.awayAbbr, parts.homeAbbr),
  }
}

function lookupWindow(index, row, date) {
  const hits = []
  for (const offset of [-1, 0, 1]) {
    const day = shiftEtDate(date, offset)
    if (!day) continue
    for (const hit of lookupOnDate(index, row, day)) {
      hits.push(hit)
    }
  }
  if (row?.espnGameId) {
    for (const entry of index.byEspnId.values()) {
      if (String(entry.espnGameId) === String(row.espnGameId) && !hits.includes(entry)) {
        hits.push(entry)
      }
    }
  }
  return hits
}

function agreedOrientation(espnHits, statsHits) {
  const espnOr = [...new Set((espnHits || []).map((hit) => hit.orientation).filter(Boolean))]
  const statsOr = [...new Set((statsHits || []).map((hit) => hit.orientation).filter(Boolean))]
  if (espnOr.length !== 1 || statsOr.length !== 1) return null
  return espnOr[0] === statsOr[0] ? espnOr[0] : null
}

function pairIsDoubleheader(statsIndex, date, pair) {
  const hits = statsIndex.byDatePair.get(`${date}|${pair}`) || []
  return hits.some((hit) => isMlbStatsDoubleheader(hit.doubleHeader) || isMlbStatsDoubleheader(hit))
}

function makeAction(row, { action, reason, dependents }) {
  const parts = parseGameIdParts(row.id)
  return {
    id: row.id,
    status: row.status,
    priorStatus: row.status,
    date: rowEtDate(row),
    action,
    reason,
    dependents: dependents || rowDependents(row),
    orientation: parts ? orientationKey(parts.awayAbbr, parts.homeAbbr) : null,
    clearOddsApiEventId: false,
  }
}

function emptySummary() {
  return {
    candidates: 0,
    ghosts: 0,
    flips: 0,
    protected: 0,
    aborted: 0,
    retired: 0,
    dateDrift: 0,
    sourceDisagree: 0,
    outOfRange: 0,
    flipAmbiguous: 0,
    flipNoTwin: 0,
    doubleheader: 0,
    hasScore: 0,
    notPreStart: 0,
    ghostIdsUnknown: 0,
    driftDuplicates: 0,
  }
}

function tally(summary, reason, action) {
  if (action === 'retire_not_needed' && reason === 'ghost') summary.ghosts += 1
  if (action === 'retire_not_needed' && reason === 'flipped_duplicate') summary.flips += 1
  if (action === 'retire_not_needed' && reason === 'ghost_ids_unknown') {
    summary.ghosts += 1
    summary.ghostIdsUnknown += 1
  }
  if (action === 'retire_not_needed' && reason === 'date_drift_duplicate') summary.driftDuplicates += 1
  if (action === 'retire_not_needed') summary.retired += 1
  if (reason === 'protected_has_picks') summary.protected += 1
  if (reason === 'date_drift') summary.dateDrift += 1
  if (reason === 'source_disagree') summary.sourceDisagree += 1
  if (reason === 'out_of_range') summary.outOfRange += 1
  if (reason === 'flip_ambiguous') summary.flipAmbiguous += 1
  if (reason === 'flip_no_twin') summary.flipNoTwin += 1
  if (reason === 'doubleheader') summary.doubleheader += 1
  if (reason === 'has_score') summary.hasScore += 1
  if (reason === 'not_pre_start') summary.notPreStart += 1
}

const REPORT_NON_CANDIDATE_REASONS = new Set(['has_score', 'not_pre_start', 'out_of_range'])

function emptyDateSummary(date) {
  return {
    date,
    candidates: 0,
    ghosts: 0,
    flips: 0,
    protected: 0,
    aborted: 0,
    hasScore: 0,
    notPreStart: 0,
    outOfRange: 0,
    dateDrift: 0,
    ghostIdsUnknown: 0,
    driftDuplicates: 0,
  }
}

function protectOrRetire(row, reason) {
  const dependents = rowDependents(row)
  if (hasProtectedPicks(dependents)) {
    return makeAction(row, { action: 'report', reason: 'protected_has_picks', dependents })
  }
  return makeAction(row, { action: 'retire_not_needed', reason, dependents })
}

/**
 * @param {{
 *   dbRows?: object[],
 *   espnEvents?: object[] | null,
 *   statsApiGames?: object[] | null,
 *   espnStatusByDate?: Record<string, string>,
 *   statsStatusByDate?: Record<string, string>,
 *   nowEt?: Date | string,
 *   lastFetchedDate?: string,
 *   fetchedDates?: string[],
 *   includePast?: boolean,
 *   caps?: { maxRetires?: number, maxPct?: number, minPctCandidates?: number },
 *   enableDriftDuplicateRetire?: boolean,
 * }} input
 */
export function planReconcile({
  dbRows = [],
  espnEvents = [],
  statsApiGames = [],
  espnStatusByDate = {},
  statsStatusByDate = {},
  nowEt = new Date(),
  lastFetchedDate = null,
  fetchedDates = null,
  includePast = false,
  caps = DEFAULT_RECONCILE_CAPS,
  enableDriftDuplicateRetire = ENABLE_DRIFT_DUPLICATE_RETIRE,
} = {}) {
  const todayEt = typeof nowEt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(nowEt)
    ? nowEt
    : etTodayKey(nowEt)
  const sourceDates = [
    ...new Set([
      ...(fetchedDates || []),
      ...((espnEvents || []).map((event) => event?.date).filter(Boolean)),
      ...((statsApiGames || []).map((game) => game?.date).filter(Boolean)),
    ]),
  ].sort()
  const lastDay = lastFetchedDate
    || (sourceDates.filter((date) => date >= todayEt).at(-1) || null)

  const actions = []
  const aborts = []
  const summary = emptySummary()
  const limits = freezeCaps(caps)

  const espnGlobalDown = espnEvents == null
  const statsGlobalDown = statsApiGames == null
  const espnIndex = indexSources(espnEvents || [])
  const statsIndex = indexSources(statsApiGames || [])

  const classified = (dbRows || []).map((row) => {
    const info = classifyReconcileCandidate(row, {
      todayEt,
      lastFetchedDate: lastDay,
      includePast,
      fetchedDates: fetchedDates || (lastDay ? [todayEt, lastDay] : null),
    })
    return { row, ...info }
  })

  for (const item of classified) {
    if (item.candidate) continue
    if (item.reason === 'out_of_range' && isPreStartStatus(item.row?.status)) {
      actions.push(makeAction(item.row, { action: 'report', reason: 'out_of_range' }))
      tally(summary, 'out_of_range', 'report')
      continue
    }
    if (item.reason !== 'out_of_range' && REPORT_NON_CANDIDATE_REASONS.has(item.reason)) {
      actions.push(makeAction(item.row, { action: 'report', reason: item.reason }))
      tally(summary, item.reason, 'report')
    }
  }

  const candidates = classified.filter((item) => item.candidate)
  summary.candidates = candidates.length

  const byDate = new Map()
  for (const item of candidates) {
    const list = byDate.get(item.date) || []
    list.push(item)
    byDate.set(item.date, list)
  }

  const handled = new Set()
  const dateSummaries = []
  const dates = new Set(byDate.keys())
  for (const item of classified) {
    if (!item.candidate && REPORT_NON_CANDIDATE_REASONS.has(item.reason) && item.date) {
      dates.add(item.date)
    }
  }

  for (const date of [...dates].sort((a, b) => a.localeCompare(b))) {
    const items = byDate.get(date) || []
    const dateSummary = emptyDateSummary(date)
    dateSummary.candidates = items.length
    dateSummary.hasScore = classified.filter((item) => item.date === date && item.reason === 'has_score').length
    dateSummary.notPreStart = classified.filter((item) => item.date === date && item.reason === 'not_pre_start').length
    dateSummary.outOfRange = classified.filter((item) => item.date === date && item.reason === 'out_of_range').length
    if (items.length === 0) {
      dateSummaries.push(dateSummary)
      continue
    }
    const espnState = espnGlobalDown ? 'unavailable' : inferSourceState(espnEvents, date, espnStatusByDate)
    const statsState = statsGlobalDown ? 'unavailable' : inferSourceState(statsApiGames, date, statsStatusByDate)
    const sourceGate = shouldAbortReconcileSources(espnState, statsState)
    if (sourceGate.abort) {
      aborts.push({
        date,
        reason: 'reconcile_source_unavailable',
        source: sourceGate.source,
        state: sourceGate.state,
      })
      dateSummary.aborted = items.length
      summary.aborted += 1
      dateSummaries.push(dateSummary)
      continue
    }

    const rowsOnDate = (dbRows || []).filter((row) => rowEtDate(row) === date)
    const groups = new Map()
    for (const item of items) {
      const meta = rowOrientationMeta(item.row)
      const pair = meta?.pair || `id:${item.row.id}`
      const list = groups.get(pair) || []
      list.push({ ...item, ...meta, pair })
      groups.set(pair, list)
    }

    for (const [pair, group] of groups.entries()) {
      if (pairIsDoubleheader(statsIndex, date, pair)) {
        for (const item of group) {
          handled.add(item.row.id)
          actions.push(makeAction(item.row, { action: 'report', reason: 'doubleheader' }))
          tally(summary, 'doubleheader', 'report')
        }
        continue
      }

      const espnHits = espnIndex.byDatePair.get(`${date}|${pair}`) || []
      const statsHits = statsIndex.byDatePair.get(`${date}|${pair}`) || []
      const keepOrientation = agreedOrientation(espnHits, statsHits)
      const siblings = rowsOnDate
        .map((row) => ({ row, ...rowOrientationMeta(row) }))
        .filter((item) => item.pair === pair)
      const dbOrientations = new Set(siblings.map((item) => item.orientation).filter(Boolean))

      if (!keepOrientation) {
        if (dbOrientations.size >= 2) {
          for (const item of group) {
            handled.add(item.row.id)
            actions.push(makeAction(item.row, { action: 'report', reason: 'flip_ambiguous' }))
            tally(summary, 'flip_ambiguous', 'report')
          }
        }
        continue
      }

      const hasCorrect = siblings.some((item) => item.orientation === keepOrientation)
      for (const item of group) {
        if (item.orientation === keepOrientation) continue
        if (hasCorrect) {
          handled.add(item.row.id)
          const planned = protectOrRetire(item.row, 'flipped_duplicate')
          actions.push(planned)
          tally(summary, planned.reason, planned.action)
          if (planned.reason === 'protected_has_picks') dateSummary.protected += 1
          if (planned.action === 'retire_not_needed') dateSummary.flips += 1
          continue
        }
        if (isFlipNoTwin(item.row, espnIndex, statsIndex, date)) {
          handled.add(item.row.id)
          actions.push(makeAction(item.row, { action: 'report', reason: 'flip_no_twin' }))
          tally(summary, 'flip_no_twin', 'report')
        }
      }
    }

    for (const item of items) {
      if (handled.has(item.row.id)) continue
      const espnToday = lookupOnDate(espnIndex, item.row, date)
      const statsToday = lookupOnDate(statsIndex, item.row, date)
      const inEspn = espnToday.length > 0
      const inStats = statsToday.length > 0

      if (inEspn && inStats) continue

      if (isFlipNoTwin(item.row, espnIndex, statsIndex, date)) {
        actions.push(makeAction(item.row, { action: 'report', reason: 'flip_no_twin' }))
        tally(summary, 'flip_no_twin', 'report')
        continue
      }

      if (inEspn !== inStats) {
        actions.push(makeAction(item.row, { action: 'report', reason: 'source_disagree' }))
        tally(summary, 'source_disagree', 'report')
        continue
      }

      const espnWindow = lookupWindow(espnIndex, item.row, date)
      const statsWindow = lookupWindow(statsIndex, item.row, date)
      const adjacent = [...espnWindow, ...statsWindow].filter((hit) => hit.date !== date)
      if (adjacent.length > 0) {
        const meta = rowOrientationMeta(item.row)
        const matchedAdjacent = adjacent.some((hit) => idMatch(item.row, hit))
        const driftDuplicate = qualifiesDriftDuplicate({
          row: item.row,
          date,
          pair: meta?.pair,
          orientation: meta?.orientation,
          espnIndex,
          statsIndex,
          espnEvents,
          statsApiGames,
          espnStatusByDate,
          statsStatusByDate,
          espnGlobalDown,
          statsGlobalDown,
          espnState,
          statsState,
          dbRows,
          enabled: enableDriftDuplicateRetire,
        })
        const ids = rowVendorIds(item.row)
        // Both vendor ids must be present to treat unmatched adjacent pair hits as
        // ghost_ids_unknown. A single espn id (existing :187 fixture) stays date_drift.
        if (!rowHasVendorId(item.row) || matchedAdjacent || !ids.espn || !ids.pk) {
          if (driftDuplicate) {
            const planned = protectOrRetire(item.row, 'date_drift_duplicate')
            actions.push(planned)
            tally(summary, planned.reason, planned.action)
            if (planned.reason === 'protected_has_picks') dateSummary.protected += 1
            if (planned.action === 'retire_not_needed') dateSummary.driftDuplicates += 1
          } else {
            actions.push(makeAction(item.row, {
              action: 'report',
              reason: 'date_drift',
            }))
            tally(summary, 'date_drift', 'report')
            dateSummary.dateDrift += 1
          }
          continue
        }
        if (knownVendorIdAnywhere(item.row, espnIndex, statsIndex)) {
          actions.push(makeAction(item.row, {
            action: 'report',
            reason: 'date_drift',
          }))
          tally(summary, 'date_drift', 'report')
          dateSummary.dateDrift += 1
          continue
        }
        const planned = protectOrRetire(item.row, 'ghost_ids_unknown')
        actions.push(planned)
        tally(summary, planned.reason, planned.action)
        if (planned.reason === 'protected_has_picks') dateSummary.protected += 1
        if (planned.action === 'retire_not_needed') {
          dateSummary.ghosts += 1
          dateSummary.ghostIdsUnknown += 1
        }
        continue
      }

      const planned = protectOrRetire(item.row, 'ghost')
      actions.push(planned)
      tally(summary, planned.reason, planned.action)
      if (planned.reason === 'protected_has_picks') dateSummary.protected += 1
      if (planned.action === 'retire_not_needed') dateSummary.ghosts += 1
    }

    dateSummaries.push(dateSummary)
  }

  const plannedRetires = actions.filter((action) => action.action === 'retire_not_needed')
  let capHit = null
  if (plannedRetires.length > limits.maxRetires) {
    capHit = {
      reason: 'cap_exceeded',
      retires: plannedRetires.length,
      maxRetires: limits.maxRetires,
      maxPct: limits.maxPct,
    }
  } else {
    for (const dateSummary of dateSummaries) {
      const dateRetires = plannedRetires.filter((action) => action.date === dateSummary.date).length
      const hit = dateRetireCapHit(dateRetires, dateSummary.candidates, limits)
      if (hit) {
        capHit = { ...hit, date: dateSummary.date, maxRetires: limits.maxRetires }
        break
      }
    }
  }

  if (capHit) {
    aborts.push(capHit)
    summary.aborted += 1
    const kept = actions.filter((action) => action.action !== 'retire_not_needed')
    actions.length = 0
    actions.push(...kept)
    summary.retired = 0
    summary.ghosts = 0
    summary.flips = 0
    summary.ghostIdsUnknown = 0
    summary.driftDuplicates = 0
    for (const dateSummary of dateSummaries) {
      dateSummary.ghosts = 0
      dateSummary.flips = 0
      dateSummary.ghostIdsUnknown = 0
      dateSummary.driftDuplicates = 0
      dateSummary.aborted = dateSummary.candidates
    }
  }

  return {
    actions,
    aborts,
    summary,
    dateSummaries,
    todayEt,
    lastFetchedDate: lastDay,
    caps: limits,
  }
}

export function canApplyReconcile(now = new Date()) {
  return !isOpsWriteQuietPeriod(now)
}

export function formatReconcilePlanTable(actions = []) {
  const header = ['id', 'status', 'date', 'action', 'reason', 'dependents']
  const rows = actions.map((action) => {
    const deps = action.dependents || {}
    const dep = `pv:${deps.propValidationPending || 0}/${deps.propValidation || 0} pl:${deps.parlayLegPending || 0}/${deps.parlayLeg || 0} odds:${deps.odds || 0} edge:${deps.edgeSnapshot || 0} props:${deps.playerPropCache || 0}`
    return [action.id, action.status, action.date, action.action, action.reason, dep].join('\t')
  })
  return [header.join('\t'), ...rows].join('\n')
}

function takeValue(args, flag) {
  const i = args.indexOf(flag)
  if (i < 0) return { present: false, value: null, error: null }
  const raw = args[i + 1]
  if (raw == null || raw.startsWith('--')) {
    return { present: true, value: null, error: `${flag} requires a value` }
  }
  return { present: true, value: raw, error: null }
}

const KNOWN_FLAGS = new Set([
  '--sport', '--date', '--days', '--apply', '--max', '--max-pct', '--include-past', '--json', '--help', '-h',
])

export function parseMaxPctValue(raw) {
  if (raw == null || String(raw).trim() === '') {
    return { error: '--max-pct requires a percent between 0 and 100' }
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { error: '--max-pct must be a percent between 0 and 100' }
  }
  return { value: n / 100 }
}

export function parseReconcileCliArgs(argv = []) {
  const args = [...argv]
  const unknown = []
  const valueFlags = new Set(['--sport', '--date', '--days', '--max', '--max-pct'])
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (valueFlags.has(arg)) {
      i += 1
      continue
    }
    const flag = arg.split('=')[0]
    if (!KNOWN_FLAGS.has(flag)) unknown.push(arg)
  }
  if (unknown.length) {
    return { error: `Unknown or invalid argument: ${unknown[0]}` }
  }
  for (const arg of args) {
    if (arg.includes('=') && arg.startsWith('--')) {
      return { error: `Use a space, not '=': ${arg.split('=')[0]} <value>` }
    }
  }

  if (args.includes('--help') || args.includes('-h')) {
    return { help: true }
  }

  const sportArg = takeValue(args, '--sport')
  if (sportArg.error) return { error: sportArg.error }
  const sport = String(sportArg.value || DEFAULT_RECONCILE_SPORT).toLowerCase()
  if (sport !== 'mlb') {
    return { error: `Only --sport mlb is supported (got ${sport})` }
  }

  const dateArg = takeValue(args, '--date')
  if (dateArg.error) return { error: dateArg.error }
  const date = dateArg.value || null
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: '--date must be YYYY-MM-DD' }
  }

  const daysArg = takeValue(args, '--days')
  if (daysArg.error) return { error: daysArg.error }
  let days = DEFAULT_RECONCILE_DAYS
  if (daysArg.present) {
    const parsed = Number(daysArg.value)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 14) {
      return { error: '--days must be an integer between 1 and 14' }
    }
    days = parsed
  }

  const maxArg = takeValue(args, '--max')
  if (maxArg.error) return { error: maxArg.error }
  let maxRetires = DEFAULT_MAX_RETIRES
  if (maxArg.present) {
    const parsed = Number(maxArg.value)
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { error: '--max must be an integer >= 0' }
    }
    maxRetires = parsed
  }

  const maxPctArg = takeValue(args, '--max-pct')
  if (maxPctArg.error) return { error: maxPctArg.error }
  let maxPct = DEFAULT_MAX_RETIRE_PCT
  if (maxPctArg.present) {
    const parsed = parseMaxPctValue(maxPctArg.value)
    if (parsed.error) return { error: parsed.error }
    maxPct = parsed.value
  }

  return {
    help: false,
    sport,
    date,
    days,
    apply: args.includes('--apply'),
    json: args.includes('--json'),
    includePast: args.includes('--include-past'),
    maxRetires,
    maxPct,
    caps: { maxRetires, maxPct, minPctCandidates: MIN_PCT_CANDIDATES },
  }
}

export function espnDateParam(dateStr) {
  return String(dateStr || '').replace(/-/g, '')
}

export function mapEspnScoreboardEvents(payload, dateStr) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) {
    return { state: 'malformed', events: [] }
  }
  const events = []
  for (const event of payload.events) {
    const competition = event?.competitions?.[0]
    const competitors = competition?.competitors || []
    const home = competitors.find((c) => c.homeAway === 'home') || competitors[0]
    const away = competitors.find((c) => c.homeAway === 'away') || competitors[1]
    const homeAbbr = normalizeMlbAbbr(home?.team?.abbreviation || home?.team?.abbr)
    const awayAbbr = normalizeMlbAbbr(away?.team?.abbreviation || away?.team?.abbr)
    if (!homeAbbr || !awayAbbr) continue
    const date = dateStr || etDateKey(event.date)
    events.push({
      date,
      espnGameId: event.id != null ? String(event.id) : '',
      homeAbbr,
      awayAbbr,
      away: awayAbbr,
      home: homeAbbr,
      status: event.status,
    })
  }
  if (payload.events.length > 0 && events.length === 0) {
    return { state: 'malformed', events: [] }
  }
  return { state: events.length ? 'ok' : 'empty', events }
}

export function mapStatsApiSchedule(payload, dateStr) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.dates)) {
    return { state: 'malformed', games: [] }
  }
  const games = []
  for (const day of payload.dates) {
    const dayKey = day?.date || dateStr
    if (!Array.isArray(day?.games)) {
      return { state: 'malformed', games: [] }
    }
    for (const game of day.games) {
      const homeAbbr = normalizeMlbAbbr(game?.teams?.home?.team?.abbreviation)
      const awayAbbr = normalizeMlbAbbr(game?.teams?.away?.team?.abbreviation)
      if (!homeAbbr || !awayAbbr || game?.gamePk == null) continue
      games.push({
        date: dayKey,
        gamePk: String(game.gamePk),
        homeAbbr,
        awayAbbr,
        home: homeAbbr,
        away: awayAbbr,
        doubleHeader: game.doubleHeader,
        status: game.status,
      })
    }
  }
  if (payload.dates.length === 0) return { state: 'empty', games: [] }
  const day = payload.dates.find((entry) => entry?.date === dateStr) || payload.dates[0]
  if (day && Array.isArray(day.games) && day.games.length === 0) return { state: 'empty', games }
  return { state: games.length ? 'ok' : 'empty', games }
}

export async function fetchEspnReconcileEvents(dates, { fetchImpl = fetch, logger = console } = {}) {
  const events = []
  const statusByDate = {}
  for (const date of dates) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${espnDateParam(date)}`
    try {
      const response = await fetchImpl(url, { headers: { 'User-Agent': 'OddsOnDeck/1.0' } })
      if (!response.ok) {
        statusByDate[date] = 'unavailable'
        logger.warn?.(`reconcile_source_unavailable espn ${date} HTTP ${response.status}`)
        continue
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        statusByDate[date] = 'malformed'
        logger.warn?.(`reconcile_source_unavailable espn ${date} malformed json`)
        continue
      }
      const mapped = mapEspnScoreboardEvents(payload, date)
      statusByDate[date] = mapped.state
      events.push(...mapped.events)
    } catch (error) {
      statusByDate[date] = 'unavailable'
      logger.warn?.(`reconcile_source_unavailable espn ${date} ${error.message}`)
    }
  }
  return { events, statusByDate }
}

export async function fetchStatsApiReconcileGames(dates, { fetchImpl = fetch, logger = console } = {}) {
  const games = []
  const statusByDate = {}
  for (const date of dates) {
    const url = `https://statsapi.mlb.com/api/v1/schedule?date=${date}&sportId=1&hydrate=team`
    try {
      const response = await fetchImpl(url)
      if (!response.ok) {
        statusByDate[date] = 'unavailable'
        logger.warn?.(`reconcile_source_unavailable statsapi ${date} HTTP ${response.status}`)
        continue
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        statusByDate[date] = 'malformed'
        logger.warn?.(`reconcile_source_unavailable statsapi ${date} malformed json`)
        continue
      }
      const mapped = mapStatsApiSchedule(payload, date)
      statusByDate[date] = mapped.state
      games.push(...mapped.games)
    } catch (error) {
      statusByDate[date] = 'unavailable'
      logger.warn?.(`reconcile_source_unavailable statsapi ${date} ${error.message}`)
    }
  }
  return { games, statusByDate }
}

export function datesToReconcile({ date, days = DEFAULT_RECONCILE_DAYS, now = new Date() } = {}) {
  const start = date || etTodayKey(now)
  const list = []
  for (let i = 0; i < days; i += 1) {
    const next = shiftEtDate(start, i)
    if (next) list.push(next)
  }
  return list
}

export function sourceDatesWithPadding(dates) {
  const padded = new Set()
  for (const date of dates || []) {
    padded.add(shiftEtDate(date, -1))
    padded.add(date)
    padded.add(shiftEtDate(date, 1))
  }
  return [...padded].filter(Boolean).sort()
}

function isoWindowForEtDates(dates) {
  const start = dates[0]
  const end = dates[dates.length - 1]
  return {
    startIso: `${shiftEtDate(start, -1)}T00:00:00.000Z`,
    endIso: `${shiftEtDate(end, 1)}T23:59:59.999Z`,
  }
}

export async function loadReconcileGameRows(supabase, { sport, dates }) {
  // isoWindowForEtDates already pads ±1 ET day so (b) can see LIVE/FINAL
  // siblings on an adjacent date. Those padded rows are not planner candidates.
  const { startIso, endIso } = isoWindowForEtDates(dates)
  const { data, error } = await supabase
    .from('Game')
    .select('id, sport, date, status, homeId, awayId, homeScore, awayScore, espnGameId, mlbGameId, oddsApiEventId')
    .eq('sport', sport)
    .gte('date', startIso)
    .lte('date', endIso)
  if (error) throw new Error(`Game load failed: ${error.message}`)
  return data || []
}

function increment(map, key, field) {
  const current = map.get(key) || emptyDependents()
  current[field] = (current[field] || 0) + 1
  map.set(key, current)
}

export async function loadReconcileDependents(supabase, gameIds) {
  const counts = new Map()
  for (const id of gameIds) counts.set(id, emptyDependents())
  if (gameIds.length === 0) return counts

  const [propRes, parlayRes, cacheRes, oddsRes, edgeRes] = await Promise.all([
    supabase.from('PropValidation').select('gameIdRef, status, source, notes, result').in('gameIdRef', gameIds),
    supabase.from('ParlayLeg').select('gameIdRef, outcome').in('gameIdRef', gameIds),
    supabase.from('PlayerPropCache').select('gameId').in('gameId', gameIds),
    supabase.from('Odds').select('gameId').in('gameId', gameIds),
    supabase.from('EdgeSnapshot').select('gameId').in('gameId', gameIds),
  ])

  const failed = [propRes, parlayRes, cacheRes, oddsRes, edgeRes].find((res) => res?.error)
  if (failed?.error) {
    throw new Error(`dependents_unavailable: ${failed.error.message}`)
  }

  for (const row of propRes.data || []) {
    increment(counts, row.gameIdRef, 'propValidation')
    if (String(row.status || '').toLowerCase() === 'pending') {
      increment(counts, row.gameIdRef, 'propValidationPending')
    }
    if (isGradedValidationStatus(row.status)) {
      increment(counts, row.gameIdRef, 'propValidationGraded')
    }
    if (isPublishedValidationRow(row)) {
      increment(counts, row.gameIdRef, 'propValidationPublished')
    }
  }
  for (const row of parlayRes.data || []) {
    increment(counts, row.gameIdRef, 'parlayLeg')
    if (isPendingParlayOutcome(row.outcome)) {
      increment(counts, row.gameIdRef, 'parlayLegPending')
    }
  }
  for (const row of cacheRes.data || []) increment(counts, row.gameId, 'playerPropCache')
  for (const row of oddsRes.data || []) increment(counts, row.gameId, 'odds')
  for (const row of edgeRes.data || []) increment(counts, row.gameId, 'edgeSnapshot')
  return counts
}

export function attachDependents(rows, counts) {
  return (rows || []).map((row) => ({
    ...row,
    dependents: counts.get(row.id) || emptyDependents(),
  }))
}

export async function applyReconcilePlan(supabase, plan, {
  now = new Date(),
  logger = console,
  ignoreQuietPeriod = false,
} = {}) {
  if (!ignoreQuietPeriod && !canApplyReconcile(now)) {
    logger.warn?.('Refuse --apply during ops quiet window (:05–:15 ET)')
    return {
      refused: true,
      reason: 'ops_quiet_period',
      applied: [],
      skipped: [],
      errors: [],
      deleteCalled: false,
    }
  }

  const applied = []
  const skipped = []
  const errors = []
  const retires = (plan?.actions || []).filter((action) => action.action === 'retire_not_needed')

  for (const action of retires) {
    try {
      const result = await supabase
        .from('Game')
        .update({
          status: 'not_needed',
          lastUpdate: new Date(now).toISOString(),
        })
        .eq('id', action.id)
        .eq('status', action.priorStatus)
        .select('id')
      if (result?.error) {
        logger.error?.(`reconcile update error ${action.id}: ${result.error.message}`)
        errors.push({ id: action.id, error: result.error.message })
        continue
      }
      if (!result?.data?.length) {
        logger.warn?.(`skipped_changed_concurrently ${action.id}`)
        skipped.push({ id: action.id, reason: 'skipped_changed_concurrently' })
        continue
      }
      applied.push({ id: action.id, status: 'not_needed' })
    } catch (error) {
      logger.error?.(`reconcile update error ${action.id}: ${error.message}`)
      errors.push({ id: action.id, error: error.message })
    }
  }

  return {
    refused: false,
    applied,
    skipped,
    errors,
    deleteCalled: false,
  }
}

function logPlan(logger, plan) {
  for (const action of plan.actions) {
    logger.log?.(
      `${action.action}\t${action.id}\t${action.status}\t${action.date}\t${action.reason}`,
    )
  }
  for (const abort of plan.aborts) {
    logger.warn?.(`${abort.reason}\t${abort.date || ''}\t${abort.source || ''}\t${abort.state || ''}`)
  }
  const summary = plan.summary || emptySummary()
  logger.log?.(
    `summary: candidates=${summary.candidates} has_score=${summary.hasScore} not_pre_start=${summary.notPreStart} ghosts=${summary.ghosts} flips=${summary.flips} retired=${summary.retired} out_of_range=${summary.outOfRange} date_drift=${summary.dateDrift} source_disagree=${summary.sourceDisagree} flip_ambiguous=${summary.flipAmbiguous} flip_no_twin=${summary.flipNoTwin} doubleheader=${summary.doubleheader} protected=${summary.protected} ghost_ids_unknown=${summary.ghostIdsUnknown} drift_duplicates=${summary.driftDuplicates} aborted=${summary.aborted}`,
  )
  for (const dateSummary of plan.dateSummaries || []) {
    logger.log?.(
      `date ${dateSummary.date}: candidates=${dateSummary.candidates} has_score=${dateSummary.hasScore} not_pre_start=${dateSummary.notPreStart} ghosts=${dateSummary.ghosts} flips=${dateSummary.flips} protected=${dateSummary.protected} aborted=${dateSummary.aborted} out_of_range=${dateSummary.outOfRange} date_drift=${dateSummary.dateDrift} ghost_ids_unknown=${dateSummary.ghostIdsUnknown} drift_duplicates=${dateSummary.driftDuplicates}`,
    )
  }
}

export async function runReconcile({
  sport = DEFAULT_RECONCILE_SPORT,
  date = null,
  days = DEFAULT_RECONCILE_DAYS,
  apply = false,
  json = false,
  includePast = false,
  caps = DEFAULT_RECONCILE_CAPS,
  now = new Date(),
  supabase,
  fetchImpl = fetch,
  logger = console,
  espnEvents = undefined,
  statsApiGames = undefined,
  espnStatusByDate = undefined,
  statsStatusByDate = undefined,
  dbRows = undefined,
} = {}) {
  const fetchedDates = datesToReconcile({ date, days, now })
  const sourceDates = sourceDatesWithPadding(fetchedDates)
  let espn = espnEvents
  let stats = statsApiGames
  let espnStatus = espnStatusByDate
  let statsStatus = statsStatusByDate

  if (espn === undefined || stats === undefined) {
    const [espnRes, statsRes] = await Promise.all([
      espn === undefined
        ? fetchEspnReconcileEvents(sourceDates, { fetchImpl, logger })
        : Promise.resolve(null),
      stats === undefined
        ? fetchStatsApiReconcileGames(sourceDates, { fetchImpl, logger })
        : Promise.resolve(null),
    ])
    if (espnRes) {
      espn = espnRes.events
      espnStatus = espnRes.statusByDate
    }
    if (statsRes) {
      stats = statsRes.games
      statsStatus = statsRes.statusByDate
    }
  }

  let rows = dbRows
  if (rows === undefined) {
    if (!supabase) throw new Error('supabase client is required')
    rows = await loadReconcileGameRows(supabase, { sport, dates: fetchedDates })
    const counts = await loadReconcileDependents(supabase, rows.map((row) => row.id))
    rows = attachDependents(rows, counts)
  }

  const plan = planReconcile({
    dbRows: rows,
    espnEvents: espn,
    statsApiGames: stats,
    espnStatusByDate: espnStatus || {},
    statsStatusByDate: statsStatus || {},
    nowEt: etTodayKey(now),
    lastFetchedDate: fetchedDates[fetchedDates.length - 1],
    fetchedDates,
    includePast,
    caps,
  })

  logger.log?.(formatReconcilePlanTable(plan.actions))
  logPlan(logger, plan)

  const result = {
    sport,
    apply: false,
    dates: fetchedDates,
    dryRun: !apply,
    ...plan,
    applied: [],
    skipped: [],
    errors: [],
  }

  const sourceAbort = plan.aborts.some((abort) => abort.reason === 'reconcile_source_unavailable')
  const capAbort = plan.aborts.some((abort) => abort.reason === 'cap_exceeded')

  if (apply) {
    if (!canApplyReconcile(now)) {
      logger.warn?.('Refuse --apply during ops quiet window (:05–:15 ET)')
      result.refused = true
      result.reason = 'ops_quiet_period'
      if (json) logger.log?.(JSON.stringify(result))
      return { ...result, exitCode: 1 }
    }
    if (sourceAbort || capAbort) {
      logger.warn?.('No writes: plan aborted')
      if (json) logger.log?.(JSON.stringify(result))
      return { ...result, exitCode: 1 }
    }
    const write = await applyReconcilePlan(supabase, plan, { now, logger })
    result.apply = true
    result.dryRun = false
    result.applied = write.applied
    result.skipped = write.skipped
    result.errors = write.errors
    result.refused = write.refused
    if (json) logger.log?.(JSON.stringify(result))
    return { ...result, exitCode: write.errors.length ? 1 : 0 }
  }

  if (json) logger.log?.(JSON.stringify(result))
  if (sourceAbort || capAbort) return { ...result, exitCode: 1 }
  return { ...result, exitCode: 0 }
}

export async function runReconcileCli({
  argv = [],
  env = process.env,
  now = new Date(),
  stdout = process.stdout,
  stderr = process.stderr,
  createClient,
  fetchImpl = fetch,
  loadEnv = null,
} = {}) {
  const parsed = parseReconcileCliArgs(argv)
  const logger = {
    log: (...args) => stdout.write(`${args.join(' ')}\n`),
    warn: (...args) => stderr.write(`${args.join(' ')}\n`),
    error: (...args) => stderr.write(`${args.join(' ')}\n`),
  }
  if (parsed.help) {
    logger.log(RECONCILE_CLI_USAGE)
    return { exitCode: 0, help: true }
  }
  if (parsed.error) {
    logger.error(parsed.error)
    logger.error(RECONCILE_CLI_USAGE)
    return { exitCode: 2, error: parsed.error }
  }
  if (typeof loadEnv === 'function') loadEnv(env)
  if (typeof createClient !== 'function') {
    throw new Error('createClient is required')
  }
  const supabase = createClient(env)
  const result = await runReconcile({
    sport: parsed.sport,
    date: parsed.date,
    days: parsed.days,
    apply: parsed.apply,
    json: parsed.json,
    includePast: parsed.includePast,
    caps: parsed.caps,
    now,
    supabase,
    fetchImpl,
    logger,
  })
  return result
}
