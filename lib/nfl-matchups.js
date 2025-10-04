// NFL Matchup Analysis and History

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Analyze offensive vs defensive matchup for a game
 */
export async function analyzeGameMatchup(gameId) {
  try {
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        home: true,
        away: true,
        nflData: true
      }
    })
    
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
    
    const history = await prisma.nFLMatchupHistory.findMany({
      where: {
        offenseTeamId: offenseTeamId,
        defenseTeamId: defenseTeamId,
        season: {
          in: seasonStrings
        }
      },
      include: {
        offenseTeam: true,
        defenseTeam: true,
        game: true
      },
      orderBy: [
        { season: 'desc' },
        { week: 'desc' }
      ]
    })
    
    return history
    
  } catch (error) {
    console.error('Error getting matchup history:', error)
    return []
  }
}

/**
 * Calculate matchup advantages based on historical data
 */
function calculateMatchupAdvantages(matchupHistory, side) {
  if (matchupHistory.length === 0) {
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
  if (homeAdvantages.gamesAnalyzed < 2) {
    insights.push({
      type: 'warning',
      team: 'home',
      category: 'sample_size',
      message: `Limited historical data for ${game.home.abbr} vs ${game.away.abbr} matchup`,
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
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: { nflData: true }
    })
    
    if (!game || game.sport !== 'nfl' || game.status !== 'final') {
      return null
    }
    
    // Store home offense vs away defense
    const homeOffenseMatchup = await prisma.nFLMatchupHistory.upsert({
      where: {
        offenseTeamId_defenseTeamId_gameId: {
          offenseTeamId: game.homeId,
          defenseTeamId: game.awayId,
          gameId: gameId
        }
      },
      update: {
        pointsScored: game.homeScore,
        totalYards: gameData.homeStats?.totalYards,
        passingYards: gameData.homeStats?.passingYards,
        rushingYards: gameData.homeStats?.rushingYards,
        turnovers: gameData.homeStats?.turnovers,
        thirdDownPct: gameData.homeStats?.thirdDownPct,
        redZonePct: gameData.homeStats?.redZonePct,
        timeOfPossession: game.nflData?.timeOfPossessionHome,
        weather: gameData.weather,
        temperature: game.temperature,
        isHomeGame: true
      },
      create: {
        offenseTeamId: game.homeId,
        defenseTeamId: game.awayId,
        gameId: gameId,
        week: game.week,
        season: game.season,
        pointsScored: game.homeScore,
        totalYards: gameData.homeStats?.totalYards,
        passingYards: gameData.homeStats?.passingYards,
        rushingYards: gameData.homeStats?.rushingYards,
        turnovers: gameData.homeStats?.turnovers,
        thirdDownPct: gameData.homeStats?.thirdDownPct,
        redZonePct: gameData.homeStats?.redZonePct,
        timeOfPossession: game.nflData?.timeOfPossessionHome,
        weather: gameData.weather,
        temperature: game.temperature,
        isHomeGame: true
      }
    })
    
    // Store away offense vs home defense
    const awayOffenseMatchup = await prisma.nFLMatchupHistory.upsert({
      where: {
        offenseTeamId_defenseTeamId_gameId: {
          offenseTeamId: game.awayId,
          defenseTeamId: game.homeId,
          gameId: gameId
        }
      },
      update: {
        pointsScored: game.awayScore,
        totalYards: gameData.awayStats?.totalYards,
        passingYards: gameData.awayStats?.passingYards,
        rushingYards: gameData.awayStats?.rushingYards,
        turnovers: gameData.awayStats?.turnovers,
        thirdDownPct: gameData.awayStats?.thirdDownPct,
        redZonePct: gameData.awayStats?.redZonePct,
        timeOfPossession: game.nflData?.timeOfPossessionAway,
        weather: gameData.weather,
        temperature: game.temperature,
        isHomeGame: false
      },
      create: {
        offenseTeamId: game.awayId,
        defenseTeamId: game.homeId,
        gameId: gameId,
        week: game.week,
        season: game.season,
        pointsScored: game.awayScore,
        totalYards: gameData.awayStats?.totalYards,
        passingYards: gameData.awayStats?.passingYards,
        rushingYards: gameData.awayStats?.rushingYards,
        turnovers: gameData.awayStats?.turnovers,
        thirdDownPct: gameData.awayStats?.thirdDownPct,
        redZonePct: gameData.awayStats?.redZonePct,
        timeOfPossession: game.nflData?.timeOfPossessionAway,
        weather: gameData.weather,
        temperature: game.temperature,
        isHomeGame: false
      }
    })
    
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
