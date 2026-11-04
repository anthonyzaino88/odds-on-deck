/**
 * Parse ESPN public injury JSON (site.api.espn.com).
 * NFL: /sports/football/nfl/injuries
 * NHL: /sports/hockey/nhl/injuries
 * No Odds API. No secrets.
 */

import { normalizeGradePlayerName } from './player-name-match.js'
import { resolveSportTeamCode } from './team-mapping.js'

export const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports'
export const ESPN_NFL_INJURIES_URL = `${ESPN_SITE}/football/nfl/injuries`
export const ESPN_NHL_INJURIES_URL = `${ESPN_SITE}/hockey/nhl/injuries`

export function espnInjuriesUrl(sport) {
  return String(sport || '').toLowerCase() === 'nhl'
    ? ESPN_NHL_INJURIES_URL
    : ESPN_NFL_INJURIES_URL
}

function athleteName(athlete) {
  if (!athlete) return ''
  if (typeof athlete === 'string') return athlete.trim()
  return String(
    athlete.displayName
    || athlete.fullName
    || athlete.name
    || [athlete.firstName, athlete.lastName].filter(Boolean).join(' '),
  ).trim()
}

function pickStatus(injury) {
  if (!injury || typeof injury !== 'object') return ''
  const fantasy = injury.details?.fantasyStatus
  const raw = injury.status
    || fantasy?.description
    || fantasy?.abbreviation
    || injury.type
    || injury.details?.type
    || ''
  if (raw && typeof raw === 'object') {
    return String(raw.description || raw.abbreviation || raw.name || raw.type || '').trim()
  }
  return String(raw || '').trim()
}

function pickStatusCode(injury) {
  const fantasy = injury?.details?.fantasyStatus?.abbreviation
  if (fantasy) return String(fantasy).toUpperCase()
  const compact = pickStatus(injury).toUpperCase().replace(/[^A-Z]/g, '')
  if (compact === 'OUT') return 'O'
  if (compact === 'DOUBTFUL') return 'D'
  if (compact === 'QUESTIONABLE') return 'Q'
  if (compact === 'IR' || compact === 'INJUREDRESERVE') return 'IR'
  return compact.slice(0, 4) || null
}

function teamAbbrFromNode(node, sport) {
  const team = node?.team && typeof node.team === 'object' ? node.team : node
  return resolveSportTeamCode(
    sport,
    team?.abbreviation
    || team?.shortDisplayName
    || team?.displayName
    || node?.abbreviation
    || node?.displayName
    || '',
  )
}

export function injuryReportId({ sport, asOfDate, teamAbbr, playerName }) {
  const name = normalizeGradePlayerName(playerName).replace(/\s+/g, '-')
  return `inj:${String(sport || '').toLowerCase()}:${asOfDate}:${teamAbbr || 'UNK'}:${name || 'unknown'}`
}

function pushInjury(rows, { sport, asOfDate, fetchedAt, teamAbbr, injury }) {
  const athlete = injury?.athlete || injury?.player || injury
  const playerName = athleteName(athlete)
  if (!playerName) return
  const status = pickStatus(injury)
  if (!status) return
  const abbr = teamAbbr || teamAbbrFromNode(injury, sport)
  rows.push({
    id: injuryReportId({ sport, asOfDate, teamAbbr: abbr, playerName }),
    sport: String(sport || '').toLowerCase(),
    teamAbbr: abbr || 'UNK',
    playerName,
    playerId: athlete?.id != null ? String(athlete.id) : null,
    status,
    statusCode: pickStatusCode(injury),
    position: athlete?.position?.abbreviation || athlete?.position || null,
    comment: injury?.details?.detail || injury?.details?.type || injury?.comment || null,
    source: 'espn',
    asOfDate,
    fetchedAt,
  })
}

function teamInjuryLists(payload) {
  if (!payload || typeof payload !== 'object') return []
  if (Array.isArray(payload.injuries)) return payload.injuries
  if (Array.isArray(payload.teams)) return payload.teams
  if (Array.isArray(payload.items)) return payload.items
  return []
}

/**
 * Normalize ESPN injuries JSON into InjuryReport rows.
 */
export function parseEspnInjuriesPayload(payload, {
  sport,
  asOfDate,
  now = new Date(),
} = {}) {
  const fetchedAt = (now instanceof Date ? now : new Date(now)).toISOString()
  const rows = []
  for (const teamNode of teamInjuryLists(payload)) {
    const teamAbbr = teamAbbrFromNode(teamNode, sport)
    const list = Array.isArray(teamNode?.injuries)
      ? teamNode.injuries
      : Array.isArray(teamNode?.items)
        ? teamNode.items
        : []
    for (const injury of list) {
      pushInjury(rows, { sport, asOfDate, fetchedAt, teamAbbr, injury })
    }
  }
  return rows
}
