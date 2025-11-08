// NFL Matchup Analysis and History - SUPABASE VERSION
// This replaces lib/nfl-matchups.js with Supabase client instead of Prisma

import { supabase } from './supabase.js'
import { getGameDetail } from './db-supabase.js'
import crypto from 'crypto'

const ESPN_NFL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'

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
    
    // Calculate matchup advantages from historical data
    let homeAdvantages = calculateMatchupAdvantages(homeOffenseVsAwayDefense, 'home')
    let awayAdvantages = calculateMatchupAdvantages(awayOffenseVsHomeDefense, 'away')
    
    // If no historical data, use current season stats as fallback
    if (homeAdvantages.gamesAnalyzed === 0 || awayAdvantages.gamesAnalyzed === 0) {
      console.log(`📊 No historical matchup data, fetching current season stats for ${game.away.abbr} vs ${game.home.abbr}`)
      console.log(`   Game ESPN ID: ${game.espnGameId || 'not available'}`)
      
      // Fetch season stats for both teams
      const homeStats = await fetchTeamSeasonStats(game.homeId, game.home.abbr, game.espnGameId)
      const awayStats = await fetchTeamSeasonStats(game.awayId, game.away.abbr, game.espnGameId)
      
      console.log(`   Home stats:`, homeStats ? '✅' : '❌')
      console.log(`   Away stats:`, awayStats ? '✅' : '❌')
      
      if (homeStats && awayStats) {
        // Calculate matchup advantages using season stats
        homeAdvantages = calculateSeasonStatsMatchup(homeStats, awayStats, 'home')
        awayAdvantages = calculateSeasonStatsMatchup(awayStats, homeStats, 'away')
        console.log(`   ✅ Calculated matchup advantages from season stats`)
      } else {
        console.warn(`   ⚠️  Could not fetch season stats, matchup analysis will be empty`)
      }
    }
    
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
  
  // Season stats insights (when using fallback data)
  if (homeAdvantages.gamesAnalyzed === 0 && homeAdvantages.pointsAvg) {
    // Using season stats - add matchup insights
    if (homeAdvantages.defensePointsAllowed && homeAdvantages.pointsAvg > homeAdvantages.defensePointsAllowed + 3) {
      insights.push({
        type: 'advantage',
        team: 'home',
        category: 'offensive_matchup',
        message: `${game.home.abbr} offense (${homeAdvantages.pointsAvg.toFixed(1)} PPG) vs ${game.away.abbr} defense (${homeAdvantages.defensePointsAllowed.toFixed(1)} PPG allowed)`,
        confidence: 'medium'
      })
    }
  }
  
  if (awayAdvantages.gamesAnalyzed === 0 && awayAdvantages.pointsAvg) {
    // Using season stats - add matchup insights
    if (awayAdvantages.defensePointsAllowed && awayAdvantages.pointsAvg > awayAdvantages.defensePointsAllowed + 3) {
      insights.push({
        type: 'advantage',
        team: 'away',
        category: 'offensive_matchup',
        message: `${game.away.abbr} offense (${awayAdvantages.pointsAvg.toFixed(1)} PPG) vs ${game.home.abbr} defense (${awayAdvantages.defensePointsAllowed.toFixed(1)} PPG allowed)`,
        confidence: 'medium'
      })
    }
  }
  
  // Sample size warnings
  if (homeAdvantages.gamesAnalyzed < 2 || awayAdvantages.gamesAnalyzed < 2) {
    const message = homeAdvantages.gamesAnalyzed === 0 && awayAdvantages.gamesAnalyzed === 0
      ? `Using current season stats for ${game.home?.abbr || 'Home'} vs ${game.away?.abbr || 'Away'} matchup. Historical matchup data will be available once teams have played each other recently.`
      : `Limited historical data for ${game.home?.abbr || 'Home'} vs ${game.away?.abbr || 'Away'} matchup. Sample Size Low Confidence.`
    
    insights.push({
      type: 'warning',
      team: 'both',
      category: 'sample_size',
      message,
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
 * Fetch team season stats from ESPN API
 * @param {string} teamId - Our database team ID (e.g., "NFL_1")
 * @param {string} teamAbbr - Team abbreviation (e.g., "ATL")
 * @param {string} currentGameEspnId - Optional ESPN game ID for fallback
 */
async function fetchTeamSeasonStats(teamId, teamAbbr, currentGameEspnId = null) {
  try {
    // Remove NFL_ prefix to get ESPN team ID
    const espnTeamId = teamId.replace(/^NFL_/, '')
    
    // PRIORITY 1: Try direct team endpoint
    const teamStats = await fetchTeamSeasonStatsDirect(espnTeamId, teamAbbr)
    if (teamStats && teamStats.pointsPerGame) {
      console.log(`✅ Fetched team stats directly for ${teamAbbr}`)
      return teamStats
    }
    
    // PRIORITY 2: Fallback to game summary endpoint
    console.log(`⚠️  Direct team endpoint failed for ${teamAbbr}, trying game summary...`)
    const summaryStats = await fetchTeamSeasonStatsFromGame(espnTeamId, teamAbbr, currentGameEspnId)
    if (summaryStats && summaryStats.pointsPerGame) {
      console.log(`✅ Fetched team stats from game summary for ${teamAbbr}`)
      return summaryStats
    }
    
    console.warn(`⚠️  Could not fetch stats for ${teamAbbr}`)
    return null
    
  } catch (error) {
    console.error(`Error fetching ESPN stats for ${teamAbbr}:`, error)
    return null
  }
}

/**
 * Fetch team season stats directly from ESPN team endpoint
 * @param {string} espnTeamId - ESPN team ID
 * @param {string} teamAbbr - Team abbreviation
 */
async function fetchTeamSeasonStatsDirect(espnTeamId, teamAbbr) {
  try {
    const url = `${ESPN_NFL_BASE}/teams/${espnTeamId}?enable=stats`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!response.ok) {
      console.warn(`Direct team endpoint returned ${response.status} for ${teamAbbr}`)
      return null
    }
    
    const data = await response.json()
    const team = data.team
    
    if (!team || !team.record || !team.record.items || !Array.isArray(team.record.items)) {
      console.warn(`Invalid response structure from team endpoint for ${teamAbbr}`)
      return null
    }
    
    // Find the "total" (overall) stats
    const overallStats = team.record.items.find(item => item.type === 'total') || team.record.items[0]
    
    if (!overallStats || !overallStats.stats || !Array.isArray(overallStats.stats)) {
      console.warn(`No statistics array found in team endpoint for ${teamAbbr}`)
      return null
    }
    
    // Extract season stats - ESPN uses various stat names
    const extractedStats = {}
    
    // Log all stats for debugging
    console.log(`   📊 ESPN stats for ${teamAbbr}:`, overallStats.stats?.slice(0, 10).map(s => ({ name: s.name, value: s.displayValue })))
    
    for (const stat of overallStats.stats) {
      const name = stat.name?.toLowerCase() || ''
      const value = parseFloat(stat.displayValue) || parseFloat(stat.value) || 0
      const abbrev = stat.abbreviation?.toLowerCase() || ''
      
      // ESPN uses specific stat names - match them exactly
      // Points per game (offense) - ESPN uses "avgPointsFor"
      if (name === 'avgpointsfor' || name === 'avg points for') {
        extractedStats.pointsPerGame = value
      }
      // Points allowed per game (defense) - ESPN uses "avgPointsAgainst"  
      if (name === 'avgpointsagainst' || name === 'avg points against') {
        extractedStats.pointsAllowedPerGame = value
      }
      // Total yards per game - check for "avgYards" or similar
      if (name.includes('avgyards') || name.includes('avg yards') || name.includes('yardspergame') ||
          name.includes('total yards') || abbrev === 'ypg') {
        extractedStats.yardsPerGame = value
      }
      // Passing yards per game
      if (name.includes('avgpassingyards') || name.includes('passingyardspergame') ||
          name.includes('pass yards') || abbrev === 'pypg') {
        extractedStats.passingYardsPerGame = value
      }
      // Rushing yards per game
      if (name.includes('avgrushingyards') || name.includes('rushingyardspergame') ||
          name.includes('rush yards') || abbrev === 'rypg') {
        extractedStats.rushingYardsPerGame = value
      }
      // Turnovers per game
      if (name.includes('turnovers') || name.includes('giveaways') || abbrev === 'to' || abbrev === 'tov') {
        extractedStats.turnoversPerGame = value
      }
      // Third down conversion %
      if (name.includes('thirddown') || name.includes('3rd down') || name.includes('third down') ||
          abbrev === '3dc%' || abbrev === '3dc') {
        extractedStats.thirdDownPct = value
      }
      // Red zone %
      if (name.includes('redzone') || name.includes('red zone') || abbrev === 'rz%' || abbrev === 'rz') {
        extractedStats.redZonePct = value
      }
      
      // Yards allowed (defense)
      if (name.includes('avgyardsagainst') || name.includes('yardsallowedpergame') ||
          name.includes('yards against') || abbrev === 'yapg') {
        extractedStats.yardsAllowedPerGame = value
      }
      // Takeaways
      if (name.includes('takeaways') || abbrev === 'ta' || name.includes('turnovers forced')) {
        extractedStats.takeawaysPerGame = value
      }
    }
    
    // ESPN team endpoint only provides avgPointsFor and avgPointsAgainst
    // That's still useful for matchup analysis!
    if (extractedStats.pointsPerGame || extractedStats.pointsAllowedPerGame) {
      console.log(`   ✅ Extracted stats for ${teamAbbr}:`, Object.keys(extractedStats))
      // Set defaults for missing stats so we can still show the matchup
      if (!extractedStats.yardsPerGame) extractedStats.yardsPerGame = null
      if (!extractedStats.turnoversPerGame) extractedStats.turnoversPerGame = null
      return extractedStats
    }
    
    console.warn(`   ⚠️  No points stats found for ${teamAbbr}`)
    return null
    
  } catch (error) {
    console.error(`Error fetching direct team stats for ${teamAbbr}:`, error)
    return null
  }
}

/**
 * Fetch team season stats from game summary endpoint
 * @param {string} espnTeamId - ESPN team ID
 * @param {string} teamAbbr - Team abbreviation
 * @param {string} currentGameEspnId - ESPN game ID
 */
async function fetchTeamSeasonStatsFromGame(espnTeamId, teamAbbr, currentGameEspnId = null) {
  try {
    // Try to use current game ID, or find a recent game
    let espnGameIdToUse = currentGameEspnId
    
    if (!espnGameIdToUse) {
      // Find a recent game for this team
      const { data: recentGame } = await supabase
        .from('Game')
        .select('espnGameId')
        .or(`homeId.eq.NFL_${espnTeamId},awayId.eq.NFL_${espnTeamId}`)
        .eq('sport', 'nfl')
        .not('espnGameId', 'is', null)
        .order('date', { ascending: false })
        .limit(1)
        .single()
      
      if (recentGame?.espnGameId) {
        espnGameIdToUse = recentGame.espnGameId
      } else {
        return null
      }
    }
    
    const url = `${ESPN_NFL_BASE}/summary?event=${espnGameIdToUse}`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!response.ok) {
      console.warn(`Failed to fetch ESPN summary for ${teamAbbr}: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    const boxscore = data.boxscore
    
    if (!boxscore || !boxscore.teams) {
      console.warn(`No boxscore data in ESPN response for ${teamAbbr}`)
      return null
    }
    
    // Find our team in the boxscore
    const teamData = boxscore.teams.find(t => 
      t.team?.id === espnTeamId || t.team?.abbreviation === teamAbbr.toUpperCase()
    )
    
    if (!teamData || !teamData.statistics) {
      console.warn(`Team ${teamAbbr} not found in ESPN boxscore`)
      return null
    }
    
    // Extract season stats from ESPN statistics - check multiple possible locations
    const stats = {}
    
    // Try to get stats from teamData.statistics array
    if (teamData.statistics && Array.isArray(teamData.statistics)) {
      for (const stat of teamData.statistics) {
        const name = stat.name?.toLowerCase() || ''
        const abbrev = stat.abbreviation?.toLowerCase() || ''
        const value = parseFloat(stat.displayValue) || parseFloat(stat.value) || 0
        
        if (name.includes('pointsfor') || name.includes('points per game') || abbrev === 'ppg') {
          stats.pointsPerGame = value
        } else if (name.includes('yardspergame') || name.includes('total yards') || abbrev === 'ypg') {
          stats.yardsPerGame = value
        } else if (name.includes('pointsagainst') || name.includes('points allowed') || abbrev === 'papg') {
          stats.pointsAllowedPerGame = value
        } else if (name.includes('yardsallowed') || name.includes('yards against') || abbrev === 'yapg') {
          stats.yardsAllowedPerGame = value
        } else if (name.includes('turnovers') || abbrev === 'to') {
          stats.turnoversPerGame = value
        } else if (name.includes('thirddown') || name.includes('3rd down')) {
          stats.thirdDownPct = value
        } else if (name.includes('redzone') || name.includes('red zone')) {
          stats.redZonePct = value
        }
      }
    }
    
    // Also check teamData.leaders or other possible locations
    if (!stats.pointsPerGame && teamData.leaders) {
      // Try to extract from leaders array if available
      console.log(`   📊 Checking leaders array for ${teamAbbr}`)
    }
    
    if (stats.pointsPerGame) {
      console.log(`   ✅ Extracted stats from game summary for ${teamAbbr}`)
      return stats
    }
    
    console.warn(`   ⚠️  No stats found in game summary for ${teamAbbr}`)
    return null
    
  } catch (error) {
    console.error(`Error fetching team stats from game for ${teamAbbr}:`, error)
    return null
  }
}

/**
 * Calculate matchup advantages from season stats (offense vs defense)
 * @param {object} offenseStats - Offensive team's season stats
 * @param {object} defenseStats - Defensive team's season stats
 * @param {string} side - 'home' or 'away'
 */
function calculateSeasonStatsMatchup(offenseStats, defenseStats, side) {
  if (!offenseStats || !defenseStats) {
    return {
      totalYardsAvg: null,
      pointsAvg: null,
      turnoversAvg: null,
      thirdDownPct: null,
      redZonePct: null,
      gamesAnalyzed: 0,
      trend: 'no_data',
      efficiency: null
    }
  }
  
  // Use offense stats vs defense stats for matchup projection
  // ESPN only provides avgPointsFor and avgPointsAgainst, so we work with what we have
  const projectedPoints = offenseStats.pointsPerGame || 0
  const projectedYards = offenseStats.yardsPerGame || null // May be null
  const projectedTurnovers = offenseStats.turnoversPerGame || null // May be null
  
  // Calculate efficiency if we have yards data, otherwise use points-based efficiency
  let efficiency = null
  if (projectedYards && projectedPoints) {
    efficiency = calculateEfficiencyScore(projectedYards, projectedPoints, projectedTurnovers || 0)
  } else if (projectedPoints) {
    // Simple efficiency based on points vs league average (22 PPG)
    efficiency = Math.round((projectedPoints / 22) * 50)
  }
  
  return {
    totalYardsAvg: projectedYards ? Math.round(projectedYards) : null,
    pointsAvg: projectedPoints > 0 ? Math.round(projectedPoints * 10) / 10 : null,
    turnoversAvg: projectedTurnovers != null ? Math.round(projectedTurnovers * 10) / 10 : null,
    thirdDownPct: offenseStats.thirdDownPct ? Math.round(offenseStats.thirdDownPct) : null,
    redZonePct: offenseStats.redZonePct ? Math.round(offenseStats.redZonePct) : null,
    gamesAnalyzed: 0, // Season stats, not historical matchup
    trend: 'stable', // Can't determine trend from season stats alone
    efficiency,
    // Add defensive context for insights
    defensePointsAllowed: defenseStats.pointsAllowedPerGame || null,
    defenseYardsAllowed: defenseStats.yardsAllowedPerGame || null
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

