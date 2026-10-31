/**
 * Shared ESPN scoreboard helpers used by ingest and live mappers.
 * Canonical stored MLB codes live in team-mapping.js; this file only
 * parses competitors, scores, and vendor status tokens.
 */

import { isFinalStatus, isInProgressStatus, isLiveStatus, isPreStartStatus } from './game-status.js'

function isPreGameScoreStatus(status) {
  if (status == null || status === '') return false
  if (isFinalStatus(status)) return false
  if (isInProgressStatus(status)) return false
  if (isLiveStatus(status) && !isPreStartStatus(status)) return false
  return isPreStartStatus(status)
}

/**
 * Parse an ESPN score. A real 0 is kept for live/final (shutouts).
 * Pre-game placeholders stay null so scheduled games do not read 0-0.
 */
export function parseEspnScore(value, { status } = {}) {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? Number(value) : Number.parseInt(String(value), 10)
  if (!Number.isFinite(n)) return null
  if (n === 0 && isPreGameScoreStatus(status)) return null
  return n
}

export function espnHomeAwayCompetitors(competition) {
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : []
  const home = competitors.find((c) => c?.homeAway === 'home') || competitors[0] || null
  const away = competitors.find((c) => c?.homeAway === 'away') || competitors[1] || null
  return { home, away, competitors }
}

export function mapEspnTypeState(state) {
  const raw = String(state || '').toLowerCase().trim()
  if (raw === 'pre') return 'scheduled'
  if (raw === 'in') return 'in_progress'
  if (raw === 'post') return 'final'
  return null
}
