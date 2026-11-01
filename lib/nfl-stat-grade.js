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
import { teamSelectionMatches } from './team-mapping.js'

export const NFL_GRADE_SOURCES = Object.freeze({
  ESPN_BOX: 'espn-nfl-box',
  ESPN_ROSTER: 'espn-nfl-event-roster',
  ESPN_GAMELOG: 'espn-nfl-gamelog',
})

export const NFL_FETCH_ERROR = 'fetch_error'
export const NFL_MISSING_STAT_SETTLE_HOURS = 6
export const NFL_ESTIMATED_DURATION_MS = 4 * 60 * 60 * 1000

export const NFL_VOID_REASONS = Object.freeze({
  DNP_VERIFIED: 'dnp_verified',
  DNP_NO_SNAP: 'dnp_no_snap',
  NOT_ON_ROSTER: 'not_on_roster',
})

export const NFL_REVIEW_REASONS = Object.freeze({
  FETCH_ERROR: NFL_FETCH_ERROR,
  MISSING_ROSTER: 'missing_roster',
  NO_LOG_ENTRY: 'no_log_entry',
  PENDING_FINAL_WINDOW: 'pending_final_window',
  NOT_IN_BOX: 'not_in_box',
  TEAM_MISMATCH: 'team_mismatch',
  AMBIGUOUS: 'ambiguous',
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
export function matchNflRosterPlayer(entries, { name, team, playerId } = {}) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : []
  if (playerId != null && String(playerId).trim()) {
    const idHits = list.filter((entry) => String(entry.playerId || '') === String(playerId))
    if (idHits.length === 1) return { status: 'matched', player: idHits[0] }
    if (idHits.length > 1) return { status: 'ambiguous', player: null }
  }

  const target = normalizeGradePlayerName(name)
  if (!target || target.split(' ').length < 2) {
    return { status: 'unmatched', player: null }
  }

  const named = list.filter((entry) => looksLikeFullPlayerName(entry.fullName || entry.name || entry.displayName))
  const exact = named.filter((entry) => (
    nflNamesMatchExact(entry.fullName || entry.name || entry.displayName, name)
  ))

  const teamFiltered = filterRosterByTeam(exact, team)
  if (teamFiltered.status) return teamFiltered
  if (teamFiltered.hits.length === 1) return { status: 'matched', player: teamFiltered.hits[0] }
  if (teamFiltered.hits.length > 1) return { status: 'ambiguous', player: null }

  return { status: 'unmatched', player: null }
}

function filterRosterByTeam(hits, team) {
  if (!team || !hits.length) return { hits }
  const filtered = hits.filter((entry) => nflTeamsMatch(team, entry.teamAbbr || entry.team))
  if (hits.length > 0 && filtered.length === 0) {
    return { status: 'team_mismatch', player: null, hits: [] }
  }
  return { hits: filtered }
}

export function nflTeamsMatch(left, right) {
  return teamSelectionMatches(left, right)
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

export function parseEspnNflEventRoster(payload, { teamId, teamAbbr } = {}) {
  const entriesIn = payload?.entries || payload?.items || []
  if (!Array.isArray(entriesIn)) {
    return { ok: false, teamId: teamId ? String(teamId) : null, teamAbbr: teamAbbr || null, entries: [] }
  }
  const entries = entriesIn.map((entry) => parseRosterEntry(entry, { teamId, teamAbbr })).filter(Boolean)
  return {
    ok: true,
    teamId: teamId != null ? String(teamId) : teamIdFromPayload(payload),
    teamAbbr: teamAbbr || null,
    entries,
  }
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
export function planNflMissingStatFromSources({
  settleReady,
  rosterOk,
  rosterMatch,
  logFetched,
  logEntry,
  matchStatus,
} = {}) {
  if (!settleReady) {
    return { action: 'hold', reason: NFL_REVIEW_REASONS.PENDING_FINAL_WINDOW }
  }
  if (matchStatus === 'ambiguous') {
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.AMBIGUOUS }
  }
  if (matchStatus === 'team_mismatch') {
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.TEAM_MISMATCH }
  }
  if (!rosterOk) {
    return { action: 'needs_review', reason: NFL_REVIEW_REASONS.MISSING_ROSTER }
  }
  if (!rosterMatch) {
    return { action: 'void', reason: NFL_VOID_REASONS.NOT_ON_ROSTER }
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
