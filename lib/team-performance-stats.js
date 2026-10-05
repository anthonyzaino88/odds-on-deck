/**
 * Team performance fields written by ESPN fetch jobs.
 *
 * The Team columns last10Record / avgPointsLast10 / avgPointsAllowedLast10
 * are season aggregates (overall record and season PPG), not a trailing
 * 10-game window. Callers must treat them as season stats.
 *
 * Partial ESPN payloads must not null out columns the response omitted.
 * Explicit invalidation is a separate write. Retained prior values are
 * not a fresh update.
 */

export const TEAM_PERFORMANCE_COLUMNS = Object.freeze([
  'last10Record',
  'homeRecord',
  'awayRecord',
  'avgPointsLast10',
  'avgPointsAllowedLast10',
])

/** Identity metadata that may be written whenever ESPN provided it. */
export const TEAM_FRESHNESS_IDENTITY_COLUMNS = Object.freeze([
  'season',
  'gamesPlayed',
  'statsKind',
])

/**
 * Timestamps that describe the whole Team stats row.
 * Written only on a full present-stats extract so retained scoring
 * averages cannot inherit a new captured-at.
 */
export const TEAM_FRESHNESS_TIMESTAMP_COLUMNS = Object.freeze([
  'statsCapturedAt',
  'statsDataThrough',
])

export const TEAM_FRESHNESS_COLUMNS = Object.freeze([
  ...TEAM_FRESHNESS_IDENTITY_COLUMNS,
  ...TEAM_FRESHNESS_TIMESTAMP_COLUMNS,
])

export const TEAM_WRITE_COLUMNS = Object.freeze([
  ...TEAM_PERFORMANCE_COLUMNS,
  ...TEAM_FRESHNESS_COLUMNS,
])

/** ESPN team endpoint aggregates are season averages, not a last-10 window. */
export const ESPN_TEAM_STATS_KIND = 'season'
export const LAST10_STATS_KIND = 'last10'

/**
 * In-season team-stats freshness window for NHL / MLB edge eligibility.
 * NFL public eligibility uses the same 7-day span in lib/nfl-selection-model.js.
 * Missing or all-zero stats are rejected regardless of this window.
 */
export const TEAM_STATS_STALE_AFTER_DAYS = 7
export const TEAM_STATS_MAX_AGE_MS = TEAM_STATS_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000

/**
 * Calendar months (1-12) that count as in-season for the 7-day stale check.
 * Ranges wrap the year for NHL (Oct–Jun) and NFL (Sep–Feb).
 */
export const TEAM_STATS_IN_SEASON_MONTHS = Object.freeze({
  nhl: Object.freeze([10, 11, 12, 1, 2, 3, 4, 5, 6]),
  nfl: Object.freeze([9, 10, 11, 12, 1, 2]),
  mlb: Object.freeze([3, 4, 5, 6, 7, 8, 9, 10, 11]),
})

export const TEAM_STATS_SKIP_REASONS = Object.freeze({
  MISSING_TEAM: 'missing_team',
  NULL_STATS: 'null_team_stats',
  ALL_ZERO: 'all_zero_team_stats',
  STALE: 'stale_team_stats',
})

export function parseRecordString(record) {
  if (!record || typeof record !== 'string') {
    return { wins: 0, losses: 0, otl: 0, games: 0 }
  }
  const parts = record.split('-').map((part) => Number(part))
  const wins = Number.isFinite(parts[0]) ? parts[0] : 0
  const losses = Number.isFinite(parts[1]) ? parts[1] : 0
  const otl = Number.isFinite(parts[2]) ? parts[2] : 0
  return { wins, losses, otl, games: wins + losses + otl }
}

/**
 * Interpret a stored Team row. last10* columns are season stats.
 */
export function interpretTeamSeasonStats(team, overrides = {}) {
  const record = parseRecordString(overrides.seasonRecord || team?.seasonRecord || team?.last10Record)
  const gamesPlayed = firstNumber(
    overrides.gamesPlayed,
    team?.gamesPlayed,
    record.games,
  )

  return {
    abbr: team?.abbr || null,
    statsKind: overrides.statsKind || team?.statsKind || ESPN_TEAM_STATS_KIND,
    season: firstDefined(overrides.season, team?.season, null),
    dataThrough: firstDefined(overrides.dataThrough, team?.dataThrough, team?.statsDataThrough, null),
    capturedAt: firstDefined(overrides.capturedAt, team?.statsCapturedAt, team?.capturedAt, null),
    wins: firstNumber(overrides.wins, record.wins),
    losses: firstNumber(overrides.losses, record.losses),
    otl: firstNumber(overrides.otl, record.otl),
    gamesPlayed,
    homeRecord: team?.homeRecord || null,
    awayRecord: team?.awayRecord || null,
    seasonPointsFor: firstNumber(overrides.seasonPointsFor, team?.seasonPointsFor, team?.avgPointsLast10, null),
    seasonPointsAgainst: firstNumber(
      overrides.seasonPointsAgainst,
      team?.seasonPointsAllowed,
      team?.avgPointsAllowedLast10,
      null,
    ),
  }
}

/**
 * Last completed game timestamp from an ESPN team payload, if present.
 * Never invents "now" or the fetch clock.
 */
export function extractEspnStatsDataThrough(data) {
  const dates = []
  const team = data?.team || {}

  collectCompletedEventDate(team.previousEvent, dates)
  collectCompletedEventDate(team.previousGame, dates)
  collectCompletedEventDate(team.prevGame, dates)
  collectCompletedEventDate(data?.previousEvent, dates)
  collectCompletedEventDate(data?.previousGame, dates)

  const lists = [
    data?.events,
    team.events,
    team.nextEvent,
    team.schedule,
    data?.schedule,
  ]
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const event of list) collectCompletedEventDate(event, dates)
  }

  if (dates.length === 0) return null
  return new Date(Math.max(...dates)).toISOString()
}

/**
 * Extract ESPN team payload into present Team columns only.
 * Omitted fields are absent (not null) so a partial response cannot
 * clear existing records, scoring averages, or freshness timestamps.
 */
export function extractEspnTeamPerformance(data, sport, { extractedAt = new Date() } = {}) {
  const team = data?.team
  if (!team) return null

  const performanceData = {}
  let gamesPlayed = null
  let season = extractEspnSeason(team)

  if (team.record?.items) {
    const overallRecord = team.record.items.find((item) => item.type === 'total' || item.type === 'overall')
    const homeRecord = team.record.items.find((item) => item.type === 'home')
    const awayRecord = team.record.items.find((item) => item.type === 'road' || item.type === 'away')

    if (isUsableRecordString(overallRecord?.summary)) {
      // Season record stored in a last10-named column (legacy schema).
      performanceData.last10Record = overallRecord.summary
    }
    if (isUsableRecordString(homeRecord?.summary)) performanceData.homeRecord = homeRecord.summary
    if (isUsableRecordString(awayRecord?.summary)) performanceData.awayRecord = awayRecord.summary

    let totalFor = null
    let totalAgainst = null

    if (overallRecord?.stats) {
      for (const stat of overallRecord.stats) {
        const name = stat.name || ''
        const value = parseFloat(stat.value)

        if (name === 'avgPointsFor' || name === 'ppg') {
          if (isUsableNumericStat(value)) performanceData.avgPointsLast10 = value
        } else if (name === 'pointsFor' || name === 'points') {
          totalFor = value
        }

        if (name === 'avgPointsAgainst' || name === 'oppPpg') {
          if (isUsableNumericStat(value)) performanceData.avgPointsAllowedLast10 = value
        } else if (name === 'pointsAgainst' || name === 'pointsAllowed') {
          totalAgainst = value
        }

        if (name === 'gamesPlayed' || name === 'playedGames') {
          if (isUsableNumericStat(value)) gamesPlayed = value
        }
      }
    }

    if (gamesPlayed && gamesPlayed > 0) {
      if (performanceData.avgPointsLast10 == null && isUsableNumericStat(totalFor)) {
        const avg = totalFor / gamesPlayed
        if (isUsableNumericStat(avg)) performanceData.avgPointsLast10 = avg
      }
      if (performanceData.avgPointsAllowedLast10 == null && isUsableNumericStat(totalAgainst)) {
        const avg = totalAgainst / gamesPlayed
        if (isUsableNumericStat(avg)) performanceData.avgPointsAllowedLast10 = avg
      }
    }

    if (!gamesPlayed && performanceData.last10Record) {
      gamesPlayed = parseRecordString(performanceData.last10Record).games || null
    }
  }

  if (performanceData.avgPointsLast10 == null && team.statistics) {
    for (const stat of team.statistics) {
      if (stat.name === 'avgPointsFor' || stat.name === 'pointsPerGame') {
        const value = parseFloat(stat.value)
        if (isUsableNumericStat(value)) performanceData.avgPointsLast10 = value
      }
      if (stat.name === 'avgPointsAgainst' || stat.name === 'pointsAllowedPerGame') {
        const value = parseFloat(stat.value)
        if (isUsableNumericStat(value)) performanceData.avgPointsAllowedLast10 = value
      }
    }
  }

  const presentFields = TEAM_PERFORMANCE_COLUMNS.filter((column) => (
    Object.prototype.hasOwnProperty.call(performanceData, column)
    && performanceData[column] != null
  ))
  if (presentFields.length === 0) return null

  const omittedFields = TEAM_PERFORMANCE_COLUMNS.filter((column) => !presentFields.includes(column))
  const fullExtract = omittedFields.length === 0
  const capturedAt = toIsoTimestamp(extractedAt)
  const dataThrough = extractEspnStatsDataThrough(data)
  const statsKind = ESPN_TEAM_STATS_KIND

  const freshness = {}
  if (season != null && season !== '') freshness.season = String(season)
  if (gamesPlayed != null && Number.isFinite(Number(gamesPlayed))) {
    freshness.gamesPlayed = Number(gamesPlayed)
  }
  freshness.statsKind = statsKind
  if (fullExtract && capturedAt) {
    freshness.statsCapturedAt = capturedAt
    if (dataThrough) freshness.statsDataThrough = dataThrough
  }

  return {
    ...pickPresent(performanceData, presentFields),
    ...freshness,
    meta: {
      statsKind,
      sport,
      gamesPlayed: freshness.gamesPlayed ?? (gamesPlayed != null ? Number(gamesPlayed) : null),
      season: freshness.season ?? (season != null ? String(season) : null),
      extractedAt: capturedAt,
      dataThrough: dataThrough || null,
      last10FieldsAreSeasonAverages: true,
      presentFields,
      omittedFields,
      partial: !fullExtract,
      timestampsWritten: Boolean(freshness.statsCapturedAt),
    },
  }
}

/**
 * Build a Team.update() payload from an extract.
 * Absent / null extract fields are omitted so existing DB values stay.
 * Pass `invalidate` to clear specific columns on purpose — that is not
 * a freshness refresh of the remaining fields.
 *
 * Timestamp freshness columns are included only when the extract itself
 * attached them (full present-stats extract). A partial extract cannot
 * stamp retained stats as freshly updated.
 */
export function teamPerformanceWritePayload(extracted, { invalidate = [] } = {}) {
  const payload = {}
  const written = []
  const retained = []
  const invalidated = []
  const invalidateSet = new Set(invalidate)

  for (const column of TEAM_WRITE_COLUMNS) {
    if (invalidateSet.has(column)) {
      payload[column] = null
      invalidated.push(column)
      continue
    }
    if (
      extracted
      && Object.prototype.hasOwnProperty.call(extracted, column)
      && isWritableTeamStatValue(column, extracted[column])
    ) {
      payload[column] = extracted[column]
      written.push(column)
      continue
    }
    retained.push(column)
  }

  const performanceWritten = TEAM_PERFORMANCE_COLUMNS.every((column) => written.includes(column))

  return {
    payload,
    written,
    retained,
    invalidated,
    representsFullRefresh: invalidated.length === 0 && performanceWritten,
    retainedFieldsNotFresh: retained,
    freshnessTimestampsWritten: written.includes('statsCapturedAt'),
  }
}

/**
 * Apply an extract onto an in-memory Team row the same way the fetch
 * jobs must write: only present fields change; retained values keep
 * their prior contents and are not marked freshly updated.
 */
export function applyTeamPerformanceUpdate(existing, extracted, options = {}) {
  const write = teamPerformanceWritePayload(extracted, options)
  return {
    next: { ...(existing || {}), ...write.payload },
    payload: write.payload,
    written: write.written,
    retained: write.retained,
    invalidated: write.invalidated,
    representsFullRefresh: write.representsFullRefresh,
    freshnessTimestampsWritten: write.freshnessTimestampsWritten,
    freshness: {
      extractedAt: extracted?.meta?.extractedAt || null,
      updatedFields: write.written,
      retainedFieldsNotFresh: write.retained,
      invalidatedFields: write.invalidated,
      timestampsWritten: write.freshnessTimestampsWritten,
    },
  }
}

function extractEspnSeason(team) {
  if (team?.season && typeof team.season === 'object' && team.season.year) {
    return String(team.season.year)
  }
  if (typeof team?.season === 'number' || typeof team?.season === 'string') {
    return String(team.season)
  }
  return null
}

function collectCompletedEventDate(event, dates) {
  if (!event || typeof event !== 'object') return
  const competition = Array.isArray(event.competitions) ? event.competitions[0] : null
  const completed = Boolean(
    event.status?.type?.completed
    || event.status?.completed
    || competition?.status?.type?.completed
    || competition?.status?.completed,
  )
  if (!completed) return
  const raw = event.date || event.endDate || competition?.date || competition?.endDate
  const ms = parseTimestampMs(raw)
  if (ms != null) dates.push(ms)
}

function parseTimestampMs(value) {
  if (value == null || value === '') return null
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function toIsoTimestamp(value) {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? value.toISOString() : null
  }
  const ms = parseTimestampMs(value)
  return ms != null ? new Date(ms).toISOString() : null
}

function pickPresent(source, fields) {
  const out = {}
  for (const field of fields) out[field] = source[field]
  return out
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value
  }
  return undefined
}

function firstPresent(...values) {
  for (const value of values) {
    if (value != null && value !== '') return value
  }
  return undefined
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === undefined) continue
    if (value === null) return null
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

export function isUsableNumericStat(value) {
  if (value == null || value === '') return false
  const n = Number(value)
  return Number.isFinite(n) && n !== 0
}

export function isUsableRecordString(record) {
  if (!record || typeof record !== 'string') return false
  return parseRecordString(record).games > 0
}

export function isWritableTeamStatValue(column, value) {
  if (value == null) return false
  if (column === 'last10Record' || column === 'homeRecord' || column === 'awayRecord') {
    return isUsableRecordString(value)
  }
  if (column === 'avgPointsLast10' || column === 'avgPointsAllowedLast10' || column === 'gamesPlayed') {
    return isUsableNumericStat(value)
  }
  return true
}

export function isNullTeamStats(team) {
  if (!team || typeof team !== 'object') return true
  const record = team.last10Record ?? team.homeRecord ?? team.awayRecord ?? team.seasonRecord
  const pointsFor = firstNumber(team.avgPointsLast10, team.seasonPointsFor)
  const pointsAgainst = firstNumber(team.avgPointsAllowedLast10, team.seasonPointsAllowed)
  return record == null && pointsFor == null && pointsAgainst == null
}

export function isAllZeroTeamStats(team) {
  if (!team || typeof team !== 'object') return false
  const records = [team.last10Record, team.homeRecord, team.awayRecord, team.seasonRecord]
    .filter((value) => value != null && value !== '')
  const pointsFor = firstNumber(team.avgPointsLast10, team.seasonPointsFor)
  const pointsAgainst = firstNumber(team.avgPointsAllowedLast10, team.seasonPointsAllowed)
  const hasUsableRecord = records.some((record) => isUsableRecordString(record))
  const hasUsablePoints = isUsableNumericStat(pointsFor) || isUsableNumericStat(pointsAgainst)
  if (hasUsableRecord || hasUsablePoints) return false
  return records.length > 0 || pointsFor != null || pointsAgainst != null
}

export function isSportInSeason(sport, now = new Date()) {
  const key = String(sport || '').toLowerCase()
  const months = TEAM_STATS_IN_SEASON_MONTHS[key]
  if (!months) return false
  const month = etCalendarMonth(now)
  return months.includes(month)
}

export function resolveTeamStatsTimestamp(team) {
  // Skip explicit nulls. ESPN full extracts omit statsDataThrough when
  // there is no last completed game, and the Team row stores that as null.
  // firstDefined() would stop on that null and ignore statsCapturedAt.
  const raw = firstPresent(
    team?.statsDataThrough,
    team?.dataThrough,
    team?.statsCapturedAt,
    team?.capturedAt,
    team?.updatedAt,
    team?.lastUpdated,
  )
  const ms = parseTimestampMs(raw)
  return ms != null ? new Date(ms).toISOString() : null
}

/**
 * Skip NHL/MLB edges when either side is missing, all-zero, or stale in-season.
 * Off-season rows with real last-season numbers are not rejected for age.
 */
export function evaluateTeamStatsForEdge(team, {
  now = new Date(),
  sport = null,
  side = 'team',
} = {}) {
  if (!team || typeof team !== 'object') {
    return { ok: false, reason: `${side}_${TEAM_STATS_SKIP_REASONS.MISSING_TEAM}` }
  }
  if (isNullTeamStats(team)) {
    return { ok: false, reason: `${side}_${TEAM_STATS_SKIP_REASONS.NULL_STATS}` }
  }
  if (isAllZeroTeamStats(team)) {
    return { ok: false, reason: `${side}_${TEAM_STATS_SKIP_REASONS.ALL_ZERO}` }
  }
  if (isSportInSeason(sport, now)) {
    const stamp = resolveTeamStatsTimestamp(team)
    const ms = parseTimestampMs(stamp)
    if (ms != null && (now.getTime() - ms) > TEAM_STATS_MAX_AGE_MS) {
      return { ok: false, reason: `${side}_${TEAM_STATS_SKIP_REASONS.STALE}` }
    }
  }
  return { ok: true, reason: null }
}

export function evaluateMatchupTeamStatsForEdge(home, away, options = {}) {
  const homeEval = evaluateTeamStatsForEdge(home, { ...options, side: 'home' })
  if (!homeEval.ok) return homeEval
  return evaluateTeamStatsForEdge(away, { ...options, side: 'away' })
}

/**
 * Game-line snapshots that were skipped or have no real edge must not
 * become Parlay Builder legs.
 */
export function isUsableGameLineEdgeSnapshot(edge) {
  if (!edge || edge.skipped === true) return false
  return [edge.edgeMlHome, edge.edgeMlAway, edge.edgeTotalO, edge.edgeTotalU]
    .some((value) => value != null && Number(value) !== 0)
}

export function shouldSkipParlayGameLines({ game, edge, now = new Date() } = {}) {
  if (!isUsableGameLineEdgeSnapshot(edge)) {
    return {
      skip: true,
      reason: edge?.skipReason || (edge ? 'no_edge' : 'no_edge_snapshot'),
    }
  }
  const stats = evaluateMatchupTeamStatsForEdge(game?.home, game?.away, {
    sport: game?.sport,
    now,
  })
  if (!stats.ok) return { skip: true, reason: stats.reason }
  return { skip: false, reason: null }
}

function etCalendarMonth(now) {
  const date = now instanceof Date ? now : new Date(now)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
  }).formatToParts(date)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  return Number.isFinite(month) ? month : date.getUTCMonth() + 1
}
