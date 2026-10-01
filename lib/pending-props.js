import { GAME_LINE_SOURCE } from './game-lines.js'

/**
 * Player-stat validation (validate-pending-props) must not touch sides &
 * totals. Those rows wait for Game.status final and gradePendingGameLines.
 */
export function shouldSkipPlayerStatValidation(validation) {
  return String(validation?.source || '').toLowerCase().trim() === GAME_LINE_SOURCE
}
