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
    statsKind: overrides.statsKind || team?.statsKind || 'season',
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
 * Extract ESPN team payload into present Team columns only.
 * Omitted fields are absent (not null) so a partial response cannot
 * clear existing records or scoring averages.
 */
export function extractEspnTeamPerformance(data, sport, { extractedAt = new Date() } = {}) {
  const team = data?.team
  if (!team) return null

  const performanceData = {}
  let gamesPlayed = null
  let season = null

  if (team.record?.items) {
    const overallRecord = team.record.items.find((item) => item.type === 'total' || item.type === 'overall')
    const homeRecord = team.record.items.find((item) => item.type === 'home')
    const awayRecord = team.record.items.find((item) => item.type === 'road' || item.type === 'away')

    if (overallRecord?.summary) {
      // Season record stored in a last10-named column (legacy schema).
      performanceData.last10Record = overallRecord.summary
    }
    if (homeRecord?.summary) performanceData.homeRecord = homeRecord.summary
    if (awayRecord?.summary) performanceData.awayRecord = awayRecord.summary

    let totalFor = null
    let totalAgainst = null

    if (overallRecord?.stats) {
      for (const stat of overallRecord.stats) {
        const name = stat.name || ''
        const value = parseFloat(stat.value)

        if (name === 'avgPointsFor' || name === 'ppg') {
          if (Number.isFinite(value)) performanceData.avgPointsLast10 = value
        } else if (name === 'pointsFor' || name === 'points') {
          totalFor = value
        }

        if (name === 'avgPointsAgainst' || name === 'oppPpg') {
          if (Number.isFinite(value)) performanceData.avgPointsAllowedLast10 = value
        } else if (name === 'pointsAgainst' || name === 'pointsAllowed') {
          totalAgainst = value
        }

        if (name === 'gamesPlayed' || name === 'playedGames') gamesPlayed = value
      }
    }

    if (gamesPlayed && gamesPlayed > 0) {
      if (performanceData.avgPointsLast10 == null && totalFor != null) {
        performanceData.avgPointsLast10 = totalFor / gamesPlayed
      }
      if (performanceData.avgPointsAllowedLast10 == null && totalAgainst != null) {
        performanceData.avgPointsAllowedLast10 = totalAgainst / gamesPlayed
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
        if (Number.isFinite(value)) performanceData.avgPointsLast10 = value
      }
      if (stat.name === 'avgPointsAgainst' || stat.name === 'pointsAllowedPerGame') {
        const value = parseFloat(stat.value)
        if (Number.isFinite(value)) performanceData.avgPointsAllowedLast10 = value
      }
    }
  }

  if (team.season && typeof team.season === 'object' && team.season.year) {
    season = String(team.season.year)
  } else if (typeof team.season === 'number' || typeof team.season === 'string') {
    season = String(team.season)
  }

  const presentFields = TEAM_PERFORMANCE_COLUMNS.filter((column) => (
    Object.prototype.hasOwnProperty.call(performanceData, column)
    && performanceData[column] != null
  ))
  if (presentFields.length === 0) return null

  const omittedFields = TEAM_PERFORMANCE_COLUMNS.filter((column) => !presentFields.includes(column))

  return {
    ...pickPresent(performanceData, presentFields),
    meta: {
      statsKind: 'season',
      sport,
      gamesPlayed: gamesPlayed != null ? Number(gamesPlayed) : parseRecordString(performanceData.last10Record).games || null,
      season,
      extractedAt: extractedAt instanceof Date ? extractedAt.toISOString() : String(extractedAt),
      last10FieldsAreSeasonAverages: true,
      presentFields,
      omittedFields,
      partial: omittedFields.length > 0,
    },
  }
}

/**
 * Build a Team.update() payload from an extract.
 * Absent / null extract fields are omitted so existing DB values stay.
 * Pass `invalidate` to clear specific columns on purpose — that is not
 * a freshness refresh of the remaining fields.
 */
export function teamPerformanceWritePayload(extracted, { invalidate = [] } = {}) {
  const payload = {}
  const written = []
  const retained = []
  const invalidated = []
  const invalidateSet = new Set(invalidate)

  for (const column of TEAM_PERFORMANCE_COLUMNS) {
    if (invalidateSet.has(column)) {
      payload[column] = null
      invalidated.push(column)
      continue
    }
    if (
      extracted
      && Object.prototype.hasOwnProperty.call(extracted, column)
      && extracted[column] != null
    ) {
      payload[column] = extracted[column]
      written.push(column)
      continue
    }
    retained.push(column)
  }

  return {
    payload,
    written,
    retained,
    invalidated,
    representsFullRefresh: invalidated.length === 0 && retained.length === 0,
    retainedFieldsNotFresh: retained,
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
    freshness: {
      extractedAt: extracted?.meta?.extractedAt || null,
      updatedFields: write.written,
      retainedFieldsNotFresh: write.retained,
      invalidatedFields: write.invalidated,
    },
  }
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

function firstNumber(...values) {
  for (const value of values) {
    if (value === undefined) continue
    if (value === null) return null
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}
