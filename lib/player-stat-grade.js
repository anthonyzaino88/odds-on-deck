/**
 * Shared player-prop settlement: over/under from an actual, and
 * "did this player appear?" → void vs grade vs needs_review.
 *
 * DNP voids use the same result/status as cancelled games
 * (void + manual_closed) so ROI denominators exclude them.
 */

import { canGradeFromGame } from './game-grade-eligibility.js'
import { isNearMissPlayerName } from './player-name-match.js'
import { canonicalNhlTeam } from './nhl-stat-grade.js'

export function gradePropFromActual(prediction, threshold, actualValue) {
  if (actualValue === threshold) return 'push'
  const pick = String(prediction || '').toLowerCase()
  if (
    (pick === 'over' && actualValue > threshold)
    || (pick === 'under' && actualValue < threshold)
  ) {
    return 'correct'
  }
  return 'incorrect'
}

export function isMissingFromBox(lookup) {
  if (!lookup) return false
  if (lookup.reason === 'not_in_box') return true
  return lookup.matchStatus === 'unmatched'
}

const MLB_TEAM_ALIASES = Object.freeze({
  KCR: 'KC',
  KC: 'KC',
  TBR: 'TB',
  TB: 'TB',
  TAM: 'TB',
  CHW: 'CWS',
  CWS: 'CWS',
  WSH: 'WSH',
  WAS: 'WSH',
  ARI: 'ARI',
  AZ: 'ARI',
  ATH: 'ATH',
  OAK: 'ATH',
})

export const MLB_MIN_BOX_ROSTER = 9
export const NHL_MIN_BOX_ROSTER = 15

export function parseGameIdTeams(gameId) {
  const raw = String(gameId || '').trim()
  const match = raw.match(/^([A-Za-z0-9]+)_at_([A-Za-z0-9]+)_(\d{4}-\d{2}-\d{2})/)
  if (!match) return null
  return { away: match[1].toUpperCase(), home: match[2].toUpperCase() }
}

function bareTeamCode(id) {
  const raw = String(id || '').trim()
  if (!raw) return ''
  if (/^(MLB|NHL|NFL)_/i.test(raw)) return ''
  return raw.toUpperCase()
}

export function canonicalTeamCode(sport, abbr) {
  const raw = String(abbr || '').toUpperCase().trim()
  if (!raw) return ''
  const key = String(sport || '').toLowerCase()
  if (key === 'nhl') return canonicalNhlTeam(raw)
  if (key === 'mlb') return MLB_TEAM_ALIASES[raw] || raw
  return raw
}

export function gameTeamCodes(game, sport) {
  const key = String(sport || game?.sport || '').toLowerCase()
  const fromId = parseGameIdTeams(game?.id)
  const home = canonicalTeamCode(
    key,
    game?.home?.abbr || game?.homeAbbr || fromId?.home || bareTeamCode(game?.homeId),
  )
  const away = canonicalTeamCode(
    key,
    game?.away?.abbr || game?.awayAbbr || fromId?.away || bareTeamCode(game?.awayId),
  )
  return { home, away }
}

export function minBoxRosterCount(sport) {
  const key = String(sport || '').toLowerCase()
  if (key === 'mlb') return MLB_MIN_BOX_ROSTER
  if (key === 'nhl') return NHL_MIN_BOX_ROSTER
  return 1
}

export function bothBoxRostersPresent(box, sport) {
  if (!box) return false
  const min = minBoxRosterCount(sport)
  return Number(box.homeRosterCount) >= min && Number(box.awayRosterCount) >= min
}

export function boxTeamsMatchGame(game, sport, box) {
  if (!game || !box) return false
  const gameTeams = gameTeamCodes(game, sport)
  const boxHome = canonicalTeamCode(sport, box.homeAbbr)
  const boxAway = canonicalTeamCode(sport, box.awayAbbr)
  if (boxHome && boxAway && gameTeams.home && gameTeams.away) {
    if (boxHome === gameTeams.home && boxAway === gameTeams.away) return true
    return [boxHome, boxAway].includes(gameTeams.home) && [boxHome, boxAway].includes(gameTeams.away)
  }
  return false
}

function resolveGradeOptions(usedIdOrOptions) {
  if (usedIdOrOptions && typeof usedIdOrOptions === 'object' && !Array.isArray(usedIdOrOptions)) {
    return usedIdOrOptions
  }
  return { usedId: usedIdOrOptions }
}

/**
 * A box is trusted for a DNP void only when the vendor id is real,
 * both rosters are present, and the box teams match the Game row.
 */
export function isVerifiedPlayerStatGameId(game, sport, usedIdOrOptions) {
  const options = resolveGradeOptions(usedIdOrOptions)
  const box = options.box || null
  const used = options.usedId == null ? '' : String(options.usedId).trim()
  if (!game) return false
  const key = String(sport || game.sport || '').toLowerCase().trim()
  const espnId = String(game.espnGameId || '').trim()
  const mlbId = String(game.mlbGameId || '').trim()

  if (key === 'nhl' && !espnId) return false
  if (key === 'mlb' && !mlbId) return false
  if (key === 'nfl' && !espnId) return false

  if (key === 'mlb' && used && used !== mlbId) return false
  if (key === 'nhl' && used && used !== espnId) return false
  if (key === 'nfl' && used && used !== espnId) return false

  if (!bothBoxRostersPresent(box, key)) return false
  return boxTeamsMatchGame(game, key, box)
}

export function appearanceGradeContext(game, sport, usedIdOrOptions) {
  const options = resolveGradeOptions(usedIdOrOptions)
  const key = String(sport || game?.sport || '').toLowerCase().trim()
  return {
    sport: key,
    gameFinal: canGradeFromGame(game),
    gameIdVerified: isVerifiedPlayerStatGameId(game, key, options),
    box: options.box || null,
    playerName: options.playerName || null,
  }
}

/**
 * @param {{ didNotPlay?: boolean, reason?: string, value?: number|null, matchStatus?: string, gameFinal?: boolean, sport?: string, box?: object, playerName?: string }|null} lookup
 * @param {{ sport?: string, gameFinal?: boolean, gameIdVerified?: boolean, box?: object, playerName?: string }} [context]
 * @returns {{ action: 'void'|'grade'|'needs_review', reason: string, actualValue?: number }}
 */
export function planPlayerAppearanceGrade(lookup, context = {}) {
  if (!lookup) return { action: 'needs_review', reason: 'stat_not_found' }
  if (lookup.matchStatus === 'ambiguous') {
    return { action: 'needs_review', reason: 'ambiguous' }
  }
  // Missing from the box is a safe DNP only when the game is final and
  // the box teams + both rosters check out. NFL still needs an
  // inactive-list check, so unmatched NFL stays needs_review.
  if (isMissingFromBox(lookup)) {
    const sport = String(context.sport || lookup.sport || '').toLowerCase()
    if (sport === 'nfl') {
      return { action: 'needs_review', reason: lookup.reason || 'not_in_box' }
    }
    const box = context.box || lookup.box || null
    const playerName = context.playerName || lookup.playerName
    const names = box?.playerNames || []
    if (isNearMissPlayerName(playerName, names)) {
      return { action: 'needs_review', reason: 'near_miss' }
    }
    const lookupSaysLive = lookup.gameFinal === false
    const gameFinal = lookupSaysLive ? false : Boolean(context.gameFinal ?? lookup.gameFinal)
    const gameIdVerified = Boolean(context.gameIdVerified)
    if (gameFinal && gameIdVerified && (sport === 'mlb' || sport === 'nhl')) {
      return { action: 'void', reason: lookup.reason || 'not_in_box' }
    }
    return { action: 'needs_review', reason: lookup.reason || 'not_in_box' }
  }
  if (lookup.didNotPlay) {
    return { action: 'void', reason: lookup.reason || 'did_not_play' }
  }
  if (lookup.value === null || lookup.value === undefined) {
    return { action: 'needs_review', reason: lookup.reason || 'stat_not_found' }
  }
  return { action: 'grade', reason: 'appeared', actualValue: lookup.value }
}

export function isZeroActual(value) {
  if (value == null || value === '') return false
  return Number(value) === 0
}
