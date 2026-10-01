import { GAME_LINE_SOURCE } from './game-lines.js'
import { planStatLookupFromGame } from './game-grade-eligibility.js'

/**
 * Player-stat validation (validate-pending-props) must not touch sides &
 * totals. Those rows wait for Game.status final and gradePendingGameLines.
 */
export function shouldSkipPlayerStatValidation(validation) {
  return String(validation?.source || '').toLowerCase().trim() === GAME_LINE_SOURCE
}

/**
 * Decide whether a pending player-stat row should look up a box score,
 * stay pending, or be voided. Game-line rows never enter this path.
 */
export function planPlayerStatValidation(validation, game, options = {}) {
  if (shouldSkipPlayerStatValidation(validation)) {
    return { action: 'skip_game_line', reason: 'source_game_line' }
  }
  if (!game) return { action: 'needs_review', reason: 'game_not_found' }
  return planStatLookupFromGame(game, options)
}
