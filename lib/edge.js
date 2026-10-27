// Core matchup modeling and edge calculation engine

import { americanToImplied, removeMlVig, removeTotalVig, normalizeToAmericanOdds } from './implied.js'

// Model version for tracking. Bump when MLB game-total math or skip rules change.
export const MODEL_VERSION = 'v0.2.0'

const LEAGUE_AVG_RUNS = 4.4
// r=5 ≈ 2x Poisson variance at 4.4 runs. Independent team scores understate
// the variance of the game total; calibrate later against stored finals.
const TEAM_NB_R = 5
const NB_SUPPORT_MAX = 40
const PROB_CLAMP_MIN = 0.1
const PROB_CLAMP_MAX = 0.9
const MAX_MODEL_LINE_GAP = 1.0
const EDGE_CAP = 0.08

const PARK_FACTORS = {
  COL: 1.20, CIN: 1.10, BOS: 1.08, CHC: 1.07, PHI: 1.06,
  BAL: 1.05, TEX: 1.05, TOR: 1.04, MIL: 1.04, ARI: 1.03,
  ATL: 1.01, CWS: 1.01, KC: 1.00, LAA: 1.00, MIN: 1.00,
  NYY: 1.00, WSH: 1.00, CLE: 0.99, STL: 0.99, DET: 0.98,
  PIT: 0.97, TB: 0.97, MIA: 0.96, LAD: 0.96, NYM: 0.95,
  SF: 0.94, OAK: 0.94, SEA: 0.93, SD: 0.92,
}

function skippedEdges(reason, extra = {}) {
  console.log(`Skipping MLB edge: ${reason}`)
  return {
    edgeMlHome: null,
    edgeMlAway: null,
    edgeTotalO: null,
    edgeTotalU: null,
    ourTotal: extra.ourTotal ?? null,
    marketTotal: extra.marketTotal ?? null,
    modelRun: MODEL_VERSION,
    skipped: true,
    skipReason: reason,
  }
}

/**
 * Calculate team run expectancy and game edges
 * @param {object} game - Game data with teams and pitchers
 * @param {object} odds - Odds data for the game
 * @param {object} playerData - Additional player stats (for future enhancement)
 * @returns {object} Edge calculations and predictions
 */
export function calculateGameEdges(game, odds, playerData = {}) {
  // Log game info for debugging
  console.log(`Calculating edges for ${game.away.abbr} @ ${game.home.abbr}`);
  if (game.probableHomePitcher) {
    console.log(`Home pitcher: ${game.probableHomePitcher.fullName}`);
  }
  if (game.probableAwayPitcher) {
    console.log(`Away pitcher: ${game.probableAwayPitcher.fullName}`);
  }
  try {
    const homePitcher = game.probableHomePitcher || null
    const awayPitcher = game.probableAwayPitcher || null
    if (!homePitcher || !awayPitcher) {
      return skippedEdges('missing_probable_pitcher')
    }

    const marketProbs = getMarketProbabilities(odds)

    // Both teams play in the home park. Do not use the away team's own park.
    const parkFactor = resolveParkFactor(game.home)
    const homeRuns = calculateTeamRuns(game.home, game.away, awayPitcher, true, parkFactor)
    const awayRuns = calculateTeamRuns(game.away, game.home, homePitcher, false, parkFactor)

    const ourTotal = homeRuns + awayRuns
    const gameProbs = runsToWinProbability(homeRuns, awayRuns, marketProbs.total)
    // Clamp skip must run even when |model-line| > 1, otherwise it is
    // unreachable (a 1-run gap never pushes NB over/under to 0.1/0.9).
    if (gameProbs.clamped) {
      return skippedEdges('probability_clamp', { ourTotal, marketTotal: marketProbs.total })
    }
    if (marketProbs.total != null && Math.abs(ourTotal - marketProbs.total) > MAX_MODEL_LINE_GAP) {
      return skippedEdges('model_line_gap', { ourTotal, marketTotal: marketProbs.total })
    }

    return {
      edgeMlHome: marketProbs.mlHome ? capEdge((gameProbs.homeWin - marketProbs.mlHome)) : null,
      edgeMlAway: marketProbs.mlAway ? capEdge((gameProbs.awayWin - marketProbs.mlAway)) : null,
      edgeTotalO: marketProbs.totalOver ? capEdge((gameProbs.over - marketProbs.totalOver)) : null,
      edgeTotalU: marketProbs.totalUnder ? capEdge((gameProbs.under - marketProbs.totalUnder)) : null,
      ourTotal,
      marketTotal: marketProbs.total,
      modelRun: MODEL_VERSION,
      skipped: false,
      skipReason: null,
    }
  } catch (error) {
    console.error('Error calculating game edges:', error)
    return {
      edgeMlHome: null,
      edgeMlAway: null,
      edgeTotalO: null,
      edgeTotalU: null,
      ourTotal: null,
      marketTotal: null,
      modelRun: MODEL_VERSION,
      skipped: true,
      skipReason: 'error',
    }
  }
}

function resolveParkFactor(homeTeam) {
  if (homeTeam?.parkFactor != null) return homeTeam.parkFactor
  return PARK_FACTORS[homeTeam?.abbr] || 1.0
}

/**
 * Calculate expected runs for a team
 * @param {object} team - Team data
 * @param {object} oppTeam - Opposing team data
 * @param {object} oppPitcher - Opposing pitcher data
 * @param {boolean} isHome - Is this the home team
 * @param {number} parkFactor - Home-park factor applied to both sides
 * @returns {number} Expected runs
 */
function calculateTeamRuns(team, oppTeam, oppPitcher, isHome, parkFactor) {
  // Neutral baseline is 4.4 per side (8.8 total). The old 4.5 + 0.1 home
  // bump produced a 9.1 neutral / ~9.46 MIL total and a ~+6.7% over bias
  // vs a -110/-110 8.5 line. isHome is kept for call-site clarity only.
  let baseRuns = LEAGUE_AVG_RUNS

  baseRuns *= parkFactor || 1.0

  const teamOffenseAdjustment = getTeamOffenseAdjustment(team)
  baseRuns *= teamOffenseAdjustment

  const oppDefenseAdjustment = getOpposingDefenseAdjustment(oppTeam)
  baseRuns *= oppDefenseAdjustment

  if (oppPitcher) {
    baseRuns *= getPitcherQualityAdjustment(oppPitcher)
  }

  // Recent form is omitted: avgPointsLast10 is already in getTeamOffenseAdjustment,
  // and mixing in this team's runs allowed would cancel the defense-direction fix.

  return Math.max(baseRuns, 0.5)
}

/**
 * Get pitcher quality adjustment based on actual stats
 * @param {object} pitcher - Pitcher data
 * @returns {number} Adjustment factor (0.8-1.2)
 */
function getPitcherQualityAdjustment(pitcher) {
  // Default to neutral if no pitcher data
  if (!pitcher) return 1.0;
  
  let adjustment = 1.0;
  
  // Use pitcher stats if available in splits
  if (pitcher.splits && pitcher.splits.length > 0) {
    // Get the most recent season stats
    const recentStats = pitcher.splits.sort((a, b) => b.season - a.season)[0];
    
    // Adjust based on K% (strikeout rate)
    if (recentStats.kRate) {
      // League average K% is around 22%
      const kRateAdjustment = (recentStats.kRate - 0.22) * 0.5;
      adjustment -= kRateAdjustment; // Higher K% means lower runs allowed
    }
    
    // Adjust based on BB% (walk rate)
    if (recentStats.bbRate) {
      // League average BB% is around 8%
      const bbRateAdjustment = (recentStats.bbRate - 0.08) * 0.7;
      adjustment += bbRateAdjustment; // Higher BB% means more runs allowed
    }
    
    // Adjust based on wOBA allowed
    if (recentStats.wOBA) {
      // League average wOBA is around .320
      const wobaAdjustment = (recentStats.wOBA - 0.320) * 0.8;
      adjustment += wobaAdjustment; // Higher wOBA means more runs allowed
    }
  }
  
  // Cap adjustment to reasonable range (0.8-1.2)
  return Math.max(0.8, Math.min(1.2, adjustment));
}

/**
 * Get team offense adjustment based on team stats
 * @param {object} team - Team data
 * @returns {number} Adjustment factor (0.8-1.2)
 */
function getTeamOffenseAdjustment(team) {
  // Use available team performance data if present
  if (team.avgPointsLast10) {
    const leagueAvgRuns = LEAGUE_AVG_RUNS;
    const teamRuns = team.avgPointsLast10;
    // Convert to adjustment factor (0.9 to 1.1 range)
    return Math.max(0.9, Math.min(1.1, teamRuns / leagueAvgRuns));
  }
  
  // Use team record to estimate offensive strength
  if (team.homeRecord || team.awayRecord) {
    let wins = 0;
    let losses = 0;
    
    // Parse home record (format: "45-36")
    if (team.homeRecord) {
      const [homeWins, homeLosses] = team.homeRecord.split('-').map(Number);
      wins += homeWins || 0;
      losses += homeLosses || 0;
    }
    
    // Parse away record (format: "42-39")
    if (team.awayRecord) {
      const [awayWins, awayLosses] = team.awayRecord.split('-').map(Number);
      wins += awayWins || 0;
      losses += awayLosses || 0;
    }
    
    // Calculate win percentage and convert to adjustment
    if (wins + losses > 0) {
      const winPct = wins / (wins + losses);
      // League average is .500
      // Scale to adjustment factor (0.95 to 1.05 range)
      return 1.0 + (winPct - 0.5) * 0.1;
    }
  }
  
  // Enhanced team-specific adjustments based on 2025 projected strength
  const teamAdjustments = {
    // Strong offensive teams
    'LAD': 1.05, 'HOU': 1.04, 'ATL': 1.04, 'NYY': 1.04, 'TOR': 1.03, 
    'PHI': 1.03, 'TEX': 1.03, 'BOS': 1.02, 'SD': 1.02, 'SEA': 1.02,
    
    // Average offensive teams
    'CHC': 1.00, 'CIN': 1.00, 'CLE': 1.00, 'STL': 1.00, 'TB': 1.00,
    'ARI': 1.00, 'MIN': 1.00, 'MIL': 1.00, 'NYM': 1.00, 'SF': 1.00,
    
    // Below average offensive teams
    'OAK': 0.97, 'DET': 0.98, 'MIA': 0.98, 'KC': 0.98, 'WSH': 0.98,
    'PIT': 0.97, 'COL': 0.97, 'BAL': 0.96, 'CWS': 0.96, 'LAA': 0.95
  };
  
  return teamAdjustments[team.abbr] || 1.0;
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
  
  const gameTotal = homeRuns + awayRuns
  const totalProbs = calculateTotalProbabilities(homeRuns, awayRuns, marketTotal)

  return {
    homeWin,
    awayWin,
    over: totalProbs.over,
    under: totalProbs.under,
    clamped: totalProbs.clamped,
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
      const homeOdds = normalizeToAmericanOdds(bestH2h.priceHome)
      const awayOdds = normalizeToAmericanOdds(bestH2h.priceAway)
      const fairOdds = removeMlVig(homeOdds, awayOdds)
      mlProbs.mlHome = fairOdds.homeFairProb
      mlProbs.mlAway = fairOdds.awayFairProb
    }
  }
  
  let totalProbs = { totalOver: null, totalUnder: null, total: null }
  if (totalOdds.length > 0) {
    const bestTotal = totalOdds[0]
    if (bestTotal.priceHome && bestTotal.priceAway && bestTotal.total) {
      const overOdds = normalizeToAmericanOdds(bestTotal.priceAway)
      const underOdds = normalizeToAmericanOdds(bestTotal.priceHome)
      const fairOdds = removeTotalVig(overOdds, underOdds, bestTotal.total)
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
  return Math.max(-EDGE_CAP, Math.min(EDGE_CAP, edge))
}

function negativeBinomialPmf(mean, r, maxK) {
  const mu = Math.max(mean, 1e-9)
  const p = r / (r + mu)
  const fail = 1 - p
  const pmf = new Array(maxK + 1)
  pmf[0] = Math.pow(p, r)
  for (let k = 1; k <= maxK; k++) {
    pmf[k] = pmf[k - 1] * ((k + r - 1) / k) * fail
  }
  return pmf
}

function convolve(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      out[i + j] += a[i] * b[j]
    }
  }
  return out
}

/**
 * Negative-binomial game total: each team r=5, independent, convolved.
 * Push mass P(total = L) is excluded, then over/under are renormalized.
 * Exported for unit tests.
 */
export function calculateTotalProbabilities(homeRuns, awayRuns, marketTotal = null) {
  if (marketTotal == null) {
    return { over: 0.5, under: 0.5, push: 0, clamped: false }
  }

  const homePmf = negativeBinomialPmf(homeRuns, TEAM_NB_R, NB_SUPPORT_MAX)
  const awayPmf = negativeBinomialPmf(awayRuns, TEAM_NB_R, NB_SUPPORT_MAX)
  const totalPmf = convolve(homePmf, awayPmf)

  let over = 0
  let under = 0
  let push = 0
  for (let k = 0; k < totalPmf.length; k++) {
    if (k > marketTotal) over += totalPmf[k]
    else if (k < marketTotal) under += totalPmf[k]
    else push += totalPmf[k]
  }

  const mass = over + under + push
  const tail = Math.max(0, 1 - mass)
  if (totalPmf.length - 1 > marketTotal) over += tail
  else if (totalPmf.length - 1 < marketTotal) under += tail

  const denom = over + under
  if (denom <= 0) {
    return { over: 0.5, under: 0.5, push, clamped: false }
  }

  let overN = over / denom
  let underN = under / denom
  let clamped = false
  if (overN < PROB_CLAMP_MIN) {
    overN = PROB_CLAMP_MIN
    underN = 1 - overN
    clamped = true
  } else if (overN > PROB_CLAMP_MAX) {
    overN = PROB_CLAMP_MAX
    underN = 1 - overN
    clamped = true
  }

  return { over: overN, under: underN, push, clamped }
}

/**
 * Get opposing team defense adjustment based on team stats
 * @param {object} oppTeam - Opposing team data
 * @returns {number} Adjustment factor (0.9-1.1)
 */
function getOpposingDefenseAdjustment(oppTeam) {
  // Use team's runs allowed data if available
  if (oppTeam.avgPointsAllowedLast10) {
    const leagueAvgAllowed = LEAGUE_AVG_RUNS;
    const teamAllowed = oppTeam.avgPointsAllowedLast10;
    // More runs allowed → opponent scores more. Previously inverted (league/allowed).
    return Math.max(0.95, Math.min(1.05, teamAllowed / leagueAvgAllowed));
  }
  
  // Use team record to estimate defensive strength
  if (oppTeam.homeRecord || oppTeam.awayRecord) {
    let wins = 0;
    let losses = 0;
    
    // Parse home record (format: "45-36")
    if (oppTeam.homeRecord) {
      const [homeWins, homeLosses] = oppTeam.homeRecord.split('-').map(Number);
      wins += homeWins || 0;
      losses += homeLosses || 0;
    }
    
    // Parse away record (format: "42-39")
    if (oppTeam.awayRecord) {
      const [awayWins, awayLosses] = oppTeam.awayRecord.split('-').map(Number);
      wins += awayWins || 0;
      losses += awayLosses || 0;
    }
    
    // Calculate win percentage and convert to adjustment
    if (wins + losses > 0) {
      const winPct = wins / (wins + losses);
      // League average is .500
      // Scale to adjustment factor (0.97 to 1.03 range)
      // Better teams (higher win %) allow fewer runs, so we invert the relationship
      return 1.0 - (winPct - 0.5) * 0.06;
    }
  }
  
  // Enhanced team-specific adjustments based on 2025 projected pitching/defense strength
  const defenseAdjustments = {
    // Strong defensive teams (lower adjustment = fewer runs allowed)
    'LAD': 0.95, 'HOU': 0.96, 'ATL': 0.96, 'NYY': 0.96, 'SD': 0.97,
    'SEA': 0.97, 'CLE': 0.97, 'TB': 0.98, 'MIL': 0.98, 'MIN': 0.98,
    
    // Average defensive teams
    'TOR': 1.00, 'PHI': 1.00, 'STL': 1.00, 'CHC': 1.00, 'BOS': 1.00,
    'ARI': 1.00, 'SF': 1.00, 'NYM': 1.00, 'CIN': 1.00, 'TEX': 1.00,
    
    // Below average defensive teams (higher adjustment = more runs allowed)
    'DET': 1.02, 'MIA': 1.02, 'KC': 1.02, 'WSH': 1.03, 'PIT': 1.03,
    'OAK': 1.04, 'BAL': 1.04, 'COL': 1.05, 'CWS': 1.05, 'LAA': 1.05
  };
  
  return defenseAdjustments[oppTeam.abbr] || 1.0;
}

