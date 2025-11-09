// NFL/NHL Edge Calculation - Based on real team performance data
// Uses: Team records, recent form, home/away splits, head-to-head history

import { americanToImplied, removeMlVig, removeTotalVig } from './implied.js'

export const MODEL_VERSION = 'nfl-nhl-v0.1.0'

/**
 * Calculate game edges for NFL/NHL using team performance data
 * @param {object} game - Game data with teams
 * @param {object} odds - Odds data for the game
 * @returns {object} Edge calculations
 */
export function calculateNFLNHLEdges(game, odds) {
  const sport = game.sport?.toLowerCase()
  
  console.log(`\n📊 Calculating ${sport.toUpperCase()} edges for ${game.away?.abbr} @ ${game.home?.abbr}`)
  
  try {
    // Get market probabilities from odds
    const marketProbs = getMarketProbabilities(odds)
    
    if (!marketProbs.mlHome || !marketProbs.mlAway) {
      console.log('  ⚠️  No moneyline odds available')
      return createNullEdges()
    }
    
    // Calculate our win probabilities based on team data
    const ourProbs = calculateWinProbabilities(game.home, game.away, sport)
    
    console.log(`  Market: Home ${(marketProbs.mlHome * 100).toFixed(1)}% | Away ${(marketProbs.mlAway * 100).toFixed(1)}%`)
    console.log(`  Our Model: Home ${(ourProbs.homeWin * 100).toFixed(1)}% | Away ${(ourProbs.awayWin * 100).toFixed(1)}%`)
    
    // Calculate predicted total and over/under edges
    const totalsPrediction = predictGameTotal(game.home, game.away, sport)
    const totalsEdges = calculateTotalsEdges(totalsPrediction, marketProbs)
    
    if (totalsPrediction.predictedTotal) {
      console.log(`  Total: Our ${totalsPrediction.predictedTotal.toFixed(1)} vs Market ${marketProbs.total || 'N/A'}`)
    }
    
    // Calculate edges (our probability - market probability)
    const edges = {
      edgeMlHome: capEdge(ourProbs.homeWin - marketProbs.mlHome),
      edgeMlAway: capEdge(ourProbs.awayWin - marketProbs.mlAway),
      edgeTotalO: totalsEdges.overEdge,
      edgeTotalU: totalsEdges.underEdge,
      modelRun: MODEL_VERSION
    }
    
    // Only include edges if they're meaningful
    // ML: 2% threshold (more conservative for game outcomes)
    // Totals: 1% threshold (lower since scoring is more predictable)
    if (Math.abs(edges.edgeMlHome) < 0.02) edges.edgeMlHome = null
    if (Math.abs(edges.edgeMlAway) < 0.02) edges.edgeMlAway = null
    if (edges.edgeTotalO && Math.abs(edges.edgeTotalO) < 0.01) edges.edgeTotalO = null
    if (edges.edgeTotalU && Math.abs(edges.edgeTotalU) < 0.01) edges.edgeTotalU = null
    
    console.log(`  Edges: Home ${edges.edgeMlHome ? (edges.edgeMlHome * 100).toFixed(1) + '%' : 'none'} | Away ${edges.edgeMlAway ? (edges.edgeMlAway * 100).toFixed(1) + '%' : 'none'}`)
    if (edges.edgeTotalO || edges.edgeTotalU) {
      console.log(`  Totals: Over ${edges.edgeTotalO ? (edges.edgeTotalO * 100).toFixed(1) + '%' : 'none'} | Under ${edges.edgeTotalU ? (edges.edgeTotalU * 100).toFixed(1) + '%' : 'none'}`)
    }
    
    return edges
    
  } catch (error) {
    console.error('  ❌ Error calculating edges:', error.message)
    return createNullEdges()
  }
}

/**
 * Calculate win probabilities based on team performance data
 */
function calculateWinProbabilities(homeTeam, awayTeam, sport) {
  // Start with base home field advantage
  const homeAdvantage = sport === 'nfl' ? 0.03 : 0.02 // NFL has stronger HFA
  
  // Get team strength ratings (0-1 scale)
  const homeStrength = calculateTeamStrength(homeTeam, true, sport)
  const awayStrength = calculateTeamStrength(awayTeam, false, sport)
  
  console.log(`  Team Strength: Home ${(homeStrength * 100).toFixed(1)}% | Away ${(awayStrength * 100).toFixed(1)}%`)
  
  // Convert to win probability using logistic function
  const strengthDiff = homeStrength - awayStrength + homeAdvantage
  const homeWin = 1 / (1 + Math.exp(-8 * strengthDiff)) // Logistic with scale factor
  const awayWin = 1 - homeWin
  
  return {
    homeWin: Math.max(0.20, Math.min(0.80, homeWin)), // Cap between 20-80%
    awayWin: Math.max(0.20, Math.min(0.80, awayWin))
  }
}

/**
 * Calculate team strength rating based on available data
 * Returns a value between 0-1 (0.5 = average team)
 */
function calculateTeamStrength(team, isHome, sport) {
  if (!team) return 0.5
  
  let strength = 0.5 // Start at league average
  let factors = 0
  
  // Factor 1: Overall record (if available)
  const recordStrength = getRecordStrength(team, isHome)
  if (recordStrength !== null) {
    strength += (recordStrength - 0.5) * 0.4 // 40% weight
    factors++
  }
  
  // Factor 2: Recent form (last 10 games points)
  const recentForm = getRecentFormStrength(team, sport)
  if (recentForm !== null) {
    strength += (recentForm - 0.5) * 0.3 // 30% weight
    factors++
  }
  
  // Factor 3: Home/Away performance
  const venueStrength = getVenueStrength(team, isHome)
  if (venueStrength !== null) {
    strength += (venueStrength - 0.5) * 0.2 // 20% weight
    factors++
  }
  
  // Factor 4: Team rating (if we have it)
  const ratingStrength = getTeamRating(team, sport)
  if (ratingStrength !== null) {
    strength += (ratingStrength - 0.5) * 0.1 // 10% weight
    factors++
  }
  
  // If we have no data, return league average
  if (factors === 0) {
    console.log(`  ⚠️  No data for ${team.abbr}, using league average`)
    return 0.5
  }
  
  return Math.max(0.2, Math.min(0.8, strength)) // Cap between 20-80%
}

/**
 * Get strength from win/loss record
 */
function getRecordStrength(team, isHome) {
  try {
    let wins = 0
    let losses = 0
    
    // Parse home record (format: "5-2" or "5-2-1" for NHL with OT losses)
    if (team.homeRecord && isHome) {
      const parts = team.homeRecord.split('-').map(Number)
      if (!isNaN(parts[0]) && !isNaN(parts[1])) {
        wins = parts[0]
        losses = parts[1]
        // For NHL, also count OT losses (worth 0.5 point)
        if (parts[2] && !isNaN(parts[2])) {
          losses += parts[2] * 0.5 // OT losses count as half a loss
        }
      }
    }
    
    // Parse away record (format: "3-4" or "3-4-1")
    if (team.awayRecord && !isHome) {
      const parts = team.awayRecord.split('-').map(Number)
      if (!isNaN(parts[0]) && !isNaN(parts[1])) {
        wins = parts[0]
        losses = parts[1]
        if (parts[2] && !isNaN(parts[2])) {
          losses += parts[2] * 0.5
        }
      }
    }
    
    // If venue-specific not available, use overall record (last10Record)
    if (wins === 0 && losses === 0 && team.last10Record) {
      const parts = team.last10Record.split('-').map(Number)
      if (!isNaN(parts[0]) && !isNaN(parts[1])) {
        wins = parts[0]
        losses = parts[1]
        if (parts[2] && !isNaN(parts[2])) {
          losses += parts[2] * 0.5
        }
      }
    }
    
    if (wins + losses === 0) return null
    
    return wins / (wins + losses)
  } catch (error) {
    return null
  }
}

/**
 * Get strength from recent form (season average points per game)
 */
function getRecentFormStrength(team, sport) {
  try {
    // ESPN gives us TOTAL points, not per-game averages
    // We need to calculate games played and divide
    if (!team.avgPointsLast10 || !team.last10Record) return null
    
    // Calculate games played from record
    const parts = team.last10Record.split('-').map(Number)
    if (!parts[0] || !parts[1]) return null
    
    const gamesPlayed = parts[0] + parts[1] + (parts[2] || 0) // wins + losses + OT losses
    if (gamesPlayed === 0) return null
    
    // Calculate per-game average
    const teamAvg = team.avgPointsLast10 / gamesPlayed
    
    // Compare to league averages
    const leagueAvg = sport === 'nfl' ? 22 : 3 // NFL: ~22 ppg, NHL: ~3 gpg
    
    // Convert to 0-1 scale (relative to league average)
    // Team scoring 25% more than avg = 0.625 strength
    const ratio = teamAvg / leagueAvg
    return Math.max(0.2, Math.min(0.8, 0.5 + (ratio - 1) * 0.5))
  } catch (error) {
    return null
  }
}

/**
 * Get venue-specific strength
 */
function getVenueStrength(team, isHome) {
  try {
    const record = isHome ? team.homeRecord : team.awayRecord
    if (!record) return null
    
    const [wins, losses] = record.split('-').map(Number)
    if (isNaN(wins) || isNaN(losses) || wins + losses === 0) return null
    
    return wins / (wins + losses)
  } catch (error) {
    return null
  }
}

/**
 * Get team rating (if available in database)
 */
function getTeamRating(team, sport) {
  // Placeholder - could be populated with advanced metrics like:
  // - ELO rating
  // - Power rankings
  // - Expected win % based on point differential
  
  // For now, return null (not implemented)
  return null
}

/**
 * Predict game total based on team offensive and defensive performance
 */
function predictGameTotal(homeTeam, awayTeam, sport) {
  try {
    // Need points per game data for both teams
    if (!homeTeam.avgPointsLast10 || !homeTeam.last10Record ||
        !awayTeam.avgPointsLast10 || !awayTeam.last10Record ||
        !homeTeam.avgPointsAllowedLast10 || !awayTeam.avgPointsAllowedLast10) {
      return { predictedTotal: null, homeExpected: null, awayExpected: null }
    }
    
    // Calculate games played to get per-game averages
    const homeGames = calculateGamesPlayed(homeTeam.last10Record)
    const awayGames = calculateGamesPlayed(awayTeam.last10Record)
    
    if (homeGames === 0 || awayGames === 0) {
      return { predictedTotal: null, homeExpected: null, awayExpected: null }
    }
    
    // Calculate per-game averages
    const homeOffense = homeTeam.avgPointsLast10 / homeGames // Points scored per game
    const homeDefense = homeTeam.avgPointsAllowedLast10 / homeGames // Points allowed per game
    const awayOffense = awayTeam.avgPointsLast10 / awayGames
    const awayDefense = awayTeam.avgPointsAllowedLast10 / awayGames
    
    // Predict each team's score:
    // Home expected = average of (home offense, away defense)
    // Away expected = average of (away offense, home defense)
    const homeExpected = (homeOffense + awayDefense) / 2
    const awayExpected = (awayOffense + homeDefense) / 2
    
    // Add small home field scoring boost
    const homeBoost = sport === 'nfl' ? 1.5 : 0.2 // NFL: 1.5 pts, NHL: 0.2 goals
    const predictedTotal = homeExpected + awayExpected + homeBoost
    
    return {
      predictedTotal,
      homeExpected: homeExpected + homeBoost,
      awayExpected
    }
  } catch (error) {
    return { predictedTotal: null, homeExpected: null, awayExpected: null }
  }
}

/**
 * Calculate games played from record string
 */
function calculateGamesPlayed(record) {
  try {
    const parts = record.split('-').map(Number)
    if (!parts[0] || !parts[1]) return 0
    return parts[0] + parts[1] + (parts[2] || 0)
  } catch (error) {
    return 0
  }
}

/**
 * Calculate over/under edges based on predicted total vs market line
 */
function calculateTotalsEdges(prediction, marketProbs) {
  // If we don't have a prediction or market line, return null
  if (!prediction.predictedTotal || !marketProbs.total || 
      !marketProbs.totalOver || !marketProbs.totalUnder) {
    return { overEdge: null, underEdge: null }
  }
  
  const ourTotal = prediction.predictedTotal
  const marketTotal = marketProbs.total
  const diff = ourTotal - marketTotal
  
  // If our predicted total is significantly higher than market, Over has edge
  // If our predicted total is significantly lower than market, Under has edge
  
  // Use a sigmoid function to convert point difference to probability shift
  // For NFL: 3 point difference = moderate edge, 7+ = strong edge
  // For NHL: 0.3 goal difference = moderate edge, 0.7+ = strong edge
  
  let overEdge = null
  let underEdge = null
  
  if (diff > 0.3) {
    // Our total is higher than market - Over has edge
    // Calculate edge as a function of the difference
    const edgeStrength = Math.min(0.12, Math.abs(diff) * 0.03) // 3% per point/goal difference, cap at 12%
    overEdge = capEdge(edgeStrength)
    underEdge = capEdge(-edgeStrength)
  } else if (diff < -0.3) {
    // Our total is lower than market - Under has edge
    const edgeStrength = Math.min(0.12, Math.abs(diff) * 0.03)
    underEdge = capEdge(edgeStrength)
    overEdge = capEdge(-edgeStrength)
  }
  
  // Apply minimum threshold (1% for totals - lower than ML since scoring is more predictable)
  if (overEdge && Math.abs(overEdge) < 0.01) overEdge = null
  if (underEdge && Math.abs(underEdge) < 0.01) underEdge = null
  
  return { overEdge, underEdge }
}

/**
 * Extract market probabilities from odds
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
  
  // Find h2h odds
  const h2hOdds = odds.filter(o => o.market === 'h2h')
  const totalOdds = odds.filter(o => o.market === 'totals')
  
  let mlProbs = { mlHome: null, mlAway: null }
  if (h2hOdds.length > 0) {
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
 * Cap edge values to realistic ranges (-10% to +10%)
 */
function capEdge(edge) {
  if (edge === null || isNaN(edge)) return null
  return Math.max(-0.10, Math.min(0.10, edge))
}

/**
 * Create null edges object
 */
function createNullEdges() {
  return {
    edgeMlHome: null,
    edgeMlAway: null,
    edgeTotalO: null,
    edgeTotalU: null,
    modelRun: MODEL_VERSION
  }
}

