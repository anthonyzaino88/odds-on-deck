// Core matchup modeling and edge calculation engine

import { americanToImplied, removeMlVig, removeTotalVig } from './implied.js'

// Model version for tracking
export const MODEL_VERSION = 'v0.1.0'

/**
 * Calculate team run expectancy and game edges
 * @param {object} game - Game data with teams and pitchers
 * @param {object} odds - Odds data for the game
 * @param {object} playerData - Additional player stats (for future enhancement)
 * @returns {object} Edge calculations and predictions
 */
export function calculateGameEdges(game, odds, playerData = {}) {
  try {
    // Get market probabilities
    const marketProbs = getMarketProbabilities(odds)
    
    // Get pitcher data from the correct structure
    const homePitcher = game.probableHomePitcher || null
    const awayPitcher = game.probableAwayPitcher || null
    
    // Calculate our team run expectations
    const homeRuns = calculateTeamRuns(game.home, game.away, awayPitcher, true)
    const awayRuns = calculateTeamRuns(game.away, game.home, homePitcher, false)
    
    // Convert to game total and win probabilities
    const ourTotal = homeRuns + awayRuns
    const gameProbs = runsToWinProbability(homeRuns, awayRuns, marketProbs.total)
    
    // Calculate edges with realistic capping
    const edges = {
      edgeMlHome: marketProbs.mlHome ? capEdge((gameProbs.homeWin - marketProbs.mlHome)) : null,
      edgeMlAway: marketProbs.mlAway ? capEdge((gameProbs.awayWin - marketProbs.mlAway)) : null,
      edgeTotalO: marketProbs.totalOver ? capEdge((gameProbs.over - marketProbs.totalOver)) : null,
      edgeTotalU: marketProbs.totalUnder ? capEdge((gameProbs.under - marketProbs.totalUnder)) : null,
      ourTotal,
      marketTotal: marketProbs.total,
      modelRun: MODEL_VERSION
    }
    
    return edges
  } catch (error) {
    console.error('Error calculating game edges:', error)
    return {
      edgeMlHome: null,
      edgeMlAway: null,
      edgeTotalO: null,
      edgeTotalU: null,
      ourTotal: null,
      marketTotal: null,
      modelRun: MODEL_VERSION
    }
  }
}

/**
 * Calculate expected runs for a team
 * @param {object} team - Team data
 * @param {object} oppTeam - Opposing team data  
 * @param {object} oppPitcher - Opposing pitcher data
 * @param {boolean} isHome - Is this the home team
 * @returns {number} Expected runs
 */
function calculateTeamRuns(team, oppTeam, oppPitcher, isHome) {
  // Base runs per game (league average ~4.5)
  let baseRuns = 4.5
  
  // Home field advantage (~0.1 runs)
  if (isHome) {
    baseRuns += 0.1
  }
  
  // Park factor adjustment (more conservative)
  const parkFactor = team.parkFactor || 1.0
  // Apply park factor more conservatively (0.5x impact)
  baseRuns *= (1 + (parkFactor - 1) * 0.5)
  
  // Team offensive adjustment using available data
  const teamOffenseAdjustment = getTeamOffenseAdjustment(team)
  baseRuns *= teamOffenseAdjustment
  
  // Opposing team defense adjustment
  const oppDefenseAdjustment = getOpposingDefenseAdjustment(oppTeam)
  baseRuns *= oppDefenseAdjustment
  
  // Pitcher adjustment (enhanced)
  if (oppPitcher) {
    const pitcherAdjustment = getPitcherQualityAdjustment(oppPitcher)
    baseRuns *= pitcherAdjustment
  } else {
    // Use league average pitcher when no specific pitcher data
    baseRuns *= 1.0
  }
  
  // Recent form adjustment (if available)
  const recentFormAdjustment = getRecentFormAdjustment(team)
  baseRuns *= recentFormAdjustment
  
  return Math.max(baseRuns, 0.5) // Floor at 0.5 runs
}

/**
 * Get pitcher quality adjustment (placeholder for MVP)
 * @param {object} pitcher - Pitcher data
 * @returns {number} Adjustment factor (0.8-1.2)
 */
function getPitcherQualityAdjustment(pitcher) {
  // Placeholder: in reality would use ERA, xFIP, recent form, etc.
  // For MVP, return neutral adjustment
  return 1.0
}

/**
 * Get team offense adjustment (placeholder for MVP)
 * @param {object} team - Team data
 * @returns {number} Adjustment factor (0.8-1.2)
 */
function getTeamOffenseAdjustment(team) {
  // Use available team performance data if present
  if (team.avgPointsLast10) {
    const leagueAvgRuns = 4.5
    const teamRuns = team.avgPointsLast10
    // Convert to adjustment factor (0.9 to 1.1 range)
    return Math.max(0.9, Math.min(1.1, teamRuns / leagueAvgRuns))
  }
  
  // Fallback to very conservative team-specific adjustments
  const teamAdjustments = {
    'LAD': 1.02, 'HOU': 1.01, 'ATL': 1.01, 'NYY': 1.01, 'TOR': 1.00,
    'OAK': 0.98, 'DET': 0.99, 'MIA': 0.99, 'KC': 0.99, 'WSH': 1.00
  }
  
  return teamAdjustments[team.abbr] || 1.0
}

/**
 * Convert team run expectations to win probabilities
 * @param {number} homeRuns - Expected home team runs
 * @param {number} awayRuns - Expected away team runs
 * @param {number} marketTotal - Market total for comparison
 * @returns {object} Win and total probabilities
 */
function runsToWinProbability(homeRuns, awayRuns, marketTotal = null) {
  // Use Pythagorean expectation with exponent ~1.83 for baseball
  const exponent = 1.83
  const homeWin = Math.pow(homeRuns, exponent) / 
    (Math.pow(homeRuns, exponent) + Math.pow(awayRuns, exponent))
  
  const awayWin = 1 - homeWin
  
  // For totals, use proper Poisson distribution
  const gameTotal = homeRuns + awayRuns
  const totalProbs = calculateTotalProbabilities(gameTotal, marketTotal)
  
  return {
    homeWin,
    awayWin,
    over: totalProbs.over,
    under: totalProbs.under,
    gameTotal
  }
}

/**
 * Extract market probabilities from odds
 * @param {Array} odds - Array of odds objects
 * @returns {object} Market probabilities
 */
function getMarketProbabilities(odds) {
  if (!odds || odds.length === 0) {
    return {
      mlHome: null,
      mlAway: null,
      totalOver: null,
      totalUnder: null,
      total: null
    }
  }
  
  // Find best h2h odds
  const h2hOdds = odds.filter(o => o.market === 'h2h')
  const totalOdds = odds.filter(o => o.market === 'totals')
  
  let mlProbs = { mlHome: null, mlAway: null }
  if (h2hOdds.length > 0) {
    // Use first available for MVP (in production would find best line)
    const bestH2h = h2hOdds[0]
    if (bestH2h.priceHome && bestH2h.priceAway) {
      const fairOdds = removeMlVig(bestH2h.priceHome, bestH2h.priceAway)
      mlProbs.mlHome = fairOdds.homeFairProb
      mlProbs.mlAway = fairOdds.awayFairProb
    }
  }
  
  let totalProbs = { totalOver: null, totalUnder: null, total: null }
  if (totalOdds.length > 0) {
    const bestTotal = totalOdds[0]
    if (bestTotal.priceHome && bestTotal.priceAway && bestTotal.total) {
      const fairOdds = removeTotalVig(bestTotal.priceHome, bestTotal.priceAway, bestTotal.total)
      totalProbs.totalOver = fairOdds.overFairProb
      totalProbs.totalUnder = fairOdds.underFairProb
      totalProbs.total = bestTotal.total
    }
  }
  
  return { ...mlProbs, ...totalProbs }
}

/**
 * Get batter vs pitcher matchup data with real analysis
 * @param {object} batter - Batter data with splits
 * @param {object} pitcher - Pitcher data with splits and pitch mix
 * @returns {object} Detailed matchup analysis
 */
export function getBatterVsPitcherMatchup(batter, pitcher) {
  try {
    // Get platoon advantage
    const platoonAdvantage = calculatePlatoonAdvantage(batter.bats, pitcher.throws)
    
    // Get batter's performance vs pitcher's handedness
    const batterVsHand = getBatterSplitVsHand(batter.splits, pitcher.throws)
    
    // Get pitcher's performance vs batter's handedness
    const pitcherVsHand = getPitcherSplitVsHand(pitcher.splits, batter.bats)
    
    // Calculate pitch mix advantage
    const pitchMixFit = calculatePitchMixAdvantage(batter, pitcher)
    
    // Project OPS based on matchup
    const projectedOPS = calculateProjectedOPS(batterVsHand, pitcherVsHand, platoonAdvantage)
    
    // Determine confidence level
    const confidence = calculateConfidence(batterVsHand, pitcherVsHand)
    
    return {
      platoonAdvantage,
      batterStats: batterVsHand,
      pitcherStats: pitcherVsHand,
      pitchMixFit,
      projectedOPS,
      confidence,
      recommendation: getRecommendation(projectedOPS, platoonAdvantage)
    }
  } catch (error) {
    console.error('Error in batter vs pitcher analysis:', error)
    return {
      platoonAdvantage: 0,
      batterStats: null,
      pitcherStats: null,
      pitchMixFit: 0.5,
      projectedOPS: 0.750,
      confidence: 'low',
      recommendation: 'neutral'
    }
  }
}

/**
 * Get batter's splits vs specific pitcher handedness
 */
function getBatterSplitVsHand(splits, pitcherHand) {
  if (!splits || !pitcherHand) return null
  
  const relevantSplit = splits.find(split => split.vsHand === pitcherHand)
  if (!relevantSplit) return null
  
  return {
    wOBA: relevantSplit.wOBA,
    ISO: relevantSplit.ISO,
    kRate: relevantSplit.kRate,
    bbRate: relevantSplit.bbRate,
    xwOBA: relevantSplit.xwOBA,
    samplePA: relevantSplit.samplePA
  }
}

/**
 * Get pitcher's splits vs specific batter handedness
 */
function getPitcherSplitVsHand(splits, batterHand) {
  if (!splits || !batterHand) return null
  
  // For switch hitters, use right-handed splits as default
  const targetHand = batterHand === 'S' ? 'R' : batterHand
  
  const relevantSplit = splits.find(split => split.vsHand === targetHand)
  if (!relevantSplit) return null
  
  return {
    wOBAAllowed: relevantSplit.wOBA,
    isoAllowed: relevantSplit.ISO,
    kRate: relevantSplit.kRate,
    bbRate: relevantSplit.bbRate,
    xwOBAAllowed: relevantSplit.xwOBA,
    samplePA: relevantSplit.samplePA
  }
}

/**
 * Calculate pitch mix advantage (simplified)
 */
function calculatePitchMixAdvantage(batter, pitcher) {
  // For MVP, return neutral with slight variation based on handedness
  const platoonAdv = calculatePlatoonAdvantage(batter.bats, pitcher.throws)
  return 0.5 + (platoonAdv * 0.3) // Convert platoon advantage to pitch mix factor
}

/**
 * Project OPS based on matchup factors
 */
function calculateProjectedOPS(batterStats, pitcherStats, platoonAdvantage) {
  let baseOPS = 0.750 // League average
  
  // Adjust based on batter stats
  if (batterStats && batterStats.wOBA) {
    baseOPS = (batterStats.wOBA - 0.320) * 2.5 + 0.750 // Convert wOBA to rough OPS
  }
  
  // Adjust based on pitcher quality
  if (pitcherStats && pitcherStats.wOBAAllowed) {
    const pitcherAdjustment = (0.320 - pitcherStats.wOBAAllowed) * 1.5 // Pitcher effect
    baseOPS += pitcherAdjustment
  }
  
  // Apply platoon advantage
  baseOPS += platoonAdvantage * 0.5
  
  // Keep within reasonable bounds
  return Math.max(0.400, Math.min(1.200, baseOPS))
}

/**
 * Calculate confidence in projection
 */
function calculateConfidence(batterStats, pitcherStats) {
  let confidence = 'medium'
  
  const batterSample = batterStats?.samplePA || 0
  const pitcherSample = pitcherStats?.samplePA || 0
  
  if (batterSample > 200 && pitcherSample > 200) {
    confidence = 'high'
  } else if (batterSample < 100 || pitcherSample < 100) {
    confidence = 'low'
  }
  
  return confidence
}

/**
 * Get recommendation based on matchup
 */
function getRecommendation(projectedOPS, platoonAdvantage) {
  if (projectedOPS > 0.850 && platoonAdvantage > 0.05) {
    return 'strong_favorable'
  } else if (projectedOPS > 0.800 || platoonAdvantage > 0.05) {
    return 'favorable'
  } else if (projectedOPS < 0.650 && platoonAdvantage < -0.05) {
    return 'unfavorable'
  } else {
    return 'neutral'
  }
}

/**
 * Calculate platoon advantage
 * @param {string} batterHand - L/R/S
 * @param {string} pitcherHand - L/R
 * @returns {number} Advantage factor (-0.2 to +0.2)
 */
function calculatePlatoonAdvantage(batterHand, pitcherHand) {
  if (!batterHand || !pitcherHand) return 0
  
  // Same-handed (disadvantage for batter)
  if (batterHand === pitcherHand) return -0.1
  
  // Switch hitter (slight advantage)
  if (batterHand === 'S') return 0.05
  
  // Opposite-handed (advantage for batter)
  return 0.1
}

/**
 * Cap edge values to realistic ranges
 */
function capEdge(edge) {
  // Cap edges between -0.25 and +0.25 (25%) to prevent unrealistic values
  return Math.max(-0.25, Math.min(0.25, edge))
}

/**
 * Calculate total probabilities using Poisson distribution
 */
function calculateTotalProbabilities(expectedTotal, marketTotal = null) {
  // Use Poisson distribution for more accurate total probabilities
  const lambda = expectedTotal
  
  // Calculate probability of going over common totals
  const totals = [6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11]
  let overProb = 0.5 // Default to 50%
  
  if (marketTotal) {
    // Calculate probability of going over the market total
    overProb = poissonOverProbability(lambda, marketTotal)
  } else {
    // Use expected total to estimate over probability
    if (lambda > 9) overProb = 0.65
    else if (lambda > 8) overProb = 0.55
    else if (lambda > 7) overProb = 0.50
    else if (lambda > 6) overProb = 0.45
    else overProb = 0.35
  }
  
  return {
    over: overProb,
    under: 1 - overProb
  }
}

/**
 * Calculate Poisson probability of going over a total
 */
function poissonOverProbability(lambda, total) {
  // Simplified Poisson calculation
  // In production, would use more sophisticated methods
  
  if (lambda <= 0) return 0.5
  
  // Use normal approximation for large lambda
  if (lambda > 10) {
    const z = (total - lambda) / Math.sqrt(lambda)
    return 1 - normalCDF(z)
  }
  
  // For smaller lambda, use direct Poisson calculation
  let prob = 0
  for (let k = Math.floor(total) + 1; k <= Math.floor(total) + 10; k++) {
    prob += poissonPMF(lambda, k)
  }
  
  return Math.max(0.1, Math.min(0.9, prob)) // Cap between 10% and 90%
}

/**
 * Poisson probability mass function
 */
function poissonPMF(lambda, k) {
  if (k < 0) return 0
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k)
}

/**
 * Factorial function
 */
function factorial(n) {
  if (n <= 1) return 1
  let result = 1
  for (let i = 2; i <= n; i++) {
    result *= i
  }
  return result
}

/**
 * Normal CDF approximation
 */
function normalCDF(z) {
  // Approximation of standard normal CDF
  return 0.5 * (1 + erf(z / Math.sqrt(2)))
}

/**
 * Error function approximation
 */
function erf(x) {
  // Abramowitz and Stegun approximation
  const a1 =  0.254829592
  const a2 = -0.284496736
  const a3 =  1.421413741
  const a4 = -1.453152027
  const a5 =  1.061405429
  const p  =  0.3275911

  const sign = x >= 0 ? 1 : -1
  x = Math.abs(x)

  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

  return sign * y
}

/**
 * Get opposing team defense adjustment
 */
function getOpposingDefenseAdjustment(oppTeam) {
  // Use team's runs allowed data if available
  if (oppTeam.avgPointsAllowedLast10) {
    const leagueAvgAllowed = 4.5
    const teamAllowed = oppTeam.avgPointsAllowedLast10
    // Convert to adjustment factor (0.95 to 1.05 range)
    return Math.max(0.95, Math.min(1.05, leagueAvgAllowed / teamAllowed))
  }
  
  // Fallback to very conservative team-specific adjustments
  const defenseAdjustments = {
    'LAD': 0.99, 'HOU': 1.00, 'ATL': 1.00, 'NYY': 1.00, 'TOR': 1.00,
    'OAK': 1.01, 'DET': 1.00, 'MIA': 1.00, 'KC': 1.00, 'WSH': 1.00
  }
  
  return defenseAdjustments[oppTeam.abbr] || 1.0
}

/**
 * Get recent form adjustment
 */
function getRecentFormAdjustment(team) {
  // Use recent performance data if available
  if (team.avgPointsLast10 && team.avgPointsAllowedLast10) {
    const leagueAvgRuns = 4.5
    const teamRuns = team.avgPointsLast10
    const teamAllowed = team.avgPointsAllowedLast10
    
    // Calculate run differential vs league average
    const runDiff = (teamRuns - leagueAvgRuns) - (teamAllowed - leagueAvgRuns)
    
    // Convert to adjustment factor (0.9 to 1.1 range)
    return 1.0 + (runDiff * 0.02)
  }
  
  return 1.0 // No recent data available
}

