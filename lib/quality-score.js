// Quality Score Calculation for Props and Parlays
// HONEST EDGE SYSTEM: Quality based on probability and confidence
// Edge is only included when we have REAL edge data (line shopping, model)

/**
 * Calculate quality score for a prop or parlay
 * 
 * HONEST EDGE SYSTEM:
 * - Most props have edge=0 (honest - no fake edges)
 * - Real edge only comes from line shopping or projection models
 * - Quality is primarily based on WIN PROBABILITY (vig-adjusted)
 * - Edge is a BONUS when available, not a requirement
 * 
 * @param {Object} options
 * @param {number} options.probability - Win probability (0-1)
 * @param {number} options.edge - Edge percentage (0-1) - often 0 for honest props
 * @param {string} options.confidence - Confidence level ("very_low", "low", "medium", "high", "very_high")
 * @returns {number} Quality score (0-100)
 */
export function calculateQualityScore({ probability, edge, confidence }) {
  // Normalize inputs
  const prob = Math.max(0, Math.min(1, probability || 0))
  const edgeVal = Math.max(0, Math.min(1, edge || 0))
  
  // Map confidence to numeric value (0-1)
  const confidenceMap = {
    'very_low': 0.2,
    'low': 0.4,
    'medium': 0.6,
    'high': 0.8,
    'very_high': 1.0
  }
  const confVal = confidenceMap[confidence] || 0.6
  
  // HONEST EDGE SYSTEM:
  // When edge=0 (honest props), quality is based on probability + confidence
  // When edge>0 (real edge from line shopping/model), edge adds bonus value
  // 
  // Formula:
  // - 70% weight on probability (most important - likelihood of winning)
  // - 20% weight on confidence (consistency/reliability)
  // - 10% weight on edge (BONUS when available from real data)
  const score = (prob * 0.70 + confVal * 0.20 + edgeVal * 0.10) * 100
  
  return Math.round(score * 10) / 10 // Round to 1 decimal
}

/**
 * Get quality tier based on score
 * @param {number} score - Quality score (0-100)
 * @returns {Object} Tier info
 */
export function getQualityTier(score) {
  if (score >= 70) {
    return {
      tier: 'elite',
      label: 'Elite Pick',
      color: 'green',
      emoji: '🔥',
      description: 'Highest quality - great probability and edge'
    }
  } else if (score >= 55) {
    return {
      tier: 'premium',
      label: 'Premium',
      color: 'blue',
      emoji: '⭐',
      description: 'High quality - strong chance to win'
    }
  } else if (score >= 40) {
    return {
      tier: 'solid',
      label: 'Solid Value',
      color: 'yellow',
      emoji: '💎',
      description: 'Good value - balanced risk/reward'
    }
  } else if (score >= 25) {
    return {
      tier: 'speculative',
      label: 'Speculative',
      color: 'orange',
      emoji: '🎲',
      description: 'Higher risk - value play'
    }
  } else {
    return {
      tier: 'longshot',
      label: 'Longshot',
      color: 'red',
      emoji: '🎰',
      description: 'High risk - lottery ticket'
    }
  }
}

/**
 * Filter modes for different betting strategies
 * 
 * HONEST EDGE SYSTEM:
 * - No minEdge requirements (most props have edge=0, which is honest)
 * - Filter by probability and quality score instead
 * - Value mode uses expected value (EV) for sorting instead of fake edge
 */
export const FILTER_MODES = {
  SAFE: {
    id: 'safe',
    name: 'Safe Mode',
    emoji: '🛡️',
    description: 'Highest win probability (52%+), lower variance',
    minProbability: 0.52,
    minEdge: 0, // HONEST: No edge requirement
    minQualityScore: 40,
    sortBy: 'probability' // Sort by win chance
  },
  BALANCED: {
    id: 'balanced',
    name: 'Balanced',
    emoji: '⚖️',
    description: 'Optimized quality score - best overall picks',
    minProbability: 0.45,
    minEdge: 0, // HONEST: No edge requirement
    minQualityScore: 35,
    sortBy: 'qualityScore' // Sort by quality
  },
  VALUE: {
    id: 'value',
    name: 'Value Hunter',
    emoji: '💰',
    description: 'Best expected value (EV) - smart money plays',
    minProbability: 0.40,
    minEdge: 0, // HONEST: No fake edge requirement
    minQualityScore: 25,
    sortBy: 'expectedValue' // HONEST: Sort by EV, not fake edge
  },
  HOMERUN: {
    id: 'homerun',
    name: 'Home Run',
    emoji: '🎰',
    description: 'High payout parlays, higher risk',
    minProbability: 0.10,
    minEdge: 0, // HONEST: No edge requirement
    minQualityScore: 0,
    sortBy: 'payout' // Sort by payout
  }
}

/**
 * Apply filter mode to a list of props/parlays
 * 
 * HONEST EDGE SYSTEM:
 * - Filters by probability and quality score (not fake edge)
 * - Value mode sorts by expected value (EV = probability * odds - 1)
 * 
 * @param {Array} items - Props or parlays to filter
 * @param {string} mode - Filter mode ID ('safe', 'balanced', 'value', 'homerun')
 * @returns {Array} Filtered and sorted items
 */
export function applyFilterMode(items, mode = 'balanced') {
  const filterConfig = FILTER_MODES[mode.toUpperCase()] || FILTER_MODES.BALANCED
  
  // Filter items (HONEST: no edge requirement)
  const filtered = items.filter(item => {
    const prob = item.probability || 0
    const quality = item.qualityScore || 0
    
    return (
      prob >= filterConfig.minProbability &&
      quality >= filterConfig.minQualityScore
    )
  })
  
  // Sort items
  filtered.sort((a, b) => {
    switch (filterConfig.sortBy) {
      case 'probability':
        return (b.probability || 0) - (a.probability || 0)
      case 'expectedValue':
        // HONEST: Calculate EV from probability and odds
        // EV = (probability * payout) - 1 where payout = odds for props
        const evA = (a.probability || 0.5) * (a.odds || a.totalOdds || 2) - 1
        const evB = (b.probability || 0.5) * (b.odds || b.totalOdds || 2) - 1
        return evB - evA
      case 'edge':
        // Keep for backwards compatibility, but edge is usually 0
        return (b.edge || 0) - (a.edge || 0)
      case 'qualityScore':
        return (b.qualityScore || 0) - (a.qualityScore || 0)
      case 'payout':
        return (b.totalOdds || b.odds || 0) - (a.totalOdds || a.odds || 0)
      default:
        return (b.qualityScore || 0) - (a.qualityScore || 0)
    }
  })
  
  return filtered
}

