/**
 * NFL missing-from-box settlement: event roster first, game log second.
 *
 * ESPN box-score stat tables omit players with 0 in a category. A dressed
 * WR with 0 catches looks the same as an inactive. This module classifies
 * that miss from the per-event competitor roster (active / didNotPlay /
 * statistics) and, when snaps are still unknown, the athlete eventlog /
 * gamelog matched by eventId — never by date.
 *
 * Fail closed: a missing roster, no log entry, or a fetch error is
 * needs_review. Never a void and never a coerced 0.
 */

import { lastNameOfNormalized, normalizeGradePlayerName } from './player-name-match.js'
import { resolveNflTeamCode, teamSelectionMatches } from './team-mapping.js'

export const NFL_GRADE_SOURCES = Object.freeze({
  ESPN_BOX: 'espn-nfl-box',
  ESPN_ROSTER: 'espn-nfl-event-roster',
  ESPN_GAMELOG: 'espn-nfl-gamelog',
})

export const NFL_FETCH_ERROR = 'fetch_error'
export const NFL_MISSING_STAT_SETTLE_HOURS = 6
export const NFL_ESTIMATED_DURATION_MS = 4 * 60 * 60 * 1000
export const NFL_MIN_EVENT_ROSTER = 45
/**
 * ESPN competitor event rosters omit count/pageCount (confirmed live:
 * keys are $ref, competition, entries, team). Completeness then falls
 * back to NFL_MIN_EVENT_ROSTER. A truncated payload of 46+ still clears
 * that floor, so when count is missing we also reject a lopsided pair.
 */
export const NFL_ROSTER_PAIR_MIN_RATIO = 0.7

export const NFL_VOID_REASONS = Object.freeze({
  DNP_VERIFIED: 'dnp_verified',
  DNP_NO_SNAP: 'dnp_no_snap',
  NOT_ON_ROSTER: 'not_on_roster',
})

export const NFL_REVIEW_REASONS = Object.freeze({
  FETCH_ERROR: NFL_FETCH_ERROR,
  MISSING_ROSTER: 'missing_roster',
  MISSING_TEAM: 'missing_team',
  NO_LOG_ENTRY: 'no_log_entry',
  PENDING_FINAL_WINDOW: 'pending_final_window',
  NOT_IN_BOX: 'not_in_box',
  TEAM_MISMATCH: 'team_mismatch',
  AMBIGUOUS: 'ambiguous',
  UNVERIFIED_ID: 'unverified_id',
  ID_MISMATCH: 'id_mismatch',
  INCOMPLETE_ROSTER: 'incomplete_roster',
})

export function emptyNflStatResult(overrides = {}) {
  return {
    value: null,
    source: null,
    matchStatus: 'unmatched',
    statFound: false,
    gameFinal: false,
    didNotPlay: false,
    reason: null,
    team: null,
    player: null,
    ...overrides,
  }
}

export function nflFetchErrorResult(overrides = {}) {
  return emptyNflStatResult({
    source: overrides.source ?? null,
    status: overrides.status,
    statusText: overrides.statusText,
    matchStatus: NFL_FETCH_ERROR,
    reason: NFL_FETCH_ERROR,
    gameFinal: false,
    didNotPlay: false,
    statFound: false,
    value: null,
  })
}

export function isNflFetchError(result) {
  return Boolean(
    result
    && (result.reason === NFL_FETCH_ERROR || result.matchStatus === NFL_FETCH_ERROR),
  )
}

export function isGradeableNflStatResult(result) {
  if (!result) return false
  if (isNflFetchError(result)) return false
  if (result.didNotPlay) return false
  if (!result.gameFinal) return false
  if (result.matchStatus !== 'matched') return false
  if (!result.statFound) return false
  if (result.value === null || result.value === undefined) return false
  return true
}

export function nflNamesMatchExact(left, right) {
  const a = normalizeGradePlayerName(left)
  const b = normalizeGradePlayerName(right)
  if (!a || !b) return false
  if (a.split(' ').length < 2 || b.split(' ').length < 2) return false
  return a === b
}

export function looksLikeFullPlayerName(name) {
  return normalizeGradePlayerName(name).split(' ').filter(Boolean).length >= 2
}

/**
 * Roster / log name match: exact normalized full name only.
 * Suffixes and apostrophes are stripped by normalizeGradePlayerName.
 * No last-name-only matches and no substring matches.
 */
export function parseNumericEspnAthleteId(value) {
  const raw = String(value ?? '').trim()
  if (!/^\d+$/.test(raw)) return ''
  return raw
}

export function nflAthleteIdNameMatches(officialName, queryName) {
  return looksLikeFullPlayerName(officialName)
    && looksLikeFullPlayerName(queryName)
    && nflNamesMatchExact(officialName, queryName)
}

/**
 * Roster identity: unique exact normalized name across the (usually both)
 * event rosters. A numeric ESPN athlete id is only used when it resolves
 * to that same name. PropValidation has no playerId/team, so unique
 * name is the production identity source.
 */
export function matchNflRosterPlayer(entries, { name, team, playerId } = {}) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : []
  const verifiedId = parseNumericEspnAthleteId(playerId)

  if (verifiedId) {
    const idHits = dedupeRosterAthleteCandidates(
      list.filter((entry) => String(entry.playerId || '') === verifiedId),
    )
    if (idHits.length > 1) return { status: 'ambiguous', player: null }
    if (idHits.length === 1) {
      const hitName = idHits[0].fullName || idHits[0].name || idHits[0].displayName
      if (nflAthleteIdNameMatches(hitName, name)) {
        return finishRosterMatch(idHits, team)
      }
      if (looksLikeFullPlayerName(hitName) && looksLikeFullPlayerName(name)) {
        return { status: 'unverified_id', player: null }
      }
    }
  }

  const target = normalizeGradePlayerName(name)
  if (!target || target.split(' ').length < 2) {
    return { status: 'unmatched', player: null }
  }

  const named = list.filter((entry) => looksLikeFullPlayerName(entry.fullName || entry.name || entry.displayName))
  const exact = dedupeRosterAthleteCandidates(named.filter((entry) => (
    nflNamesMatchExact(entry.fullName || entry.name || entry.displayName, name)
  )))

  if (verifiedId && exact.length === 1 && String(exact[0].playerId || '') !== verifiedId) {
    return { status: 'id_mismatch', player: null }
  }

  return finishRosterMatch(exact, team)
}

function finishRosterMatch(hits, team) {
  const unique = dedupeRosterAthleteCandidates(hits)
  if (!hasNflPickTeam(team)) {
    if (unique.length === 1) return { status: 'matched', player: unique[0] }
    if (unique.length > 1) return { status: 'ambiguous', player: null }
    return { status: 'unmatched', player: null }
  }
  const teamFiltered = filterRosterByTeam(unique, team)
  if (teamFiltered.status) return teamFiltered
  if (teamFiltered.hits.length === 1) return { status: 'matched', player: teamFiltered.hits[0] }
  if (teamFiltered.hits.length > 1) return { status: 'ambiguous', player: null }
  return { status: 'unmatched', player: null }
}

/**
 * Optional team cross-check. A missing team does not fail closed —
 * unique name across both event rosters is the identity. When a team
 * is present, full names like "Kansas City Chiefs" normalize to KC.
 */
export function filterRosterByTeam(hits, team) {
  const list = Array.isArray(hits) ? hits : []
  if (!list.length) return { hits: list }
  if (!hasNflPickTeam(team)) return { hits: list }
  const filtered = list.filter((entry) => nflTeamsMatch(team, entry.teamAbbr || entry.team))
  if (filtered.length === 0) {
    return { status: 'team_mismatch', player: null, hits: [] }
  }
  return { hits: filtered }
}

export function nflTeamsMatch(left, right) {
  const a = resolveNflTeamCode(left)
  const b = resolveNflTeamCode(right)
  if (a && b && a === b) return true
  return teamSelectionMatches(a || left, b || right)
}

export function rosterLastNameCandidates(entries, queryName) {
  const targetLast = lastNameOfNormalized(normalizeGradePlayerName(queryName))
  if (!targetLast) return []
  return (entries || []).filter((entry) => {
    const raw = entry.fullName || entry.name || entry.displayName || ''
    const normalized = normalizeGradePlayerName(raw)
    if (!normalized) return false
    return lastNameOfNormalized(normalized) === targetLast
  })
}

export function dedupeRosterAthleteCandidates(entries) {
  const seen = new Set()
  const unique = []
  for (const entry of entries || []) {
    const id = entry?.playerId != null ? String(entry.playerId) : ''
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    unique.push(entry)
  }
  return unique
}

export function hasNflPickTeam(team) {
  return Boolean(team != null && String(team).trim())
}

export function nflGameTeamsFrom(game, explicit) {
  if (explicit && (explicit.home || explicit.away || explicit.homeAbbr || explicit.awayAbbr)) {
    return {
      home: explicit.home || explicit.homeAbbr || null,
      away: explicit.away || explicit.awayAbbr || null,
    }
  }
  if (!game) return null
  return {
    home: game.home?.abbr || game.homeAbbr || null,
    away: game.away?.abbr || game.awayAbbr || null,
  }
}

export function nflResolvedTeamOnGame(team, gameTeams) {
  if (!hasNflPickTeam(team) || !gameTeams) return true
  const home = gameTeams.home || gameTeams.homeAbbr
  const away = gameTeams.away || gameTeams.awayAbbr
  if (!hasNflPickTeam(home) && !hasNflPickTeam(away)) return true
  return nflTeamsMatch(team, home) || nflTeamsMatch(team, away)
}

export function athleteIdOnRoster(entries, athleteId) {
  const want = athleteId == null ? '' : String(athleteId).trim()
  if (!want) return false
  return (entries || []).some((entry) => String(entry?.playerId || '') === want)
}

export function parseEspnNflEventRoster(payload, { teamId, teamAbbr } = {}) {
  const entriesIn = payload?.entries || payload?.items || []
  if (!Array.isArray(entriesIn)) {
    return { ok: false, teamId: teamId ? String(teamId) : null, teamAbbr: teamAbbr || null, entries: [] }
  }
  const entries = entriesIn.map((entry) => parseRosterEntry(entry, { teamId, teamAbbr })).filter(Boolean)
  const count = Number(payload?.count)
  const pageCount = Number(payload?.pageCount)
  const pageSize = Number(payload?.pageSize)
  return {
    ok: true,
    teamId: teamId != null ? String(teamId) : teamIdFromPayload(payload),
    teamAbbr: teamAbbr || null,
    entries,
    count: Number.isFinite(count) && count > 0 ? count : null,
    pageCount: Number.isFinite(pageCount) && pageCount > 0 ? pageCount : null,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : null,
  }
}

export function isNflEventRosterComplete(parsed) {
  if (!parsed?.ok) return false
  const entries = parsed.entries || []
  const n = entries.length
  if (n < NFL_MIN_EVENT_ROSTER) return false
  // ESPN count is usually absent on this endpoint; when present it must match.
  if (parsed.count != null && n < parsed.count) return false
  if (parsed.pageCount != null && parsed.pageCount > 1 && (parsed.count == null || n < parsed.count)) {
    return false
  }
  return true
}

export function bothNflEventRostersComplete(homeParsed, awayParsed) {
  if (!isNflEventRosterComplete(homeParsed) || !isNflEventRosterComplete(awayParsed)) return false
  const homeN = (homeParsed.entries || []).length
  const awayN = (awayParsed.entries || []).length
  if (homeParsed.count != null && awayParsed.count != null) return true
  const larger = Math.max(homeN, awayN)
  const smaller = Math.min(homeN, awayN)
  return larger === 0 || smaller / larger >= NFL_ROSTER_PAIR_MIN_RATIO
}

function teamIdFromPayload(payload) {
  const ref = payload?.team?.$ref || payload?.$ref || ''
  const match = String(ref).match(/\/competitors\/(\d+)/) || String(ref).match(/\/teams\/(\d+)/)
  return match ? match[1] : null
}

function parseRosterEntry(entry, { teamId, teamAbbr } = {}) {
  if (!entry || typeof entry !== 'object') return null
  const athlete = entry.athlete && typeof entry.athlete === 'object' ? entry.athlete : {}
  const fullName = athlete.fullName || athlete.displayName || entry.fullName || null
  const displayName = entry.displayName || athlete.displayName || athlete.shortName || null
  const playerId = entry.playerId != null
    ? String(entry.playerId)
    : athlete.id != null ? String(athlete.id) : null
  const statistics = entry.statistics
  const hasStatistics = Boolean(
    statistics
    && (typeof statistics === 'object')
    && (statistics.$ref || statistics.splits || statistics.categories),
  )
  return {
    playerId,
    displayName,
    fullName,
    name: fullName || (looksLikeFullPlayerName(displayName) ? displayName : null),
    active: entry.active === true,
    didNotPlay: entry.didNotPlay === true,
    starter: entry.starter === true,
    valid: entry.valid,
    hasStatistics,
    athleteRef: athlete.$ref || null,
    statisticsRef: statistics?.$ref || null,
    teamId: teamId != null ? String(teamId) : null,
    teamAbbr: teamAbbr || null,
  }
}

export function classifyNflRosterAppearance(entry) {
  if (!entry) return { status: 'absent' }
  if (entry.didNotPlay === true) {
    return { status: 'dnp', reason: NFL_VOID_REASONS.DNP_VERIFIED }
  }
  if (entry.active === true || entry.hasStatistics) {
    return { status: 'played', reason: 'appeared' }
  }
  return { status: 'dressed_unknown_snaps' }
}

export function espnRefEventId(ref) {
  const match = String(ref || '').match(/\/events\/(\d+)/)
  return match ? match[1] : null
}

export function matchEventLogByEventId(items, eventId) {
  const want = String(eventId || '').trim()
  if (!want) return null
  for (const item of items || []) {
    if (!item) continue
    const fromRef = espnRefEventId(item.event?.$ref || item.$ref)
    const id = item.eventId != null ? String(item.eventId) : item.id != null ? String(item.id) : null
    if (fromRef === want || id === want) return item
  }
  return null
}

export function matchGameLogByEventId(events, eventId) {
  const want = String(eventId || '').trim()
  if (!want || !events) return null
  if (typeof events === 'object' && !Array.isArray(events) && events[want]) {
    return { id: want, ...events[want], present: true }
  }
  if (Array.isArray(events)) {
    const hit = events.find((row) => String(row?.id || row?.eventId || '') === want)
    return hit ? { ...hit, present: true } : null
  }
  return null
}

export function classifyNflGameLogAppearance(logEntry) {
  if (!logEntry) return { status: 'missing', reason: NFL_REVIEW_REASONS.NO_LOG_ENTRY }
  if (logEntry.played === true) return { status: 'played', reason: 'appeared' }
  const snaps = firstDefined(
    logEntry.snaps,
    logEntry.offensiveSnaps,
    logEntry.defensiveSnaps,
    logEntry.specialTeamsSnaps,
  )
  if (Number(snaps) > 0) return { status: 'played', reason: 'appeared' }
  if (logEntry.played === false) return { status: 'no_snap', reason: NFL_VOID_REASONS.DNP_NO_SNAP }
  if (snaps === 0 || snaps === '0') return { status: 'no_snap', reason: NFL_VOID_REASONS.DNP_NO_SNAP }
  if (logEntry.present === true) return { status: 'played', reason: 'appeared' }
  return { status: 'missing', reason: NFL_REVIEW_REASONS.NO_LOG_ENTRY }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null)
}

export function nflEventKickoffAt(payload, game) {
  const raw = (
    payload?.header?.competitions?.[0]?.date
    || payload?.competitions?.[0]?.date
    || payload?.date
    || game?.date
    || null
  )
  if (!raw) return null
  const date = raw instanceof Date ? raw : new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

export function nflEventFinalAt(payload, game) {
  const explicit = (
    payload?.header?.competitions?.[0]?.endDate
    || payload?.competitions?.[0]?.endDate
    || payload?.endDate
    || null
  )
  if (explicit) {
    const date = new Date(explicit)
    if (!Number.isNaN(date.getTime())) return date
  }
  const kickoff = nflEventKickoffAt(payload, game)
  if (!kickoff) return null
  return new Date(kickoff.getTime() + NFL_ESTIMATED_DURATION_MS)
}

export function isNflMissingStatSettleReady(finalAt, now = new Date()) {
  if (!finalAt) return false
  const stamp = finalAt instanceof Date ? finalAt : new Date(finalAt)
  if (Number.isNaN(stamp.getTime())) return false
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime()
  return nowMs - stamp.getTime() >= NFL_MISSING_STAT_SETTLE_HOURS * 60 * 60 * 1000
}

export function warnNflMissingKickoff(eventId, payload, game, log = console) {
  if (nflEventKickoffAt(payload, game)) return false
  const where = eventId ? ` event=${eventId}` : ''
  log.warn?.(`⚠️ NFL missing-stat 6h wait blocked: no kickoff time${where}`)
  return true
}

export function describeNflEspnBox(data) {
  const competition = data?.header?.competitions?.[0] || data?.competitions?.[0] || {}
  const competitors = competition.competitors || []
  const home = competitors.find((row) => row.homeAway === 'home') || competitors[0]
  const away = competitors.find((row) => row.homeAway === 'away') || competitors[1]
  const names = []
  const counts = new Map()
  for (const block of data?.boxscore?.players || []) {
    const abbr = String(block?.team?.abbreviation || '').toUpperCase()
    let count = 0
    for (const category of block.statistics || []) {
      for (const row of category.athletes || []) {
        const name = row.athlete?.displayName || row.athlete?.fullName
        if (!name) continue
        names.push(name)
        count += 1
      }
    }
    if (abbr) counts.set(abbr, (counts.get(abbr) || 0) + count)
  }
  const homeAbbr = String(home?.team?.abbreviation || home?.abbreviation || '').toUpperCase()
  const awayAbbr = String(away?.team?.abbreviation || away?.abbreviation || '').toUpperCase()
  return {
    homeAbbr,
    awayAbbr,
    homeRosterCount: counts.get(homeAbbr) || 0,
    awayRosterCount: counts.get(awayAbbr) || 0,
    playerNames: names,
    homeTeamId: home?.id != null ? String(home.id) : home?.team?.id != null ? String(home.team.id) : null,
    awayTeamId: away?.id != null ? String(away.id) : away?.team?.id != null ? String(away.team.id) : null,
  }
}

/**
 * Decide the missing-stat outcome from already-fetched roster / log data.
 * Fetch errors and incomplete sources must be passed in; this never guesses.
 */
export function canProveNflNotOnRoster({
  matchStatus,
  athleteId,
  athleteIdVerified,
  bothRostersComplete,
  athleteOnEitherRoster,
} = {}) {
  const id = parseNumericEspnAthleteId(athleteId)
  if (!id || athleteIdVerified !== true || !bothRostersComplete) return false
  if (athleteOnEitherRoster === false) return true
  return matchStatus === 'team_mismatch'
}

export function planNflMissingStatFromSources({
  settleReady,
  rosterOk,
  rosterMatch,
  logFetched,
  logEntry,
  matchStatus,
  athleteId,
  athleteIdVerified,
  bothRostersComplete,
  athleteOnEitherRoster,
} = {}) {
  if (!settleReady) {
    return { action: 'hold', reason: NFL_REVIEW_REASONS.PENDING_FINAL_WINDOW }
  }
  if (matchStatus === 'ambiguous') {
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.AMBIGUOUS }
  }
  if (matchStatus === 'unverified_id') {
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.UNVERIFIED_ID }
  }
  if (matchStatus === 'id_mismatch') {
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.ID_MISMATCH }
  }
  if (matchStatus === 'missing_team') {
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.MISSING_TEAM }
  }
  if (matchStatus === 'team_mismatch') {
    if (canProveNflNotOnRoster({
      matchStatus,
      athleteId,
      athleteIdVerified,
      bothRostersComplete,
      athleteOnEitherRoster,
    })) {
      return { action: 'void', reason: NFL_VOID_REASONS.NOT_ON_ROSTER }
    }
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.TEAM_MISMATCH }
  }
  if (!rosterOk) {
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.MISSING_ROSTER }
  }
  if (rosterMatch && bothRostersComplete !== true) {
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.INCOMPLETE_ROSTER }
  }
  if (!rosterMatch) {
    if (canProveNflNotOnRoster({
      matchStatus,
      athleteId,
      athleteIdVerified,
      bothRostersComplete,
      athleteOnEitherRoster,
    })) {
      return { action: 'void', reason: NFL_VOID_REASONS.NOT_ON_ROSTER }
    }
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.NOT_IN_BOX }
  }

  const appearance = classifyNflRosterAppearance(rosterMatch)
  if (appearance.status === 'dnp') {
    return { action: 'void', reason: NFL_VOID_REASONS.DNP_VERIFIED }
  }
  if (appearance.status === 'played') {
    return { action: 'grade', reason: 'appeared', actualValue: 0 }
  }

  if (!logFetched) {
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.NO_LOG_ENTRY }
  }
  const log = classifyNflGameLogAppearance(logEntry)
  if (log.status === 'played') {
    return { action: 'grade', reason: 'appeared', actualValue: 0 }
  }
  if (log.status === 'no_snap') {
    return { action: 'void', reason: NFL_VOID_REASONS.DNP_NO_SNAP }
  }
  return { action: 'needs_review', reason: NFL_REVIEW_REASONS.NO_LOG_ENTRY }
}

export function nflLookupFromMissingPlan(plan, extras = {}) {
  if (!plan) return emptyNflStatResult({ reason: NFL_REVIEW_REASONS.NOT_IN_BOX, ...extras })
  if (plan.action === 'hold') {
    return emptyNflStatResult({
      reason: plan.reason,
      matchStatus: 'n/a',
      gameFinal: false,
      ...extras,
    })
  }
  if (plan.action === 'void') {
    return emptyNflStatResult({
      reason: plan.reason,
      matchStatus: plan.reason === NFL_VOID_REASONS.NOT_ON_ROSTER ? 'not_on_roster' : 'matched',
      didNotPlay: true,
      gameFinal: true,
      ...extras,
    })
  }
  if (plan.action === 'grade') {
    return {
      value: plan.actualValue ?? 0,
      source: extras.source || NFL_GRADE_SOURCES.ESPN_ROSTER,
      matchStatus: 'matched',
      statFound: true,
      gameFinal: true,
      didNotPlay: false,
      reason: 'appeared',
      team: extras.team || null,
      player: extras.player || null,
      ...extras,
    }
  }
  return emptyNflStatResult({
    reason: plan.reason || NFL_REVIEW_REASONS.NOT_IN_BOX,
    matchStatus: plan.reason === NFL_FETCH_ERROR ? NFL_FETCH_ERROR : 'unmatched',
    gameFinal: extras.gameFinal ?? true,
    ...extras,
  })
}
