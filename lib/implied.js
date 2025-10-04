// Utility functions for converting between American odds and implied probabilities

/**
 * Convert American odds to implied probability
 * @param {number} americanOdds - American odds (e.g., -110, +150)
 * @returns {number} Implied probability (0-1)
 */
export function americanToImplied(americanOdds) {
  if (!americanOdds || americanOdds === 0) return 0
  
  if (americanOdds > 0) {
    // Positive odds: 100 / (odds + 100)
    return 100 / (americanOdds + 100)
  } else {
    // Negative odds: |odds| / (|odds| + 100)
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)
  }
}

/**
 * Convert implied probability to American odds
 * @param {number} probability - Implied probability (0-1)
 * @returns {number} American odds
 */
export function impliedToAmerican(probability) {
  if (probability <= 0 || probability >= 1) return 0
  
  if (probability >= 0.5) {
    // Favorite: -(probability / (1 - probability)) * 100
    return -Math.round((probability / (1 - probability)) * 100)
  } else {
    // Underdog: ((1 - probability) / probability) * 100
    return Math.round(((1 - probability) / probability) * 100)
  }
}

/**
 * Calculate fair odds from probability (removing vig)
 * @param {number} homeOdds - Home team American odds
 * @param {number} awayOdds - Away team American odds
 * @returns {object} Fair probabilities and odds
 */
export function removeMlVig(homeOdds, awayOdds) {
  const homeImplied = americanToImplied(homeOdds)
  const awayImplied = americanToImplied(awayOdds)
  const totalImplied = homeImplied + awayImplied
  
  if (totalImplied <= 1) {
    // No vig detected
    return {
      homeFairProb: homeImplied,
      awayFairProb: awayImplied,
      homeFairOdds: homeOdds,
      awayFairOdds: awayOdds,
      vig: 0
    }
  }
  
  // Remove vig proportionally
  const homeFairProb = homeImplied / totalImplied
  const awayFairProb = awayImplied / totalImplied
  const vig = ((totalImplied - 1) / totalImplied) * 100
  
  return {
    homeFairProb,
    awayFairProb,
    homeFairOdds: impliedToAmerican(homeFairProb),
    awayFairOdds: impliedToAmerican(awayFairProb),
    vig
  }
}

/**
 * Calculate fair total from over/under odds
 * @param {number} overOdds - Over American odds
 * @param {number} underOdds - Under American odds
 * @param {number} total - Posted total
 * @returns {object} Fair probabilities and total
 */
export function removeTotalVig(overOdds, underOdds, total) {
  const overImplied = americanToImplied(overOdds)
  const underImplied = americanToImplied(underOdds)
  const totalImplied = overImplied + underImplied
  
  if (totalImplied <= 1) {
    return {
      overFairProb: overImplied,
      underFairProb: underImplied,
      fairTotal: total,
      vig: 0
    }
  }
  
  const overFairProb = overImplied / totalImplied
  const underFairProb = underImplied / totalImplied
  const vig = ((totalImplied - 1) / totalImplied) * 100
  
  return {
    overFairProb,
    underFairProb,
    fairTotal: total, // For simplicity, keeping posted total
    vig
  }
}

/**
 * Calculate expected value of a bet
 * @param {number} ourProbability - Our true probability estimate
 * @param {number} odds - American odds offered
 * @param {number} stake - Bet size (default 100)
 * @returns {object} Expected value calculation
 */
export function calculateEV(ourProbability, odds, stake = 100) {
  const impliedProb = americanToImplied(odds)
  const edge = ourProbability - impliedProb
  
  let payout
  if (odds > 0) {
    payout = stake * (odds / 100)
  } else {
    payout = stake * (100 / Math.abs(odds))
  }
  
  const expectedValue = (ourProbability * payout) - ((1 - ourProbability) * stake)
  const evPercentage = (expectedValue / stake) * 100
  
  return {
    expectedValue,
    evPercentage,
    edge: edge * 100,
    payout,
    impliedProb
  }
}

/**
 * Format American odds for display
 * @param {number} odds - American odds
 * @returns {string} Formatted odds string
 */
export function formatOdds(odds) {
  if (!odds || odds === 0) return 'N/A'
  return odds > 0 ? `+${odds}` : odds.toString()
}

/**
 * Format probability as percentage
 * @param {number} probability - Probability (0-1)
 * @param {number} decimals - Decimal places (default 1)
 * @returns {string} Formatted percentage
 */
export function formatProbability(probability, decimals = 1) {
  if (typeof probability !== 'number' || probability < 0 || probability > 1) {
    return 'N/A'
  }
  return `${(probability * 100).toFixed(decimals)}%`
}

/**
 * Format edge percentage with color coding
 * @param {number} edge - Edge percentage
 * @param {number} decimals - Decimal places (default 1)
 * @returns {object} Formatted edge with CSS class
 */
export function formatEdge(edge, decimals = 1) {
  if (typeof edge !== 'number') {
    return { text: 'N/A', className: 'edge-neutral' }
  }
  
  const text = `${edge >= 0 ? '+' : ''}${edge.toFixed(decimals)}%`
  let className = 'edge-neutral'
  
  if (edge > 2) className = 'edge-positive'
  else if (edge < -2) className = 'edge-negative'
  
  return { text, className }
}

