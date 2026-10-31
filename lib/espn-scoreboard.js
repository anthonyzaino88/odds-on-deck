/**
 * Shared ESPN scoreboard helpers used by ingest and live mappers.
 * Canonical stored MLB codes live in team-mapping.js; this file only
 * parses competitors, scores, and vendor status tokens.
 */

export function parseEspnScore(value) {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? Number(value) : Number.parseInt(String(value), 10)
  return Number.isFinite(n) ? n : null
}

export function espnHomeAwayCompetitors(competition) {
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : []
  const home = competitors.find((c) => c?.homeAway === 'home') || null
  const away = competitors.find((c) => c?.homeAway === 'away') || null
  return { home, away, competitors }
}

export function mapEspnTypeState(state) {
  const raw = String(state || '').toLowerCase().trim()
  if (raw === 'pre') return 'scheduled'
  if (raw === 'in') return 'in_progress'
  if (raw === 'post') return 'final'
  return null
}
