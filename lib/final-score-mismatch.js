/**
 * Read-only final-score integrity check.
 *
 * Flags Game rows stored as final whose home/away scores disagree with
 * the source box (ESPN summary, or MLB StatsAPI schedule+linescore).
 * Does not write. Does not call The Odds API.
 */

import { parseEspnScore } from './espn-scoreboard.js'
import { isFinalStatus } from './game-status.js'
import { resolveMlbLinescoreStatus } from './mlb-live-status.js'
import { resolveSportTeamCode } from './team-mapping.js'
import {
  buildHydratedScheduleUrl,
  extractLinescorePayloadFromScheduleGame,
  pickScheduleGameForPk,
} from './vendors/stats.js'

export const FINAL_SCORE_MISMATCH_REASONS = Object.freeze({
  SOURCE_MISSING: 'source_missing',
  SOURCE_NOT_FINAL: 'source_not_final',
  SCORE_DISAGREE: 'score_disagree',
  TEAM_DISAGREE: 'team_disagree',
})

export const REPORT_FINAL_SCORE_SPORTS = Object.freeze(['mlb', 'nfl', 'nhl'])
export const DEFAULT_SOURCE_FETCH_GAP_MS = 200
/** Max final Game rows loaded per sport. `--sport all` can scan 600. */
export const DEFAULT_SCAN_LIMIT_PER_SPORT = 200

export const ESPN_SUMMARY_URLS = Object.freeze({
  mlb: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary',
  nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary',
  nhl: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary',
})

export function parseReportFinalScoreArgs(argv = []) {
  const out = {
    sport: 'nhl',
    gameId: null,
    days: 14,
    json: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--json') out.json = true
    else if (arg === '--sport') out.sport = String(argv[++i] || 'nhl').toLowerCase()
    else if (arg === '--gameId' || arg === '--game-id') out.gameId = String(argv[++i] || '').trim() || null
    else if (arg === '--days') {
      const n = Number(argv[++i])
      if (Number.isFinite(n) && n > 0) out.days = Math.floor(n)
    }
  }
  return out
}

export function resolveReportSports(sport) {
  const key = String(sport == null || sport === '' ? 'nhl' : sport).toLowerCase()
  if (key === 'all') return [...REPORT_FINAL_SCORE_SPORTS]
  if (REPORT_FINAL_SCORE_SPORTS.includes(key)) return [key]
  return null
}

export function espnSummaryUrl(sport, espnGameId) {
  const base = ESPN_SUMMARY_URLS[String(sport || '').toLowerCase()]
  if (!base || espnGameId == null || espnGameId === '') return null
  return `${base}?event=${encodeURIComponent(String(espnGameId))}`
}

export function numericScore(value) {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isFinite(n) ? n : null
}

function sameTeam(sport, left, right) {
  if (!left || !right) return true
  const a = resolveSportTeamCode(sport, left)
  const b = resolveSportTeamCode(sport, right)
  if (!a || !b) return String(left).toUpperCase() === String(right).toUpperCase()
  return a === b
}

function competitorAbbr(competitor) {
  return competitor?.team?.abbreviation || competitor?.abbreviation || null
}

export function mapEspnHeaderStatus(status) {
  const typeName = String(status?.type?.name || '').toUpperCase()
  const typeId = status?.type?.id?.toString()
  const state = String(status?.type?.state || '').toLowerCase()
  const detail = String(status?.type?.detail || '').toLowerCase()
  if (typeName.includes('HALFTIME') || detail.includes('halftime')) return 'halftime'
  if (typeName.includes('FINAL') || typeId === '3' || state === 'post') return 'final'
  if (typeName.includes('SUSPEND') || detail.includes('suspend')) return 'suspended'
  if (typeName.includes('DELAY') || detail.includes('delay')) return 'delayed'
  if (typeName.includes('IN_PROGRESS') || typeId === '2' || state === 'in') return 'in_progress'
  if (typeName.includes('POSTPONE') || detail.includes('postpone')) return 'postponed'
  if (typeName.includes('CANCEL') || detail.includes('cancel')) return 'cancelled'
  if (state === 'pre' || typeId === '1') return 'scheduled'
  return 'scheduled'
}

/** ESPN site-v2 summary / header box for MLB, NFL, or NHL. */
export function mapEspnSummaryBox(data) {
  const header = data?.header
  const competition = header?.competitions?.[0]
  if (!competition) return null
  const home = competition.competitors?.find((c) => c?.homeAway === 'home')
  const away = competition.competitors?.find((c) => c?.homeAway === 'away')
  const mappedStatus = mapEspnHeaderStatus(competition.status)
  return {
    espnGameId: header.id != null ? String(header.id) : null,
    status: mappedStatus,
    homeScore: parseEspnScore(home?.score, { status: mappedStatus }),
    awayScore: parseEspnScore(away?.score, { status: mappedStatus }),
    homeAbbr: competitorAbbr(home),
    awayAbbr: competitorAbbr(away),
  }
}

/** MLB StatsAPI schedule?hydrate=linescore game. */
export function mapMlbScheduleFinalBox(game) {
  if (!game) return null
  const payload = extractLinescorePayloadFromScheduleGame(game)
  const status = resolveMlbLinescoreStatus(payload)
  const homeAbbr = game.teams?.home?.team?.abbreviation
    || game.teams?.home?.team?.teamCode
    || null
  const awayAbbr = game.teams?.away?.team?.abbreviation
    || game.teams?.away?.team?.teamCode
    || null
  return {
    status,
    homeScore: numericScore(payload?.teams?.home?.runs ?? game.teams?.home?.score),
    awayScore: numericScore(payload?.teams?.away?.runs ?? game.teams?.away?.score),
    homeAbbr: homeAbbr ? String(homeAbbr).toUpperCase() : null,
    awayAbbr: awayAbbr ? String(awayAbbr).toUpperCase() : null,
    mlbGameId: game.gamePk != null ? String(game.gamePk) : null,
  }
}

export async function fetchJson(url, fetchImpl = fetch) {
  if (!url) return null
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'OddsOnDeck/1.0' } })
  if (!res?.ok) return null
  return res.json()
}

export function sleep(ms, wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay))) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return Promise.resolve()
  return wait(n)
}

export function isUsableSourceFinalBox(box) {
  if (!box) return false
  if (!isFinalStatus(box.status)) return false
  return numericScore(box.homeScore) != null && numericScore(box.awayScore) != null
}

/**
 * Load the source box for one stored Game. MLB prefers StatsAPI by
 * mlbGameId, then ESPN summary. A non-final or null-score StatsAPI
 * box falls through to ESPN. NFL/NHL use ESPN summary.
 */
export async function loadSourceFinalBox(row, { fetchJson: fetchJsonImpl = fetchJson } = {}) {
  const sport = String(row?.sport || '').toLowerCase()
  if (sport === 'mlb' && row?.mlbGameId) {
    try {
      const data = await fetchJsonImpl(buildHydratedScheduleUrl({ gamePk: row.mlbGameId }))
      const mapped = mapMlbScheduleFinalBox(pickScheduleGameForPk(data, row.mlbGameId))
      if (isUsableSourceFinalBox(mapped)) return mapped
    } catch {
      // ESPN fallback below
    }
  }
  const url = espnSummaryUrl(sport, row?.espnGameId)
  if (!url) return null
  try {
    return mapEspnSummaryBox(await fetchJsonImpl(url))
  } catch {
    return null
  }
}

/**
 * Compare one stored Game (must already be final) against a source
 * snapshot. Returns a flag object or null when scores agree.
 */
export function flagFinalScoreMismatch(stored, source, { sport } = {}) {
  if (!stored || !isFinalStatus(stored.status)) return null
  const resolvedSport = String(sport || stored.sport || '').toLowerCase()
  if (!source) {
    return {
      reason: FINAL_SCORE_MISMATCH_REASONS.SOURCE_MISSING,
      gameId: stored.id || null,
      sport: resolvedSport,
      stored: snapshotScores(stored),
      source: null,
    }
  }
  if (!isFinalStatus(source.status)) {
    return {
      reason: FINAL_SCORE_MISMATCH_REASONS.SOURCE_NOT_FINAL,
      gameId: stored.id || null,
      sport: resolvedSport,
      stored: snapshotScores(stored),
      source: snapshotScores(source),
    }
  }

  const storedHome = numericScore(stored.homeScore)
  const storedAway = numericScore(stored.awayScore)
  const sourceHome = numericScore(source.homeScore)
  const sourceAway = numericScore(source.awayScore)
  const teamsOk = sameTeam(resolvedSport, stored.homeAbbr, source.homeAbbr)
    && sameTeam(resolvedSport, stored.awayAbbr, source.awayAbbr)

  if (!teamsOk) {
    return {
      reason: FINAL_SCORE_MISMATCH_REASONS.TEAM_DISAGREE,
      gameId: stored.id || null,
      sport: resolvedSport,
      stored: snapshotScores(stored),
      source: snapshotScores(source),
    }
  }

  if (storedHome !== sourceHome || storedAway !== sourceAway) {
    return {
      reason: FINAL_SCORE_MISMATCH_REASONS.SCORE_DISAGREE,
      gameId: stored.id || null,
      sport: resolvedSport,
      stored: snapshotScores(stored),
      source: snapshotScores(source),
    }
  }
  return null
}

function snapshotScores(row) {
  if (!row) return null
  return {
    status: row.status || null,
    homeScore: numericScore(row.homeScore),
    awayScore: numericScore(row.awayScore),
    homeAbbr: row.homeAbbr || null,
    awayAbbr: row.awayAbbr || null,
  }
}

export function collectFinalScoreMismatches(storedRows, sourceByKey, { sport } = {}) {
  const flags = []
  for (const row of storedRows || []) {
    if (!isFinalStatus(row?.status)) continue
    const source = sourceByKey?.get(row.id)
      || sourceByKey?.get(row.espnGameId)
      || sourceByKey?.get(String(row.espnGameId || ''))
      || sourceByKey?.get(row.mlbGameId)
      || sourceByKey?.get(String(row.mlbGameId || ''))
      || null
    const rowSport = String(row.sport || '').toLowerCase()
    const flagSport = REPORT_FINAL_SCORE_SPORTS.includes(rowSport)
      ? rowSport
      : (sport && sport !== 'all' ? sport : rowSport)
    const flag = flagFinalScoreMismatch(row, source, { sport: flagSport })
    if (flag) flags.push(flag)
  }
  return flags
}

export function formatFinalScoreMismatchLine(flag) {
  const stored = flag.stored || {}
  const source = flag.source || {}
  return [
    flag.reason,
    flag.sport || '',
    flag.gameId || 'unknown',
    `${stored.awayAbbr || '?'}@${stored.homeAbbr || '?'}`,
    `stored=${stored.awayScore ?? '?'}-${stored.homeScore ?? '?'}`,
    `source=${source.awayScore ?? '?'}-${source.homeScore ?? '?'}`,
  ].filter((part) => part !== '').join(' ')
}
