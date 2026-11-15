/**
 * Pre-lock NFL (and shared) game-line features.
 *
 * Rebuilds form, rest, and matchup history from completed games whose
 * result was already written before pick-lock. Injuries and starting
 * QBs / goalies are used only when their fetch timestamp is ≤ lock.
 *
 * Does not read the closing line. Does not call The Odds API.
 */

import { injurySkipReason, injuryFlagReason } from './injury-availability.js'

export function parseTimestamp(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

export const RECENT_FORM_GAMES = 4
export const NFL_SHORT_WEEK_REST_DAYS = 6
export const NFL_BYE_REST_DAYS = 10

const FINAL_STATUSES = new Set([
  'final',
  'closed',
  'completed',
  'official',
  'final/ot',
  'final/so',
])

export function isFinalStatus(status) {
  const token = String(status || '').toLowerCase().trim()
  return FINAL_STATUSES.has(token) || token.startsWith('final')
}

export function isAtOrBeforeLock(timestamp, lockAt) {
  const at = parseTimestamp(timestamp)
  const lock = parseTimestamp(lockAt)
  if (at == null || lock == null) return false
  return at <= lock
}

export function resultAvailableAt(game) {
  if (!game || typeof game !== 'object') return null
  if (isFinalStatus(game.status)) {
    return parseTimestamp(
      game.resultAvailableAt
      || game.lastUpdate
      || game.completedAt
      || game.archivedAt
      || game.archived_at,
    )
  }
  return parseTimestamp(game.resultAvailableAt || game.archivedAt || game.archived_at)
}

export function frozenStartMs(game) {
  return parseTimestamp(game?.frozenStart || game?.date || game?.gameDate || game?.commence_time)
}

function teamKeys(team) {
  if (team == null) return []
  if (typeof team === 'string' || typeof team === 'number') {
    const value = String(team).trim()
    return value ? [value.toUpperCase()] : []
  }
  const keys = [
    team.id,
    team.abbr,
    team.abbreviation,
    team.teamAbbr,
    team.team_id,
  ]
  return [...new Set(keys.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))]
}

export function gameTeamKeys(game, side) {
  if (!game) return []
  if (side === 'home') {
    return teamKeys(game.home || game.homeTeam || game.home_team || game.homeId || game.homeAbbr)
  }
  return teamKeys(game.away || game.awayTeam || game.away_team || game.awayId || game.awayAbbr)
}

function teamPlayed(game, team) {
  const want = new Set(teamKeys(team))
  if (!want.size) return null
  const home = gameTeamKeys(game, 'home')
  const away = gameTeamKeys(game, 'away')
  if (home.some((key) => want.has(key))) return 'home'
  if (away.some((key) => want.has(key))) return 'away'
  return null
}

export function gamesAvailableBeforeLock(games, lockAt) {
  const lock = parseTimestamp(lockAt)
  if (lock == null) return []
  return (Array.isArray(games) ? games : []).filter((game) => {
    if (!isFinalStatus(game?.status)) return false
    const available = resultAvailableAt(game)
    const start = frozenStartMs(game)
    if (available == null || start == null) return false
    if (available > lock) return false
    if (start > lock) return false
    if (!Number.isFinite(Number(game.homeScore ?? game.home_score))) return false
    if (!Number.isFinite(Number(game.awayScore ?? game.away_score))) return false
    return true
  })
}

export function rebuildTeamSeasonStats(games, team, { lockAt, season = null } = {}) {
  const prior = gamesAvailableBeforeLock(games, lockAt)
    .filter((game) => {
      if (season == null || season === '') return true
      if (game.season == null || game.season === '') return true
      return String(game.season) === String(season)
    })
    .sort((a, b) => (frozenStartMs(a) || 0) - (frozenStartMs(b) || 0))

  let wins = 0
  let losses = 0
  let otl = 0
  let pointsFor = 0
  let pointsAgainst = 0
  let lastStart = null
  let lastAvailable = null

  for (const game of prior) {
    const side = teamPlayed(game, team)
    if (!side) continue
    const homeScore = Number(game.homeScore ?? game.home_score)
    const awayScore = Number(game.awayScore ?? game.away_score)
    const scored = side === 'home' ? homeScore : awayScore
    const allowed = side === 'home' ? awayScore : homeScore
    pointsFor += scored
    pointsAgainst += allowed
    if (scored > allowed) wins += 1
    else if (scored < allowed) {
      const status = String(game.status || '').toLowerCase()
      if (status.includes('ot') || status.includes('so') || game.overtime === true) otl += 1
      else losses += 1
    }
    lastStart = frozenStartMs(game)
    lastAvailable = resultAvailableAt(game)
  }

  const gamesPlayed = wins + losses + otl
  return {
    team: teamKeys(team)[0] || null,
    wins,
    losses,
    otl,
    gamesPlayed,
    pointsFor,
    pointsAgainst,
    pointsForPerGame: gamesPlayed > 0 ? pointsFor / gamesPlayed : null,
    pointsAgainstPerGame: gamesPlayed > 0 ? pointsAgainst / gamesPlayed : null,
    last10Record: gamesPlayed > 0 ? `${wins}-${losses}${otl ? `-${otl}` : ''}` : null,
    dataThrough: lastStart != null ? new Date(lastStart).toISOString() : null,
    capturedAt: lastAvailable != null ? new Date(lastAvailable).toISOString() : null,
    statsKind: 'season_from_finals',
    season: season || null,
  }
}

export function teamRecentForm(games, team, lockAt, { lastN = RECENT_FORM_GAMES } = {}) {
  const prior = gamesAvailableBeforeLock(games, lockAt)
    .filter((game) => teamPlayed(game, team))
    .sort((a, b) => (frozenStartMs(b) || 0) - (frozenStartMs(a) || 0))
    .slice(0, lastN)

  let wins = 0
  let pointsFor = 0
  let pointsAgainst = 0
  for (const game of prior) {
    const side = teamPlayed(game, team)
    const homeScore = Number(game.homeScore ?? game.home_score)
    const awayScore = Number(game.awayScore ?? game.away_score)
    const scored = side === 'home' ? homeScore : awayScore
    const allowed = side === 'home' ? awayScore : homeScore
    pointsFor += scored
    pointsAgainst += allowed
    if (scored > allowed) wins += 1
  }
  return {
    games: prior.length,
    wins,
    losses: prior.length - wins,
    pointsFor,
    pointsAgainst,
    winPct: prior.length > 0 ? wins / prior.length : null,
    ids: prior.map((game) => game.id),
  }
}

export function teamRestDays(games, team, lockAt, frozenStart) {
  const start = parseTimestamp(frozenStart)
  if (start == null) return { restDays: null, previousGameId: null, reason: 'missing_start' }
  const prior = gamesAvailableBeforeLock(games, lockAt)
    .filter((game) => teamPlayed(game, team))
    .sort((a, b) => (frozenStartMs(b) || 0) - (frozenStartMs(a) || 0))
  const previous = prior[0]
  if (!previous) return { restDays: null, previousGameId: null, reason: 'no_prior_final' }
  const prevStart = frozenStartMs(previous)
  if (prevStart == null || prevStart >= start) {
    return { restDays: null, previousGameId: previous.id, reason: 'invalid_previous_start' }
  }
  const restDays = (start - prevStart) / (24 * 60 * 60 * 1000)
  return {
    restDays,
    previousGameId: previous.id,
    shortWeek: restDays < NFL_SHORT_WEEK_REST_DAYS,
    byeLike: restDays >= NFL_BYE_REST_DAYS,
    reason: null,
  }
}

export function matchupHistory(games, home, away, lockAt) {
  const prior = gamesAvailableBeforeLock(games, lockAt)
    .filter((game) => teamPlayed(game, home) && teamPlayed(game, away))
    .sort((a, b) => (frozenStartMs(b) || 0) - (frozenStartMs(a) || 0))
  let homeWins = 0
  for (const game of prior) {
    const homeSide = teamPlayed(game, home)
    const homeScore = Number(game.homeScore ?? game.home_score)
    const awayScore = Number(game.awayScore ?? game.away_score)
    const scored = homeSide === 'home' ? homeScore : awayScore
    const allowed = homeSide === 'home' ? awayScore : homeScore
    if (scored > allowed) homeWins += 1
  }
  return {
    games: prior.length,
    homeWins,
    awayWins: prior.length - homeWins,
    ids: prior.map((game) => game.id),
  }
}

function injuryPosition(row) {
  return String(row?.position || row?.pos || '').toUpperCase().trim()
}

function isQbInjury(row, startingQB) {
  if (injuryPosition(row) === 'QB') return true
  const starter = String(startingQB || '').trim().toLowerCase()
  const name = String(row?.playerName || '').trim().toLowerCase()
  return Boolean(starter && name && (name === starter || name.includes(starter) || starter.includes(name)))
}

export function injuryFeatures(injuries, team, {
  lockAt,
  startingQB = null,
  sport = 'nfl',
} = {}) {
  const lock = parseTimestamp(lockAt)
  const want = new Set(teamKeys(team))
  const rows = (Array.isArray(injuries) ? injuries : []).filter((row) => {
    if (sport && String(row.sport || '').toLowerCase() !== String(sport).toLowerCase()) return false
    const teamHit = teamKeys(row.teamAbbr || row.team).some((key) => want.has(key))
    if (!teamHit) return false
    if (!isAtOrBeforeLock(row.fetchedAt || row.observedAt, lock)) return false
    if (row.asOfDate && parseTimestamp(row.asOfDate) != null && parseTimestamp(row.asOfDate) > lock) {
      return false
    }
    return true
  })

  let qbOut = false
  let qbQuestionable = false
  let skillOut = 0
  const used = []
  for (const row of rows) {
    const skip = injurySkipReason(row.status || row.statusCode)
    const flag = injuryFlagReason(row.status || row.statusCode)
    const qb = isQbInjury(row, startingQB)
    if (qb && skip) qbOut = true
    else if (qb && flag) qbQuestionable = true
    else if (skip && ['WR', 'RB', 'TE', 'LT', 'RT', 'C', 'LG', 'RG'].includes(injuryPosition(row))) {
      skillOut += 1
    }
    used.push(row.id || row.playerName)
  }

  return {
    qbOut,
    qbQuestionable,
    skillOut,
    injuryCount: rows.length,
    usedIds: used,
    strongEvidence: qbOut,
  }
}

export function starterKnownAtLock(game, lockAt) {
  const observed = parseTimestamp(
    game?.startersObservedAt
    || game?.qbObservedAt
    || game?.lineupObservedAt,
  )
  const lock = parseTimestamp(lockAt)
  const names = {
    homeStartingQB: game?.homeStartingQB || game?.home_qb || null,
    awayStartingQB: game?.awayStartingQB || game?.away_qb || null,
  }
  if (observed == null) {
    if (!isFinalStatus(game?.status)) {
      return { ...names, reason: null }
    }
    return {
      homeStartingQB: null,
      awayStartingQB: null,
      reason: 'starter_timestamp_unknown',
    }
  }
  if (lock == null || observed > lock) {
    return {
      homeStartingQB: null,
      awayStartingQB: null,
      reason: 'starter_after_lock',
    }
  }
  return { ...names, reason: null }
}

/**
 * Build the allowed pre-game feature bundle for one lock.
 * Unknown features stay unknown. Later games are not in `completedGames`
 * after `gamesAvailableBeforeLock`.
 */
export function buildNflPregameFeatures({
  game,
  completedGames = [],
  injuries = [],
  lockAt,
} = {}) {
  const lock = lockAt || game?.lockAt
  const home = game?.home || game?.homeTeam || game?.homeAbbr
  const away = game?.away || game?.awayTeam || game?.awayAbbr
  const starters = starterKnownAtLock(game, lock)
  const homeForm = teamRecentForm(completedGames, home, lock)
  const awayForm = teamRecentForm(completedGames, away, lock)
  const homeRest = teamRestDays(completedGames, home, lock, frozenStartMs(game))
  const awayRest = teamRestDays(completedGames, away, lock, frozenStartMs(game))
  const h2h = matchupHistory(completedGames, home, away, lock)
  const homeInj = injuryFeatures(injuries, home, {
    lockAt: lock,
    startingQB: starters.homeStartingQB,
    sport: game?.sport || 'nfl',
  })
  const awayInj = injuryFeatures(injuries, away, {
    lockAt: lock,
    startingQB: starters.awayStartingQB,
    sport: game?.sport || 'nfl',
  })
  const rebuiltHome = rebuildTeamSeasonStats(completedGames, home, { lockAt: lock, season: game?.season })
  const rebuiltAway = rebuildTeamSeasonStats(completedGames, away, { lockAt: lock, season: game?.season })

  return {
    lockAt: parseTimestamp(lock) != null ? new Date(parseTimestamp(lock)).toISOString() : null,
    home: {
      form: homeForm,
      rest: homeRest,
      injuries: homeInj,
      rebuiltSeason: rebuiltHome,
      startingQB: starters.homeStartingQB,
    },
    away: {
      form: awayForm,
      rest: awayRest,
      injuries: awayInj,
      rebuiltSeason: rebuiltAway,
      startingQB: starters.awayStartingQB,
    },
    matchup: h2h,
    starterReason: starters.reason,
    strongEvidence: Boolean(homeInj.strongEvidence || awayInj.strongEvidence),
  }
}
