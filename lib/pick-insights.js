// Generate contextual insights and summaries for picks
// Uses team stats, recent form, matchup history to help users make informed decisions

import { supabase } from './supabase.js'

/**
 * Generate comprehensive insights for a game pick
 * @param {object} pick - The pick object (moneyline or total)
 * @param {object} game - Full game data with team stats
 * @returns {object} Insights with summary, key factors, and confidence reasoning
 */
export async function generatePickInsights(pick, game) {
  const insights = {
    summary: '',
    keyFactors: [],
    recentForm: {},
    matchupEdge: '',
    modelConfidence: '',
    riskFactors: []
  }
  
  try {
    // Generate different insights based on pick type
    if (pick.type === 'moneyline') {
      return await generateMoneylineInsights(pick, game)
    } else if (pick.type === 'total') {
      return await generateTotalsInsights(pick, game)
    } else if (pick.type === 'player_prop') {
      return await generatePlayerPropInsights(pick, game)
    }
    
    return insights
  } catch (error) {
    console.error('Error generating pick insights:', error)
    return insights
  }
}

/**
 * Generate insights for moneyline picks
 */
async function generateMoneylineInsights(pick, game) {
  const insights = {
    summary: '',
    keyFactors: [],
    recentForm: {},
    matchupEdge: '',
    modelConfidence: '',
    riskFactors: []
  }
  
  const isHomePick = pick.pick === game.home?.abbr
  const pickedTeam = isHomePick ? game.home : game.away
  const opponent = isHomePick ? game.away : game.home
  
  // Parse records
  const pickedRecord = parseRecord(pickedTeam?.last10Record)
  const opponentRecord = parseRecord(opponent?.last10Record)
  
  // Calculate recent form
  const pickedWinPct = pickedRecord.total > 0 ? (pickedRecord.wins / pickedRecord.total * 100).toFixed(0) : 50
  const opponentWinPct = opponentRecord.total > 0 ? (opponentRecord.wins / opponentRecord.total * 100).toFixed(0) : 50
  
  // Build summary
  const edge = ((pick.edge || 0) * 100).toFixed(1)
  const prob = ((pick.probability || 0.5) * 100).toFixed(0)
  
  insights.summary = `Our model gives ${pick.pick} a ${prob}% chance to win with a ${edge}% betting edge. `
  
  // Recent form analysis
  if (pickedWinPct >= 60) {
    insights.summary += `${pick.pick} is hot, winning ${pickedWinPct}% of recent games. `
    insights.keyFactors.push(`🔥 Strong recent form (${pickedRecord.wins}-${pickedRecord.losses}${pickedRecord.otl > 0 ? `-${pickedRecord.otl}` : ''})`)
  } else if (pickedWinPct <= 40) {
    insights.summary += `${pick.pick} has struggled recently (${pickedWinPct}% win rate). `
    insights.riskFactors.push(`⚠️ Poor recent form (${pickedRecord.wins}-${pickedRecord.losses}${pickedRecord.otl > 0 ? `-${pickedRecord.otl}` : ''})`)
  }
  
  // Home/away edge
  if (isHomePick) {
    const homeRecord = parseRecord(pickedTeam?.homeRecord)
    const homeWinPct = homeRecord.total > 0 ? (homeRecord.wins / homeRecord.total * 100).toFixed(0) : 50
    if (homeWinPct >= 65) {
      insights.keyFactors.push(`🏠 Dominant at home (${homeRecord.wins}-${homeRecord.losses})`)
    } else if (homeWinPct <= 35) {
      insights.riskFactors.push(`⚠️ Struggles at home (${homeRecord.wins}-${homeRecord.losses})`)
    }
  } else {
    const awayRecord = parseRecord(pickedTeam?.awayRecord)
    const awayWinPct = awayRecord.total > 0 ? (awayRecord.wins / awayRecord.total * 100).toFixed(0) : 50
    if (awayWinPct >= 60) {
      insights.keyFactors.push(`✈️ Strong road team (${awayRecord.wins}-${awayRecord.losses})`)
    } else if (awayWinPct <= 30) {
      insights.riskFactors.push(`⚠️ Poor road record (${awayRecord.wins}-${awayRecord.losses})`)
    }
  }
  
  // Offensive/Defensive advantage
  const pickedOffense = calculatePPG(pickedTeam)
  const pickedDefense = calculatePPG(pickedTeam, true)
  const oppOffense = calculatePPG(opponent)
  const oppDefense = calculatePPG(opponent, true)
  
  if (pickedOffense && oppDefense && pickedOffense > oppDefense * 1.15) {
    insights.keyFactors.push(`⚔️ Offensive advantage (${pickedOffense.toFixed(1)} ppg vs ${oppDefense.toFixed(1)} allowed)`)
  }
  
  if (pickedDefense && oppOffense && pickedDefense < oppOffense * 0.85) {
    insights.keyFactors.push(`🛡️ Defensive edge (${pickedDefense.toFixed(1)} allowed vs ${oppOffense.toFixed(1)} ppg)`)
  }
  
  // Model confidence explanation
  if (pick.edge >= 0.08) {
    insights.modelConfidence = `Very High - Our model sees significant value in this line`
  } else if (pick.edge >= 0.05) {
    insights.modelConfidence = `High - Strong edge identified based on team performance`
  } else if (pick.edge >= 0.03) {
    insights.modelConfidence = `Moderate - Solid pick with reasonable edge`
  } else {
    insights.modelConfidence = `Low - Small edge, consider skipping`
  }
  
  // Matchup edge summary
  const recordDiff = pickedWinPct - opponentWinPct
  if (Math.abs(recordDiff) >= 20) {
    insights.matchupEdge = `${pick.pick} has a ${Math.abs(recordDiff).toFixed(0)}% better win rate than ${opponent?.abbr}`
  } else {
    insights.matchupEdge = `Evenly matched teams with similar recent performance`
  }
  
  return insights
}

/**
 * Generate insights for totals (over/under) picks
 */
async function generateTotalsInsights(pick, game) {
  const insights = {
    summary: '',
    keyFactors: [],
    recentForm: {},
    matchupEdge: '',
    modelConfidence: '',
    riskFactors: []
  }
  
  const isOver = pick.pick === 'over'
  const threshold = pick.threshold
  const edge = ((pick.edge || 0) * 100).toFixed(1)
  const prob = ((pick.probability || 0.5) * 100).toFixed(0)
  
  // Calculate team scoring averages
  const homeOffense = calculatePPG(game.home)
  const homeDefense = calculatePPG(game.home, true)
  const awayOffense = calculatePPG(game.away)
  const awayDefense = calculatePPG(game.away, true)
  
  const predictedTotal = homeOffense && awayOffense ? homeOffense + awayOffense : null
  
  // Build summary
  insights.summary = `Our model predicts ${predictedTotal ? predictedTotal.toFixed(1) : 'a total'} points/goals. `
  insights.summary += `We recommend ${isOver ? 'OVER' : 'UNDER'} ${threshold} with ${prob}% confidence and ${edge}% edge. `
  
  if (isOver) {
    // Factors supporting OVER
    if (homeOffense && homeOffense > 25) { // NFL: 25+ ppg is high
      insights.keyFactors.push(`⚔️ ${game.home?.abbr} high-powered offense (${homeOffense.toFixed(1)} ppg)`)
    }
    if (awayOffense && awayOffense > 25) {
      insights.keyFactors.push(`⚔️ ${game.away?.abbr} high-powered offense (${awayOffense.toFixed(1)} ppg)`)
    }
    if (homeDefense && homeDefense > 24) {
      insights.keyFactors.push(`🚨 ${game.home?.abbr} weak defense (${homeDefense.toFixed(1)} allowed)`)
    }
    if (awayDefense && awayDefense > 24) {
      insights.keyFactors.push(`🚨 ${game.away?.abbr} weak defense (${awayDefense.toFixed(1)} allowed)`)
    }
    
    // Risk factors for OVER
    if (homeOffense && homeOffense < 18) {
      insights.riskFactors.push(`⚠️ ${game.home?.abbr} low scoring (${homeOffense.toFixed(1)} ppg)`)
    }
    if (awayOffense && awayOffense < 18) {
      insights.riskFactors.push(`⚠️ ${game.away?.abbr} low scoring (${awayOffense.toFixed(1)} ppg)`)
    }
  } else {
    // Factors supporting UNDER
    if (homeDefense && homeDefense < 19) {
      insights.keyFactors.push(`🛡️ ${game.home?.abbr} strong defense (${homeDefense.toFixed(1)} allowed)`)
    }
    if (awayDefense && awayDefense < 19) {
      insights.keyFactors.push(`🛡️ ${game.away?.abbr} strong defense (${awayDefense.toFixed(1)} allowed)`)
    }
    if (homeOffense && homeOffense < 20) {
      insights.keyFactors.push(`🐢 ${game.home?.abbr} slow offense (${homeOffense.toFixed(1)} ppg)`)
    }
    if (awayOffense && awayOffense < 20) {
      insights.keyFactors.push(`🐢 ${game.away?.abbr} slow offense (${awayOffense.toFixed(1)} ppg)`)
    }
    
    // Risk factors for UNDER
    if (homeOffense && homeOffense > 26) {
      insights.riskFactors.push(`⚠️ ${game.home?.abbr} explosive offense (${homeOffense.toFixed(1)} ppg)`)
    }
    if (awayOffense && awayOffense > 26) {
      insights.riskFactors.push(`⚠️ ${game.away?.abbr} explosive offense (${awayOffense.toFixed(1)} ppg)`)
    }
  }
  
  // Model confidence
  if (Math.abs(pick.edge) >= 0.06) {
    insights.modelConfidence = `High - Strong mismatch between predicted total and market line`
  } else if (Math.abs(pick.edge) >= 0.03) {
    insights.modelConfidence = `Moderate - Reasonable edge identified`
  } else {
    insights.modelConfidence = `Low - Close to market consensus`
  }
  
  // Matchup summary
  const avgTotal = predictedTotal || (homeOffense + awayOffense)
  const diff = avgTotal - threshold
  if (Math.abs(diff) >= 3) {
    insights.matchupEdge = `Expected total is ${Math.abs(diff).toFixed(1)} points ${diff > 0 ? 'above' : 'below'} the line`
  } else {
    insights.matchupEdge = `Predicted total is very close to market expectation`
  }
  
  return insights
}

/**
 * Generate insights for player props
 */
async function generatePlayerPropInsights(pick, game) {
  const insights = {
    summary: '',
    keyFactors: [],
    recentForm: {},
    matchupEdge: '',
    modelConfidence: '',
    riskFactors: []
  }
  
  const edge = ((pick.edge || 0) * 100).toFixed(1)
  const prob = ((pick.probability || 0.5) * 100).toFixed(0)
  
  insights.summary = `${pick.playerName} ${pick.pick?.toUpperCase()} ${pick.threshold} ${pick.propType?.replace(/_/g, ' ')} - ${prob}% confidence, ${edge}% edge`
  
  // Add projection if available
  if (pick.projection) {
    insights.keyFactors.push(`📊 Projected: ${pick.projection.toFixed(1)}`)
  }
  
  // Model confidence
  const qualityScore = pick.qualityScore || 0
  if (qualityScore >= 80) {
    insights.modelConfidence = `Very High - Elite opportunity`
  } else if (qualityScore >= 70) {
    insights.modelConfidence = `High - Strong pick`
  } else if (qualityScore >= 60) {
    insights.modelConfidence = `Moderate - Solid value`
  } else {
    insights.modelConfidence = `Low - Proceed with caution`
  }
  
  return insights
}

/**
 * Parse win-loss record string (e.g., "7-2" or "7-2-1" for NHL with OT)
 */
function parseRecord(record) {
  if (!record) return { wins: 0, losses: 0, otl: 0, total: 0 }
  
  const parts = record.split('-').map(Number)
  const wins = parts[0] || 0
  const losses = parts[1] || 0
  const otl = parts[2] || 0 // NHL overtime losses
  
  return {
    wins,
    losses,
    otl,
    total: wins + losses + otl
  }
}

/**
 * Calculate points per game from team data
 */
function calculatePPG(team, isDefense = false) {
  if (!team) return null
  
  const statField = isDefense ? 'avgPointsAllowedLast10' : 'avgPointsLast10'
  const total = team[statField]
  const record = team.last10Record
  
  if (!total || !record) return null
  
  const parsed = parseRecord(record)
  if (parsed.total === 0) return null
  
  return total / parsed.total
}

/**
 * Generate a quick one-line insight for display in pick cards
 */
export function generateQuickInsight(pick, game) {
  if (pick.type === 'moneyline') {
    const isHome = pick.pick === game?.home?.abbr
    const team = isHome ? game?.home : game?.away
    const record = parseRecord(team?.last10Record)
    const winPct = record.total > 0 ? (record.wins / record.total * 100).toFixed(0) : null
    
    if (winPct && winPct >= 70) {
      return `🔥 Hot streak: ${record.wins}-${record.losses} recent form`
    } else if (isHome) {
      const homeRec = parseRecord(team?.homeRecord)
      if (homeRec.wins >= homeRec.losses * 2) {
        return `🏠 Dominant at home: ${homeRec.wins}-${homeRec.losses}`
      }
    }
  } else if (pick.type === 'total') {
    const homeOff = calculatePPG(game?.home)
    const awayOff = calculatePPG(game?.away)
    const predicted = homeOff && awayOff ? homeOff + awayOff : null
    
    if (predicted) {
      const diff = Math.abs(predicted - pick.threshold)
      if (diff >= 4) {
        return `📊 ${diff.toFixed(1)} pt mismatch with market`
      }
    }
  }
  
  // Default
  const edge = ((pick.edge || 0) * 100).toFixed(1)
  return `${edge}% betting edge identified`
}

