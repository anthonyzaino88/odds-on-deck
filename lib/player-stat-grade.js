/**
 * Shared player-prop settlement: over/under from an actual, and
 * "did this player appear?" → void vs grade vs needs_review.
 *
 * DNP voids use the same result/status as cancelled games
 * (void + manual_closed) so ROI denominators exclude them.
 */

import { canGradeFromGame } from './game-grade-eligibility.js'

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

/**
 * Vendor box id is trusted only when it matches the Game schedule id
 * or the stored ESPN / MLB id used to fetch the box.
 */
export function isVerifiedPlayerStatGameId(game, sport, usedId) {
  if (!game) return false
  const key = String(sport || game.sport || '').toLowerCase().trim()
  const scheduleId = String(game.id || '').trim()
  const espnId = String(game.espnGameId || '').trim()
  const mlbId = String(game.mlbGameId || '').trim()
  const used = usedId == null ? '' : String(usedId).trim()

  if (key === 'mlb') {
    if (!mlbId) return false
    if (used && used !== mlbId && used !== scheduleId && used !== espnId) return false
    return Boolean(scheduleId || espnId)
  }
  if (key === 'nhl') {
    if (used && used !== espnId && used !== scheduleId) return false
    return Boolean(espnId || (scheduleId && scheduleId.includes('_at_')))
  }
  if (key === 'nfl') {
    if (!espnId) return false
    if (used && used !== espnId && used !== scheduleId) return false
    return true
  }
  return false
}

export function appearanceGradeContext(game, sport, usedId) {
  const key = String(sport || game?.sport || '').toLowerCase().trim()
  return {
    sport: key,
    gameFinal: canGradeFromGame(game),
    gameIdVerified: isVerifiedPlayerStatGameId(game, key, usedId),
  }
}

/**
 * @param {{ didNotPlay?: boolean, reason?: string, value?: number|null, matchStatus?: string, gameFinal?: boolean, sport?: string }|null} lookup
 * @param {{ sport?: string, gameFinal?: boolean, gameIdVerified?: boolean }} [context]
 * @returns {{ action: 'void'|'grade'|'needs_review', reason: string, actualValue?: number }}
 */
export function planPlayerAppearanceGrade(lookup, context = {}) {
  if (!lookup) return { action: 'needs_review', reason: 'stat_not_found' }
  if (lookup.matchStatus === 'ambiguous') {
    return { action: 'needs_review', reason: 'ambiguous' }
  }
  // Missing from the box is a safe DNP only when the game is final and
  // the box id matches the schedule or ESPN/MLB id. NFL still needs an
  // inactive-list check, so unmatched NFL stays needs_review.
  if (isMissingFromBox(lookup)) {
    const sport = String(context.sport || lookup.sport || '').toLowerCase()
    if (sport === 'nfl') {
      return { action: 'needs_review', reason: lookup.reason || 'not_in_box' }
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
