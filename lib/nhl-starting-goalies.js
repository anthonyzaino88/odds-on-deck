/**
 * NHL probable / confirmed starting goalies.
 *
 * Primary: ESPN public scoreboard / summary (site.api.espn.com).
 * Fallback: NHL's free public api-web.nhle.com (documented below).
 * Zero Odds API credits.
 *
 * NHL fallback (when ESPN has no goalie on an event):
 *   GET https://api-web.nhle.com/v1/score/{YYYY-MM-DD}
 *   GET https://api-web.nhle.com/v1/gamecenter/{id}/landing
 *     matchup.goalieComparison.{awayTeam,homeTeam}[0] is the probable.
 *   GET https://api-web.nhle.com/v1/gamecenter/{id}/boxscore
 *     playerByGameStats.*.goalies[] with starter:true when live/final.
 */

import { normalizeGradePlayerName } from './player-name-match.js'
import { resolveNhlTeamCode } from './team-mapping.js'

export const ESPN_NHL_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard'
export const ESPN_NHL_SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary'
export const NHL_WEB_API = 'https://api-web.nhle.com/v1'

export function espnNhlScoreboardUrl(dateYmd) {
  const compact = String(dateYmd || '').replace(/-/g, '')
  if (!compact) return ESPN_NHL_SCOREBOARD_URL
  return `${ESPN_NHL_SCOREBOARD_URL}?dates=${compact}`
}

export function espnNhlSummaryUrl(eventId) {
  return `${ESPN_NHL_SUMMARY_URL}?event=${encodeURIComponent(eventId)}`
}

export function nhlWebScoreUrl(dateYmd) {
  return `${NHL_WEB_API}/score/${dateYmd}`
}

export function nhlWebLandingUrl(nhlGameId) {
  return `${NHL_WEB_API}/gamecenter/${encodeURIComponent(nhlGameId)}/landing`
}

export function nhlWebBoxscoreUrl(nhlGameId) {
  return `${NHL_WEB_API}/gamecenter/${encodeURIComponent(nhlGameId)}/boxscore`
}

export function startingGoalieId({ asOfDate, teamAbbr }) {
  return `goalie:${asOfDate}:${teamAbbr || 'UNK'}`
}

function athleteName(node) {
  if (!node) return ''
  if (typeof node === 'string') return node.trim()
  const athlete = node.athlete || node
  const fromParts = [athlete.firstName, athlete.lastName].filter(Boolean).join(' ')
  const nhlName = athlete.name?.default
    || (typeof athlete.name === 'string' ? athlete.name : '')
  return String(
    athlete.displayName
    || athlete.fullName
    || nhlName
    || fromParts
    || node.displayName
    || '',
  ).trim()
}

function isGoalieNode(node) {
  if (!node) return false
  const pos = String(
    node.athlete?.position?.abbreviation
    || node.position?.abbreviation
    || node.position
    || '',
  ).toUpperCase()
  if (pos === 'G' || pos === 'GAA' || pos === 'GOALIE') return true
  return /goalie/i.test(String(node.name || node.displayName || ''))
}

function statusConfirmed(node) {
  const blob = [
    node?.status?.type?.name,
    node?.status?.name,
    node?.status,
    node?.starter,
  ].map((value) => String(value || '').toLowerCase()).join(' ')
  return blob.includes('confirm') || blob === 'true' || /\bstarter\b/.test(blob)
}

function opponentFor(teamAbbr, homeAbbr, awayAbbr) {
  if (teamAbbr === homeAbbr) return awayAbbr || null
  if (teamAbbr === awayAbbr) return homeAbbr || null
  return null
}

function rowFromParts({
  asOfDate,
  fetchedAt,
  teamAbbr,
  opponentAbbr,
  playerName,
  playerId,
  confirmed,
  source,
  espnEventId,
  nhlGameId,
  gameId,
}) {
  if (!playerName || !teamAbbr) return null
  return {
    id: startingGoalieId({ asOfDate, teamAbbr }),
    gameId: gameId || null,
    espnEventId: espnEventId || null,
    nhlGameId: nhlGameId != null ? String(nhlGameId) : null,
    teamAbbr,
    opponentAbbr: opponentAbbr || null,
    playerName,
    playerId: playerId != null ? String(playerId) : null,
    confirmed: Boolean(confirmed),
    source,
    asOfDate,
    fetchedAt,
  }
}

function collectProbables(competitor) {
  const list = []
  if (Array.isArray(competitor?.probables)) list.push(...competitor.probables)
  if (Array.isArray(competitor?.roster)) list.push(...competitor.roster)
  if (Array.isArray(competitor?.athletes)) list.push(...competitor.athletes)
  return list
}

export function parseEspnNhlGoalies(payload, {
  asOfDate,
  now = new Date(),
} = {}) {
  const fetchedAt = (now instanceof Date ? now : new Date(now)).toISOString()
  const events = payload?.events
    || (payload?.header ? [payload.header] : [])
    || []
  const competitionsFromSummary = payload?.header?.competitions
  const rows = []

  const eventList = Array.isArray(events) && events.length
    ? events
    : (competitionsFromSummary ? [{ id: payload?.header?.id, competitions: competitionsFromSummary }] : [])

  for (const event of eventList) {
    const espnEventId = event?.id != null ? String(event.id) : null
    for (const comp of event?.competitions || []) {
      const competitors = comp?.competitors || []
      const home = competitors.find((c) => c.homeAway === 'home') || competitors[1]
      const away = competitors.find((c) => c.homeAway === 'away') || competitors[0]
      const homeAbbr = resolveNhlTeamCode(home?.team?.abbreviation)
      const awayAbbr = resolveNhlTeamCode(away?.team?.abbreviation)
      for (const competitor of competitors) {
        const teamAbbr = resolveNhlTeamCode(competitor?.team?.abbreviation)
        const opponentAbbr = opponentFor(teamAbbr, homeAbbr, awayAbbr)
        for (const probable of collectProbables(competitor)) {
          if (!isGoalieNode(probable) && !isGoalieNode(probable.athlete)) continue
          const playerName = athleteName(probable)
          if (!playerName) continue
          const row = rowFromParts({
            asOfDate,
            fetchedAt,
            teamAbbr,
            opponentAbbr,
            playerName,
            playerId: probable.athlete?.id || probable.id,
            confirmed: statusConfirmed(probable),
            source: 'espn',
            espnEventId,
          })
          if (row) rows.push(row)
        }
      }
    }
  }
  return rows
}

function nhlAbbrev(team) {
  return resolveNhlTeamCode(team?.abbrev || team?.abbreviation || team?.triCode || '')
}

function goalieNameFromNhl(entry) {
  if (!entry) return ''
  if (Array.isArray(entry)) return goalieNameFromNhl(entry[0])
  return athleteName(entry)
}

export function parseNhlWebGoalies(payload, {
  asOfDate,
  now = new Date(),
  source = 'nhl',
} = {}) {
  const fetchedAt = (now instanceof Date ? now : new Date(now)).toISOString()
  const rows = []
  const games = Array.isArray(payload?.games)
    ? payload.games
    : (payload?.id || payload?.awayTeam ? [payload] : [])

  for (const game of games) {
    const nhlGameId = game.id ?? game.gamePk ?? game.gameId
    const homeAbbr = nhlAbbrev(game.homeTeam)
    const awayAbbr = nhlAbbrev(game.awayTeam)
    const comparison = game.matchup?.goalieComparison || payload?.matchup?.goalieComparison || {}

    const sides = [
      { teamAbbr: awayAbbr, opponentAbbr: homeAbbr, key: 'awayTeam' },
      { teamAbbr: homeAbbr, opponentAbbr: awayAbbr, key: 'homeTeam' },
    ]
    for (const side of sides) {
      const fromCompare = comparison[side.key]
      const fromTeam = game[side.key]?.goalie || game[side.key]?.startingGoalie
      const statsGoalies = game.playerByGameStats?.[side.key]?.goalies
        || payload?.playerByGameStats?.[side.key]?.goalies
      const starter = Array.isArray(statsGoalies)
        ? statsGoalies.find((g) => g?.starter) || statsGoalies[0]
        : null
      const playerName = goalieNameFromNhl(fromCompare)
        || goalieNameFromNhl(fromTeam)
        || goalieNameFromNhl(starter)
      if (!playerName) continue
      const confirmed = Boolean(starter?.starter) || /confirm/i.test(String(fromTeam?.status || ''))
      const row = rowFromParts({
        asOfDate,
        fetchedAt,
        teamAbbr: side.teamAbbr,
        opponentAbbr: side.opponentAbbr,
        playerName,
        playerId: starter?.playerId || starter?.id,
        confirmed,
        source,
        nhlGameId,
      })
      if (row) rows.push(row)
    }
  }
  return rows
}

export function espnScoreboardTeamAbbrs(payload) {
  const abbrs = new Set()
  for (const event of payload?.events || []) {
    for (const comp of event?.competitions || []) {
      for (const competitor of comp?.competitors || []) {
        const abbr = resolveNhlTeamCode(competitor?.team?.abbreviation)
        if (abbr) abbrs.add(abbr)
      }
    }
  }
  return [...abbrs]
}

export function mergeGoalieRows(primary, fallback) {
  const byTeam = new Map()
  for (const row of [...(fallback || []), ...(primary || [])]) {
    if (!row?.teamAbbr) continue
    const existing = byTeam.get(row.teamAbbr)
    if (!existing) {
      byTeam.set(row.teamAbbr, row)
      continue
    }
    const prefer = (row.confirmed && !existing.confirmed)
      || (row.source === 'espn' && existing.source !== 'espn')
      || (normalizeGradePlayerName(row.playerName) && !existing.playerName)
    if (prefer) byTeam.set(row.teamAbbr, { ...existing, ...row })
  }
  return [...byTeam.values()]
}
