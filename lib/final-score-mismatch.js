/**
 * Read-only final-score integrity check.
 *
 * Flags Game rows stored as final whose home/away scores disagree with
 * the source box (ESPN summary via the sport mapper). Does not write.
 */

import { isFinalStatus } from './game-status.js'
import { resolveSportTeamCode } from './team-mapping.js'

export const FINAL_SCORE_MISMATCH_REASONS = Object.freeze({
  SOURCE_MISSING: 'source_missing',
  SOURCE_NOT_FINAL: 'source_not_final',
  SCORE_DISAGREE: 'score_disagree',
  TEAM_DISAGREE: 'team_disagree',
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
      || null
    const flag = flagFinalScoreMismatch(row, source, { sport: sport || row.sport })
    if (flag) flags.push(flag)
  }
  return flags
}

export function formatFinalScoreMismatchLine(flag) {
  const stored = flag.stored || {}
  const source = flag.source || {}
  return [
    flag.reason,
    flag.gameId || 'unknown',
    `${stored.awayAbbr || '?'}@${stored.homeAbbr || '?'}`,
    `stored=${stored.awayScore ?? '?'}-${stored.homeScore ?? '?'}`,
    `source=${source.awayScore ?? '?'}-${source.homeScore ?? '?'}`,
  ].join(' ')
}
