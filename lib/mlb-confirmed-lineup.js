/**
 * Confirmed MLB starters from APIs this repo already uses.
 * Primary: MLB Stats API schedule (probablePitcher + lineups) and boxscore.
 * Fallback: ESPN summary probables (same source as lib/db.js).
 * No paid odds APIs.
 */

import { fetchGameLineup } from './vendors/stats.js'

export const MLB_STATS_API_BASE = 'https://statsapi.mlb.com/api/v1'
export const ESPN_MLB_SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary'
export const MLB_DOUBLEHEADER_FLAGS = Object.freeze(['Y', 'S'])

/**
 * Stats API `doubleHeader`: N = single game, Y = scheduled DH, S = split DH.
 * fetch-fresh-games collapses a DH into one Game.id (away_at_home_date)
 * and keeps the first gamePk, so the Game table cannot see the twin.
 */
export function isMlbStatsDoubleheader(value) {
  const flag = value && typeof value === 'object' ? value.doubleHeader : value
  return MLB_DOUBLEHEADER_FLAGS.includes(String(flag || '').toUpperCase().trim())
}

export function isInactiveScheduleGame(game) {
  const status = game?.status || {}
  const text = [status.detailedState, status.abstractGameState]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const coded = String(status.codedGameState || '').toUpperCase()
  return text.includes('postponed') || text.includes('suspended') || coded === 'U'
}

export function collectScheduleGamesForPk(data, mlbGameId) {
  const pk = String(mlbGameId)
  const matches = []
  for (const dateEntry of data?.dates || []) {
    for (const game of dateEntry.games || []) {
      if (String(game.gamePk) !== pk) continue
      matches.push({
        ...game,
        officialDate: game.officialDate || dateEntry.date || null,
      })
    }
  }
  return matches
}

function scheduleSortKey(game) {
  return String(game?.officialDate || game?.gameDate || '')
}

/**
 * A postponed-then-replayed gamePk has two schedule rows. First is often
 * the rainout (doubleHeader N, stale probable). Prefer the entry that
 * is not Postponed/Suspended; else the latest officialDate.
 */
export function pickScheduleGame(data, mlbGameId) {
  const matches = collectScheduleGamesForPk(data, mlbGameId)
  if (matches.length === 0) return data?.dates?.[0]?.games?.[0] || null
  const active = matches.filter((game) => !isInactiveScheduleGame(game))
  const pool = active.length ? active : matches
  return pool.reduce((best, game) => (
    !best || scheduleSortKey(game) >= scheduleSortKey(best) ? game : best
  ), null)
}

export function doubleHeaderFlagFromScheduleGames(games) {
  const flagged = (games || []).find((game) => isMlbStatsDoubleheader(game))
  return flagged ? String(flagged.doubleHeader) : null
}

function asPlayer(raw) {
  if (!raw) return null
  if (typeof raw === 'string') {
    const name = raw.trim()
    return name ? { id: null, fullName: name } : null
  }
  const fullName = raw.fullName || raw.name || raw.displayName || raw.athlete?.displayName
    || raw.athlete?.fullName || raw.person?.fullName || null
  if (!fullName) return null
  const id = raw.id != null ? String(raw.id) : (raw.person?.id != null ? String(raw.person.id) : null)
  return { id, fullName: String(fullName) }
}

function pushUnique(list, player) {
  const row = asPlayer(player)
  if (!row) return
  const key = `${row.id || ''}|${row.fullName.toLowerCase()}`
  if (list.some((existing) => `${existing.id || ''}|${existing.fullName.toLowerCase()}` === key)) return
  list.push(row)
}

function playersFromLineupSide(side) {
  if (!side) return []
  if (Array.isArray(side)) return side
  if (Array.isArray(side.players)) return side.players
  if (Array.isArray(side.homePlayers) || Array.isArray(side.awayPlayers)) {
    return [...(side.homePlayers || []), ...(side.awayPlayers || [])]
  }
  return []
}

/**
 * Parse schedule hydrate=probablePitcher,lineups (and optional boxscore).
 */
export function parseMlbConfirmedLineup(payload = {}) {
  const batters = []
  const pitchers = []
  const game = payload.game || payload
  const teams = game.teams || payload.teams || {}

  const probableHome = asPlayer(teams.home?.probablePitcher || payload.probableHome)
  const probableAway = asPlayer(teams.away?.probablePitcher || payload.probableAway)
  if (probableHome) pitchers.push(probableHome)
  if (probableAway) pitchers.push(probableAway)

  const lineups = game.lineups || payload.lineups || {}
  for (const side of [
    lineups.home, lineups.away,
    lineups.homePlayers, lineups.awayPlayers,
    playersFromLineupSide(lineups),
  ]) {
    for (const player of playersFromLineupSide(side)) {
      const mapped = asPlayer(player)
      if (!mapped) continue
      const isPitcher = player.isPitcher
        || player.position === 'P'
        || player.person?.primaryPosition?.code === '1'
        || player.position?.abbreviation === 'P'
      if (isPitcher) pushUnique(pitchers, mapped)
      else pushUnique(batters, mapped)
    }
  }

  const box = payload.boxscore || payload.boxScore
  const boxTeams = box?.teams || {}
  for (const side of ['home', 'away']) {
    const order = boxTeams[side]?.battingOrder || []
    const people = boxTeams[side]?.players || {}
    for (const playerId of order) {
      const info = people[`ID${playerId}`] || people[playerId] || {}
      pushUnique(batters, {
        id: playerId,
        fullName: info.person?.fullName || info.fullName,
      })
    }
  }

  if (Array.isArray(payload.home) || Array.isArray(payload.away)) {
    for (const player of [...(payload.home || []), ...(payload.away || [])]) {
      if (player?.isPitcher) pushUnique(pitchers, player)
      else pushUnique(batters, player)
    }
  }

  const scheduleGames = Array.isArray(payload.scheduleGames) ? payload.scheduleGames : []
  const anyDoubleHeader = doubleHeaderFlagFromScheduleGames(scheduleGames)
  const doubleHeader = anyDoubleHeader
    ?? game.doubleHeader
    ?? payload.doubleHeader
    ?? null
  const gameNumber = game.gameNumber ?? payload.gameNumber ?? null
  return {
    mlbGameId: game.gamePk != null ? String(game.gamePk) : (payload.mlbGameId || null),
    doubleHeader: doubleHeader != null ? String(doubleHeader) : null,
    gameNumber: gameNumber != null && Number.isFinite(Number(gameNumber))
      ? Number(gameNumber)
      : null,
    scheduleUnavailable: Boolean(payload.scheduleUnavailable),
    batters,
    pitchers,
    probableHome,
    probableAway,
    startingHome: probableHome,
    startingAway: probableAway,
  }
}

export function parseEspnProbablePitchers(summary) {
  const competition = summary?.header?.competitions?.[0]
  const result = { home: null, away: null }
  for (const competitor of competition?.competitors || []) {
    const probable = competitor.probables?.[0]
    const player = asPlayer(probable?.athlete || probable)
    if (!player) continue
    if (competitor.homeAway === 'home') result.home = player
    else result.away = player
  }
  return result
}

export function buildLineupScheduleUrl(mlbGameId) {
  const params = new URLSearchParams({
    sportId: '1',
    gamePk: String(mlbGameId),
    hydrate: 'probablePitcher,lineups',
  })
  return `${MLB_STATS_API_BASE}/schedule?${params.toString()}`
}

export async function fetchMlbConfirmedLineup(mlbGameId, {
  fetchImpl = fetch,
  fetchBoxscoreLineup = fetchGameLineup,
  espnGameId = null,
} = {}) {
  if (!mlbGameId) return parseMlbConfirmedLineup({})

  let scheduleGame = null
  let scheduleGames = []
  let scheduleUnavailable = false
  try {
    const res = await fetchImpl(buildLineupScheduleUrl(mlbGameId), {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' },
    })
    if (res.ok) {
      const data = await res.json()
      scheduleGames = collectScheduleGamesForPk(data, mlbGameId)
      scheduleGame = pickScheduleGame(data, mlbGameId)
    } else {
      scheduleUnavailable = true
    }
  } catch {
    scheduleGame = null
    scheduleUnavailable = true
  }

  let boxHomeAway = { home: [], away: [] }
  try {
    boxHomeAway = await fetchBoxscoreLineup(mlbGameId) || { home: [], away: [] }
  } catch {
    boxHomeAway = { home: [], away: [] }
  }

  let espnPitchers = { home: null, away: null }
  if (espnGameId) {
    try {
      const res = await fetchImpl(`${ESPN_MLB_SUMMARY}?event=${espnGameId}`, {
        headers: { 'User-Agent': 'OddsOnDeck/1.0' },
      })
      if (res.ok) espnPitchers = parseEspnProbablePitchers(await res.json())
    } catch {
      espnPitchers = { home: null, away: null }
    }
  }

  const parsed = parseMlbConfirmedLineup({
    game: scheduleGame || {},
    scheduleGames,
    scheduleUnavailable,
    probableHome: scheduleGame?.teams?.home?.probablePitcher || espnPitchers.home,
    probableAway: scheduleGame?.teams?.away?.probablePitcher || espnPitchers.away,
    home: boxHomeAway.home,
    away: boxHomeAway.away,
  })

  if (!parsed.probableHome && espnPitchers.home) parsed.probableHome = espnPitchers.home
  if (!parsed.probableAway && espnPitchers.away) parsed.probableAway = espnPitchers.away
  if (parsed.probableHome) parsed.pitchers = parsed.pitchers.concat(parsed.probableHome)
  if (parsed.probableAway) parsed.pitchers = parsed.pitchers.concat(parsed.probableAway)
  parsed.startingHome = parsed.probableHome
  parsed.startingAway = parsed.probableAway
  return parsed
}
