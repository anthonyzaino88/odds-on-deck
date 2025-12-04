// NFL Matchup Analysis and History - SUPABASE VERSION
// This replaces lib/nfl-matchups.js with Supabase client instead of Prisma
// Uses admin client for write operations (bypasses RLS)

import { supabaseAdmin as supabase } from './supabase-admin.js'
import { getGameDetail } from './db-supabase.js'
import crypto from 'crypto'

// Helper to generate unique IDs
function generateId() {
  return crypto.randomBytes(12).toString('base64url')
}

/**
 * Analyze offensive vs defensive matchup for a game
 */
export async function analyzeGameMatchup(gameId) {
  try {
    // Get game using Supabase helper
    const game = await getGameDetail(gameId)
    
    if (!game || game.sport !== 'nfl') {
      throw new Error('Game not found or not an NFL game')
    }
    
    // Get recent matchup history (last 3 years)
    const currentYear = new Date().getFullYear()
    const years = [currentYear, currentYear - 1, currentYear - 2]
    
    const homeOffenseVsAwayDefense = await getMatchupHistory(
      game.homeId, game.awayId, years
    )
    
    const awayOffenseVsHomeDefense = await getMatchupHistory(
      game.awayId, game.homeId, years
    )
    
    // Calculate matchup advantages
    const homeAdvantages = calculateMatchupAdvantages(homeOffenseVsAwayDefense, 'home')
    const awayAdvantages = calculateMatchupAdvantages(awayOffenseVsHomeDefense, 'away')
    
    // Get key matchup insights
    const insights = generateMatchupInsights(game, homeAdvantages, awayAdvantages)
    
    return {
      game,
      homeOffenseVsAwayDefense,
      awayOffenseVsHomeDefense,
      advantages: {
        home: homeAdvantages,
        away: awayAdvantages
      },
      insights
    }
    
  } catch (error) {
    console.error('Error analyzing game matchup:', error)
    return null
  }
}

/**
 * Get historical matchup data between offense and defense
 */
export async function getMatchupHistory(offenseTeamId, defenseTeamId, seasons) {
  try {
    const seasonStrings = seasons.map(year => year.toString())
    
    const { data: history, error } = await supabase
      .from('NFLMatchupHistory')
      .select(`
        *,
        offenseTeam:Team!NFLMatchupHistory_offenseTeamId_fkey(*),
        defenseTeam:Team!NFLMatchupHistory_defenseTeamId_fkey(*),
        game:Game(*)
      `)
      .eq('offenseTeamId', offenseTeamId)
      .eq('defenseTeamId', defenseTeamId)
      .in('season', seasonStrings)
      .order('season', { ascending: false })
      .order('week', { ascending: false })
    
    if (error) {
      console.error('Error querying matchup history:', error)
      return []
    }
    
    return history || []
    
  } catch (error) {
    console.error('Error getting matchup history:', error)
    return []
  }
}

/**
 * Calculate matchup advantages based on historical data
 */
function calculateMatchupAdvantages(matchupHistory, side) {
  if (!matchupHistory || matchupHistory.length === 0) {
    return {
      totalYardsAvg: null,
      pointsAvg: null,
      turnoversAvg: null,
      thirdDownPct: null,
      redZonePct: null,
      gamesAnalyzed: 0,
      trend: 'no_data'
    }
  }
  
  const stats = matchupHistory.reduce((acc, game) => {
    acc.totalYards += game.totalYards || 0
    acc.points += game.pointsScored || 0
    acc.turnovers += game.turnovers || 0
    acc.thirdDownSuccess += game.thirdDownPct || 0
    acc.redZoneSuccess += game.redZonePct || 0
    acc.validGames += 1
    return acc
  }, {
    totalYards: 0,
    points: 0,
    turnovers: 0,
    thirdDownSuccess: 0,
    redZoneSuccess: 0,
    validGames: 0
  })
  
  const avgYards = stats.totalYards / stats.validGames
  const avgPoints = stats.points / stats.validGames
  const avgTurnovers = stats.turnovers / stats.validGames
  const avgThirdDown = stats.thirdDownSuccess / stats.validGames
  const avgRedZone = stats.redZoneSuccess / stats.validGames
  
  // Determine trend (recent vs older performance)
  const recentGames = matchupHistory.slice(0, Math.min(2, matchupHistory.length))
  const olderGames = matchupHistory.slice(2)
  
  let trend = 'stable'
  if (recentGames.length > 0 && olderGames.length > 0) {
    const recentAvgPoints = recentGames.reduce((sum, g) => sum + (g.pointsScored || 0), 0) / recentGames.length
    const olderAvgPoints = olderGames.reduce((sum, g) => sum + (g.pointsScored || 0), 0) / olderGames.length
    
    if (recentAvgPoints > olderAvgPoints * 1.15) trend = 'improving'
    else if (recentAvgPoints < olderAvgPoints * 0.85) trend = 'declining'
  }
  
  return {
    totalYardsAvg: Math.round(avgYards),
    pointsAvg: Math.round(avgPoints * 10) / 10,
    turnoversAvg: Math.round(avgTurnovers * 10) / 10,
    thirdDownPct: Math.round(avgThirdDown),
    redZonePct: Math.round(avgRedZone),
    gamesAnalyzed: stats.validGames,
    trend,
    efficiency: calculateEfficiencyScore(avgYards, avgPoints, avgTurnovers)
  }
}

/**
 * Calculate efficiency score (0-100)
 */
function calculateEfficiencyScore(yards, points, turnovers) {
  if (!yards || !points) return null
  
  // Base efficiency: points per 100 yards
  const pointsPer100Yards = (points / yards) * 100
  
  // Penalty for turnovers
  const turnoverPenalty = turnovers * 10
  
  // NFL average is roughly 2.2 points per 100 yards
  const relativeEfficiency = (pointsPer100Yards / 2.2) * 50
  
  const finalScore = Math.max(0, Math.min(100, relativeEfficiency - turnoverPenalty))
  return Math.round(finalScore)
}

/**
 * Generate matchup insights and recommendations
 */
function generateMatchupInsights(game, homeAdvantages, awayAdvantages) {
  const insights = []
  
  // Offensive efficiency insights
  if (homeAdvantages.efficiency && awayAdvantages.efficiency) {
    if (homeAdvantages.efficiency > awayAdvantages.efficiency + 15) {
      insights.push({
        type: 'advantage',
        team: 'home',
        category: 'offensive_efficiency',
        message: `${game.home.abbr} has shown superior offensive efficiency in this matchup`,
        confidence: 'high'
      })
    } else if (awayAdvantages.efficiency > homeAdvantages.efficiency + 15) {
      insights.push({
        type: 'advantage',
        team: 'away',
        category: 'offensive_efficiency',
        message: `${game.away.abbr} has shown superior offensive efficiency in this matchup`,
        confidence: 'high'
      })
    }
  }
  
  // Trend insights
  if (homeAdvantages.trend === 'improving') {
    insights.push({
      type: 'trend',
      team: 'home',
      category: 'recent_form',
      message: `${game.home.abbr} offense trending upward in this matchup`,
      confidence: 'medium'
    })
  }
  
  if (awayAdvantages.trend === 'improving') {
    insights.push({
      type: 'trend',
      team: 'away',
      category: 'recent_form',
      message: `${game.away.abbr} offense trending upward in this matchup`,
      confidence: 'medium'
    })
  }
  
  // Red zone insights
  if (homeAdvantages.redZonePct && homeAdvantages.redZonePct > 65) {
    insights.push({
      type: 'strength',
      team: 'home',
      category: 'red_zone',
      message: `${game.home.abbr} has excellent red zone efficiency vs ${game.away.abbr} defense`,
      confidence: 'medium'
    })
  }
  
  if (awayAdvantages.redZonePct && awayAdvantages.redZonePct > 65) {
    insights.push({
      type: 'strength',
      team: 'away',
      category: 'red_zone',
      message: `${game.away.abbr} has excellent red zone efficiency vs ${game.home.abbr} defense`,
      confidence: 'medium'
    })
  }
  
  // Sample size warnings
  if (homeAdvantages.gamesAnalyzed < 2 || awayAdvantages.gamesAnalyzed < 2) {
    insights.push({
      type: 'warning',
      team: 'both',
      category: 'sample_size',
      message: `Limited historical data for ${game.home?.abbr || 'Home'} vs ${game.away?.abbr || 'Away'} matchup. Sample Size Low Confidence.`,
      confidence: 'low'
    })
  }
  
  return insights
}

/**
 * Store matchup data after a game
 */
export async function storeMatchupResult(gameId, gameData) {
  try {
    const game = await getGameDetail(gameId)
    
    if (!game || game.sport !== 'nfl' || game.status !== 'final') {
      return null
    }
    
    // Store home offense vs away defense
    const homeMatchupData = {
      id: generateId(),
      offenseTeamId: game.homeId,
      defenseTeamId: game.awayId,
      gameId: gameId,
      week: game.week || null,
      season: game.season || new Date().getFullYear().toString(),
      pointsScored: game.homeScore,
      totalYards: gameData.homeStats?.totalYards || null,
      passingYards: gameData.homeStats?.passingYards || null,
      rushingYards: gameData.homeStats?.rushingYards || null,
      turnovers: gameData.homeStats?.turnovers || null,
      thirdDownPct: gameData.homeStats?.thirdDownPct || null,
      redZonePct: gameData.homeStats?.redZonePct || null,
      timeOfPossession: game.nflData?.timeOfPossessionHome || null,
      weather: gameData.weather || null,
      temperature: game.temperature || null,
      isHomeGame: true
    }
    
    // Try to find existing record first
    const { data: existingHome } = await supabase
      .from('NFLMatchupHistory')
      .select('id')
      .eq('offenseTeamId', game.homeId)
      .eq('defenseTeamId', game.awayId)
      .eq('gameId', gameId)
      .single()
    
    let homeOffenseMatchup
    if (existingHome) {
      const { data, error } = await supabase
        .from('NFLMatchupHistory')
        .update(homeMatchupData)
        .eq('id', existingHome.id)
        .select()
        .single()
      
      if (error) throw error
      homeOffenseMatchup = data
    } else {
      const { data, error } = await supabase
        .from('NFLMatchupHistory')
        .insert(homeMatchupData)
        .select()
        .single()
      
      if (error) throw error
      homeOffenseMatchup = data
    }
    
    // Store away offense vs home defense
    const awayMatchupData = {
      id: generateId(),
      offenseTeamId: game.awayId,
      defenseTeamId: game.homeId,
      gameId: gameId,
      week: game.week || null,
      season: game.season || new Date().getFullYear().toString(),
      pointsScored: game.awayScore,
      totalYards: gameData.awayStats?.totalYards || null,
      passingYards: gameData.awayStats?.passingYards || null,
      rushingYards: gameData.awayStats?.rushingYards || null,
      turnovers: gameData.awayStats?.turnovers || null,
      thirdDownPct: gameData.awayStats?.thirdDownPct || null,
      redZonePct: gameData.awayStats?.redZonePct || null,
      timeOfPossession: game.nflData?.timeOfPossessionAway || null,
      weather: gameData.weather || null,
      temperature: game.temperature || null,
      isHomeGame: false
    }
    
    // Try to find existing record first
    const { data: existingAway } = await supabase
      .from('NFLMatchupHistory')
      .select('id')
      .eq('offenseTeamId', game.awayId)
      .eq('defenseTeamId', game.homeId)
      .eq('gameId', gameId)
      .single()
    
    let awayOffenseMatchup
    if (existingAway) {
      const { data, error } = await supabase
        .from('NFLMatchupHistory')
        .update(awayMatchupData)
        .eq('id', existingAway.id)
        .select()
        .single()
      
      if (error) throw error
      awayOffenseMatchup = data
    } else {
      const { data, error } = await supabase
        .from('NFLMatchupHistory')
        .insert(awayMatchupData)
        .select()
        .single()
      
      if (error) throw error
      awayOffenseMatchup = data
    }
    
    console.log(`✅ Stored matchup data for game ${gameId}`)
    return { homeOffenseMatchup, awayOffenseMatchup }
    
  } catch (error) {
    console.error('Error storing matchup result:', error)
    return null
  }
}

/**
 * Get defensive rankings vs position groups
 */
export async function getDefensiveRankings(season = '2024') {
  try {
    // This would typically come from NFL stats API
    // For now, return mock rankings
    const mockRankings = {
      'kc': { passDefense: 8, rushDefense: 15, redZoneDefense: 5 },
      'bal': { passDefense: 12, rushDefense: 3, redZoneDefense: 10 },
      'buf': { passDefense: 4, rushDefense: 20, redZoneDefense: 7 },
      'cin': { passDefense: 18, rushDefense: 8, redZoneDefense: 14 }
      // Add all 32 teams
    }
    
    return mockRankings
    
  } catch (error) {
    console.error('Error getting defensive rankings:', error)
    return {}
  }
}

export default {
  analyzeGameMatchup,
  getMatchupHistory,
  storeMatchupResult,
  getDefensiveRankings
}

