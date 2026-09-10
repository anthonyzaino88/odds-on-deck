/**
 * NFL-only game-line edge entry point.
 * Does not share heuristics with NHL (lib/edge-nfl-nhl.js).
 */

import {
  NFL_SELECTION_MODEL_VERSION,
  calculateNFLSelection,
  toPersistedNflEdgeSnapshot,
} from './nfl-selection-model.js'

export { NFL_SELECTION_MODEL_VERSION }
export const MODEL_VERSION = NFL_SELECTION_MODEL_VERSION

export function calculateNFLEdges(game, odds, options = {}) {
  const selection = calculateNFLSelection(game, odds, options)
  return {
    ...toPersistedNflEdgeSnapshot(selection),
    selection,
  }
}
