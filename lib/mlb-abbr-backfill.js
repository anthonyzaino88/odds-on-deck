/**
 * Read-only helpers for leftover OAK/CWS MLB codes.
 *
 * Stored codes are ESPN-canonical ATH/CHW. Historical Team.abbr and
 * Game.id rows may still use OAK/CWS. This module only counts and
 * remaps strings in memory. Writers live in docs/mlb-ath-chw-backfill.md
 * and run only with Anthony's OK.
 */

export const LEGACY_TO_CANONICAL_MLB_ABBR = Object.freeze({
  OAK: 'ATH',
  CWS: 'CHW',
})

const RAW_GAME_ID = /^([A-Za-z0-9]+)_at_([A-Za-z0-9]+)_(\d{4}-\d{2}-\d{2})(?:_(.+))?$/

export function isLegacyMlbTeamAbbr(abbr) {
  return Boolean(LEGACY_TO_CANONICAL_MLB_ABBR[String(abbr || '').toUpperCase().trim()])
}

export function canonicalMlbTeamAbbr(abbr) {
  const raw = String(abbr || '').toUpperCase().trim()
  return LEGACY_TO_CANONICAL_MLB_ABBR[raw] || raw || null
}

/** Raw Game.id parts — does not canonicalize OAK/CWS the way parseGameIdParts does. */
export function parseRawGameIdTeamCodes(id) {
  const match = String(id || '').trim().match(RAW_GAME_ID)
  if (!match) return null
  return {
    awayAbbr: match[1].toUpperCase(),
    homeAbbr: match[2].toUpperCase(),
    date: match[3],
    suffix: match[4] || null,
  }
}

export function gameIdHasLegacyMlbAbbr(id) {
  const parts = parseRawGameIdTeamCodes(id)
  if (!parts) return false
  return isLegacyMlbTeamAbbr(parts.awayAbbr) || isLegacyMlbTeamAbbr(parts.homeAbbr)
}

export function remapLegacyMlbGameId(id) {
  const parts = parseRawGameIdTeamCodes(id)
  if (!parts) return id
  const away = canonicalMlbTeamAbbr(parts.awayAbbr)
  const home = canonicalMlbTeamAbbr(parts.homeAbbr)
  if (away === parts.awayAbbr && home === parts.homeAbbr) return id
  return `${away}_at_${home}_${parts.date}${parts.suffix ? `_${parts.suffix}` : ''}`
}

export function summarizeLegacyMlbAbbrRows({ teams = [], games = [] } = {}) {
  const teamRows = (teams || []).filter((team) => (
    String(team?.sport || 'mlb').toLowerCase() === 'mlb'
    && isLegacyMlbTeamAbbr(team?.abbr)
  ))
  const gameRows = (games || []).filter((game) => (
    String(game?.sport || 'mlb').toLowerCase() === 'mlb'
    && gameIdHasLegacyMlbAbbr(game?.id)
  ))
  return {
    teamCount: teamRows.length,
    gameCount: gameRows.length,
    teams: teamRows.map((team) => ({
      id: team.id,
      abbr: team.abbr,
      nextAbbr: canonicalMlbTeamAbbr(team.abbr),
      name: team.name || null,
    })),
    games: gameRows.map((game) => ({
      id: game.id,
      nextId: remapLegacyMlbGameId(game.id),
    })),
  }
}
