/**
 * Sport-specific thresholds for prop filtering and team performance evaluation
 * These values are based on league averages and statistical analysis
 */

export const SPORT_THRESHOLDS = {
  nfl: {
    // Scoring thresholds
    hotOffense: 28,           // Points per game - top tier offense
    averageOffense: 22,       // League average
    coldOffense: 18,          // Below average offense
    
    weakDefense: 26,          // Points allowed per game - exploitable
    averageDefense: 22,       // League average defense
    strongDefense: 18,        // Elite defense
    
    // Game totals
    highScoringGame: 48,      // Expected total for offensive showcase
    averageTotal: 44,         // Typical NFL game
    lowScoringGame: 40,       // Defensive battle
    
    // Win probability
    dominantTeam: 0.65,       // 65%+ win probability
    favoredTeam: 0.55,        // 55%+ win probability
    competitive: 0.45,        // 45-55% (coin flip)
    
    // Recent form (last 10 games)
    hotRecord: 0.70,          // 7-3 or better
    averageRecord: 0.50,      // 5-5
    coldRecord: 0.30,         // 3-7 or worse
    
    // Venue splits
    strongHome: 0.65,         // 65%+ home win rate
    strongAway: 0.55,         // 55%+ away win rate
    
    // Display labels
    displayUnit: 'PPG',
    scoreType: 'points'
  },
  
  nhl: {
    // Scoring thresholds (GOALS per game)
    hotOffense: 3.5,          // Goals per game - elite offense
    averageOffense: 3.0,      // League average
    coldOffense: 2.5,         // Below average offense
    
    weakDefense: 3.5,         // Goals allowed per game - exploitable
    averageDefense: 3.0,      // League average defense
    strongDefense: 2.5,       // Elite defense
    
    // Game totals (GOALS)
    highScoringGame: 6.5,     // Expected total for offensive showcase
    averageTotal: 6.0,        // Typical NHL game
    lowScoringGame: 5.5,      // Defensive battle
    
    // Win probability (same as NFL)
    dominantTeam: 0.65,       // 65%+ win probability
    favoredTeam: 0.55,        // 55%+ win probability
    competitive: 0.45,        // 45-55% (coin flip)
    
    // Recent form (last 10 games)
    hotRecord: 0.70,          // 7-3 or better (counting OT losses as 0.5)
    averageRecord: 0.50,      // 5-5
    coldRecord: 0.30,         // 3-7 or worse
    
    // Venue splits
    strongHome: 0.65,         // 65%+ home win rate
    strongAway: 0.55,         // 55%+ away win rate
    
    // Display labels
    displayUnit: 'GPG',
    scoreType: 'goals'
  },
  
  mlb: {
    // Scoring thresholds (RUNS per game)
    hotOffense: 5.5,          // Runs per game - elite offense
    averageOffense: 4.5,      // League average
    coldOffense: 3.5,         // Below average offense
    
    weakDefense: 5.0,         // Runs allowed per game - exploitable
    averageDefense: 4.5,      // League average defense
    strongDefense: 3.5,       // Elite defense
    
    // Game totals (RUNS)
    highScoringGame: 9.5,     // Expected total for offensive showcase
    averageTotal: 8.5,        // Typical MLB game
    lowScoringGame: 7.5,      // Pitcher's duel
    
    // Win probability (same as others)
    dominantTeam: 0.65,       // 65%+ win probability
    favoredTeam: 0.55,        // 55%+ win probability
    competitive: 0.45,        // 45-55% (coin flip)
    
    // Recent form (last 10 games)
    hotRecord: 0.70,          // 7-3 or better
    averageRecord: 0.50,      // 5-5
    coldRecord: 0.30,         // 3-7 or worse
    
    // Venue splits
    strongHome: 0.60,         // 60%+ home win rate (less home advantage in MLB)
    strongAway: 0.50,         // 50%+ away win rate
    
    // Display labels
    displayUnit: 'RPG',
    scoreType: 'runs'
  }
}

/**
 * Get thresholds for a specific sport
 * @param {string} sport - 'nfl', 'nhl', or 'mlb'
 * @returns {object} Sport-specific thresholds
 */
export function getThresholds(sport) {
  const normalizedSport = sport?.toLowerCase()
  return SPORT_THRESHOLDS[normalizedSport] || SPORT_THRESHOLDS.nfl
}

/**
 * Check if a team has a hot offense
 * @param {number} pointsPerGame - Team's scoring average
 * @param {string} sport - Sport type
 * @returns {boolean} True if offense is hot
 */
export function isHotOffense(pointsPerGame, sport) {
  const thresholds = getThresholds(sport)
  return pointsPerGame >= thresholds.hotOffense
}

/**
 * Check if opponent has weak defense (good for props)
 * @param {number} pointsAllowed - Opponent's defensive average
 * @param {string} sport - Sport type
 * @returns {boolean} True if defense is weak
 */
export function isWeakDefense(pointsAllowed, sport) {
  const thresholds = getThresholds(sport)
  return pointsAllowed >= thresholds.weakDefense
}

/**
 * Check if game is expected to be high scoring
 * @param {number} expectedTotal - Expected game total
 * @param {string} sport - Sport type
 * @returns {boolean} True if high scoring expected
 */
export function isHighScoringGame(expectedTotal, sport) {
  const thresholds = getThresholds(sport)
  return expectedTotal >= thresholds.highScoringGame
}

/**
 * Get offensive rating (0-100 scale)
 * @param {number} pointsPerGame - Team's scoring average
 * @param {string} sport - Sport type
 * @returns {number} Rating from 0-100
 */
export function getOffensiveRating(pointsPerGame, sport) {
  const thresholds = getThresholds(sport)
  
  if (pointsPerGame >= thresholds.hotOffense) {
    // Elite offense: 80-100 rating
    const excess = pointsPerGame - thresholds.hotOffense
    const maxExcess = thresholds.hotOffense * 0.3 // 30% above hot threshold
    return Math.min(100, 80 + (excess / maxExcess) * 20)
  } else if (pointsPerGame >= thresholds.averageOffense) {
    // Above average: 60-80 rating
    const range = thresholds.hotOffense - thresholds.averageOffense
    const position = (pointsPerGame - thresholds.averageOffense) / range
    return 60 + (position * 20)
  } else if (pointsPerGame >= thresholds.coldOffense) {
    // Below average: 40-60 rating
    const range = thresholds.averageOffense - thresholds.coldOffense
    const position = (pointsPerGame - thresholds.coldOffense) / range
    return 40 + (position * 20)
  } else {
    // Cold offense: 0-40 rating
    const position = pointsPerGame / thresholds.coldOffense
    return Math.max(0, position * 40)
  }
}

/**
 * Get defensive rating (0-100 scale, higher = worse defense = better for props)
 * @param {number} pointsAllowed - Team's defensive average
 * @param {string} sport - Sport type
 * @returns {number} Rating from 0-100 (100 = worst defense = best for props)
 */
export function getDefensiveVulnerability(pointsAllowed, sport) {
  const thresholds = getThresholds(sport)
  
  if (pointsAllowed >= thresholds.weakDefense) {
    // Weak defense: 80-100 rating (GOOD for props)
    const excess = pointsAllowed - thresholds.weakDefense
    const maxExcess = thresholds.weakDefense * 0.3
    return Math.min(100, 80 + (excess / maxExcess) * 20)
  } else if (pointsAllowed >= thresholds.averageDefense) {
    // Average defense: 60-80 rating
    const range = thresholds.weakDefense - thresholds.averageDefense
    const position = (pointsAllowed - thresholds.averageDefense) / range
    return 60 + (position * 20)
  } else if (pointsAllowed >= thresholds.strongDefense) {
    // Strong defense: 40-60 rating
    const range = thresholds.averageDefense - thresholds.strongDefense
    const position = (pointsAllowed - thresholds.strongDefense) / range
    return 40 + (position * 20)
  } else {
    // Elite defense: 0-40 rating (BAD for props)
    const position = pointsAllowed / thresholds.strongDefense
    return Math.max(0, position * 40)
  }
}

/**
 * Format points per game with correct unit for sport
 * @param {number} ppg - Points/goals per game
 * @param {string} sport - Sport type
 * @param {number} decimals - Decimal places (default 1)
 * @returns {string} Formatted string (e.g., "28.5 PPG" or "3.5 GPG")
 */
export function formatPointsPerGame(ppg, sport, decimals = 1) {
  const thresholds = getThresholds(sport)
  return `${ppg.toFixed(decimals)} ${thresholds.displayUnit}`
}

/**
 * Get team context quality score (0-100)
 * Combines offensive power, defensive matchup, win probability, and form
 * @param {object} teamContext - Team context data
 * @returns {number} Quality score 0-100
 */
export function calculateTeamContextScore(teamContext) {
  const {
    offensivePower,
    defensiveMatchup,
    winProbability,
    recentForm,
    venueAdvantage,
    sport
  } = teamContext
  
  const offenseRating = getOffensiveRating(offensivePower, sport)
  const defenseRating = getDefensiveVulnerability(defensiveMatchup, sport)
  const winProb = winProbability * 100
  const formRating = recentForm * 100
  const venueRating = venueAdvantage * 100
  
  // Weighted average
  const score = (
    offenseRating * 0.30 +    // 30% offensive power
    defenseRating * 0.25 +    // 25% defensive matchup
    winProb * 0.25 +          // 25% win probability
    formRating * 0.15 +       // 15% recent form
    venueRating * 0.05        // 5% venue advantage
  )
  
  return Math.round(score)
}

export default {
  SPORT_THRESHOLDS,
  getThresholds,
  isHotOffense,
  isWeakDefense,
  isHighScoringGame,
  getOffensiveRating,
  getDefensiveVulnerability,
  formatPointsPerGame,
  calculateTeamContextScore
}

