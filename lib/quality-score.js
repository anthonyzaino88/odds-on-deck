// Quality Score Calculation for Props and Parlays
// Combines probability, edge, and confidence into a single metric

/**
 * Calculate quality score for a prop or parlay
 * @param {Object} options
 * @param {number} options.probability - Win probability (0-1)
 * @param {number} options.edge - Edge percentage (0-1)
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
  
  // Weighted formula:
  // - 50% weight on probability (most important for consistent wins)
  // - 35% weight on edge (important for value)
  // - 15% weight on confidence (less important, more subjective)
  const score = (prob * 0.50 + edgeVal * 0.35 + confVal * 0.15) * 100
  
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
 */
export const FILTER_MODES = {
  SAFE: {
    id: 'safe',
    name: 'Safe Mode',
    emoji: '🛡️',
    description: 'Highest win probability (52%+), lower variance',
    minProbability: 0.52,
    minEdge: 0.02,
    minQualityScore: 40,
    sortBy: 'probability' // Sort by win chance
  },
  BALANCED: {
    id: 'balanced',
    name: 'Balanced',
    emoji: '⚖️',
    description: 'Optimized quality score - best overall picks',
    minProbability: 0.45,
    minEdge: 0.05,
    minQualityScore: 35,
    sortBy: 'qualityScore' // Sort by quality
  },
  VALUE: {
    id: 'value',
    name: 'Value Hunter',
    emoji: '💰',
    description: 'High edge opportunities (15%+), medium risk',
    minProbability: 0.40,
    minEdge: 0.15,
    minQualityScore: 25,
    sortBy: 'edge' // Sort by edge
  },
  HOMERUN: {
    id: 'homerun',
    name: 'Home Run',
    emoji: '🎰',
    description: 'High payout parlays, higher risk',
    minProbability: 0.10,
    minEdge: 0.10,
    minQualityScore: 0,
    sortBy: 'payout' // Sort by payout
  }
}

/**
 * Apply filter mode to a list of props/parlays
 * @param {Array} items - Props or parlays to filter
 * @param {string} mode - Filter mode ID ('safe', 'balanced', 'value', 'homerun')
 * @returns {Array} Filtered and sorted items
 */
export function applyFilterMode(items, mode = 'balanced') {
  const filterConfig = FILTER_MODES[mode.toUpperCase()] || FILTER_MODES.BALANCED
  
  // Filter items
  const filtered = items.filter(item => {
    const prob = item.probability || 0
    const edge = item.edge || 0
    const quality = item.qualityScore || 0
    
    return (
      prob >= filterConfig.minProbability &&
      edge >= filterConfig.minEdge &&
      quality >= filterConfig.minQualityScore
    )
  })
  
  // Sort items
  filtered.sort((a, b) => {
    switch (filterConfig.sortBy) {
      case 'probability':
        return (b.probability || 0) - (a.probability || 0)
      case 'edge':
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

