// Fetch NHL team game statistics from ESPN API
// Extracts team-level stats from game boxscores

const ESPN_NHL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl'

/**
 * Fetch team-level stats from a completed NHL game
 * @param {string} espnGameId - ESPN game ID
 * @returns {Promise<object|null>} Team stats for both teams or null
 */
export async function fetchNHLTeamGameStats(espnGameId) {
  try {
    console.log(`📊 Fetching team stats for NHL game ${espnGameId}`)
    
    const url = `${ESPN_NHL_BASE}/summary?event=${espnGameId}`
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (!response.ok) {
      console.error(`❌ ESPN NHL API error: ${response.status} ${response.statusText}`)
      return null
    }
    
    const data = await response.json()
    
    // Check if game is final
    const gameStatus = data.header?.competitions?.[0]?.status?.type?.name
    if (gameStatus !== 'STATUS_FINAL') {
      console.log(`⏳ Game not final yet (status: ${gameStatus})`)
      return null
    }
    
    // Get boxscore data
    const boxscore = data.boxscore
    if (!boxscore) {
      console.error('❌ No boxscore data available')
      return null
    }
    
    // Extract team statistics
    const teams = boxscore.teams || []
    const teamStats = {}
    
    for (const team of teams) {
      const teamId = team.team?.id
      const teamAbbr = team.team?.abbreviation
      const teamName = team.team?.displayName
      
      if (!teamId) continue
      
      // Get team statistics from boxscore
      const stats = team.statistics || []
      const teamData = {
        teamId: `NHL_${teamId}`,
        teamAbbr: teamAbbr,
        teamName: teamName,
        goals: team.score || 0,
        shotsOnGoal: null,
        powerPlayGoals: null,
        powerPlayOpportunities: null,
        powerPlayPercentage: null,
        penaltyKillGoalsAgainst: null,
        penaltyKillOpportunities: null,
        penaltyKillPercentage: null,
        faceoffWins: null,
        faceoffTotal: null,
        faceoffPercentage: null,
        hits: null,
        blockedShots: null,
        takeaways: null,
        giveaways: null
      }
      
      // Extract stats from statistics array
      for (const stat of stats) {
        const label = stat.label?.toLowerCase() || ''
        const abbr = stat.abbreviation?.toLowerCase() || ''
        const value = parseFloat(stat.value || stat.displayValue) || 0
        
        // Map common stat names
        if (label.includes('shot') && (label.includes('goal') || abbr === 'sog')) {
          teamData.shotsOnGoal = value
        } else if (label.includes('power play') || abbr === 'pp') {
          if (label.includes('goal') || label.includes('converted')) {
            teamData.powerPlayGoals = value
          } else if (label.includes('opportunity') || label.includes('chance')) {
            teamData.powerPlayOpportunities = value
          } else if (label.includes('percent') || abbr === 'pp%') {
            teamData.powerPlayPercentage = value
          }
        } else if (label.includes('penalty kill') || abbr === 'pk') {
          if (label.includes('goal') && label.includes('against')) {
            teamData.penaltyKillGoalsAgainst = value
          } else if (label.includes('opportunity') || label.includes('chance')) {
            teamData.penaltyKillOpportunities = value
          } else if (label.includes('percent') || abbr === 'pk%') {
            teamData.penaltyKillPercentage = value
          }
        } else if (label.includes('faceoff') || abbr === 'fo') {
          if (label.includes('win')) {
            teamData.faceoffWins = value
          } else if (label.includes('total') || label.includes('taken')) {
            teamData.faceoffTotal = value
          } else if (label.includes('percent') || abbr === 'fo%') {
            teamData.faceoffPercentage = value
          }
        } else if (label.includes('hit') || abbr === 'h') {
          teamData.hits = value
        } else if (label.includes('block') || abbr === 'blk') {
          teamData.blockedShots = value
        } else if (label.includes('takeaway') || abbr === 'tk') {
          teamData.takeaways = value
        } else if (label.includes('giveaway') || abbr === 'gv') {
          teamData.giveaways = value
        }
      }
      
      // Calculate percentages if we have the raw numbers
      if (teamData.powerPlayGoals !== null && teamData.powerPlayOpportunities !== null && teamData.powerPlayOpportunities > 0) {
        teamData.powerPlayPercentage = (teamData.powerPlayGoals / teamData.powerPlayOpportunities) * 100
      }
      
      if (teamData.faceoffWins !== null && teamData.faceoffTotal !== null && teamData.faceoffTotal > 0) {
        teamData.faceoffPercentage = (teamData.faceoffWins / teamData.faceoffTotal) * 100
      }
      
      teamStats[teamId] = teamData
    }
    
    console.log(`✅ Extracted stats for ${Object.keys(teamStats).length} teams`)
    return teamStats
    
  } catch (error) {
    console.error('❌ Error fetching NHL team game stats:', error)
    return null
  }
}

/**
 * Fetch team stats for multiple games and calculate averages
 * @param {string[]} espnGameIds - Array of ESPN game IDs
 * @returns {Promise<object>} Aggregated team stats
 */
export async function fetchTeamStatsFromGames(espnGameIds) {
  const allStats = {}
  
  for (const gameId of espnGameIds) {
    const gameStats = await fetchNHLTeamGameStats(gameId)
    if (!gameStats) continue
    
    for (const [teamId, stats] of Object.entries(gameStats)) {
      if (!allStats[teamId]) {
        allStats[teamId] = {
          games: 0,
          totalGoals: 0,
          totalShotsOnGoal: 0,
          totalPowerPlayGoals: 0,
          totalPowerPlayOpportunities: 0,
          totalPenaltyKillGoalsAgainst: 0,
          totalPenaltyKillOpportunities: 0,
          totalFaceoffWins: 0,
          totalFaceoffs: 0,
          totalHits: 0,
          totalBlockedShots: 0,
          teamAbbr: stats.teamAbbr,
          teamName: stats.teamName
        }
      }
      
      const team = allStats[teamId]
      team.games++
      team.totalGoals += stats.goals || 0
      team.totalShotsOnGoal += stats.shotsOnGoal || 0
      team.totalPowerPlayGoals += stats.powerPlayGoals || 0
      team.totalPowerPlayOpportunities += stats.powerPlayOpportunities || 0
      team.totalPenaltyKillGoalsAgainst += stats.penaltyKillGoalsAgainst || 0
      team.totalPenaltyKillOpportunities += stats.penaltyKillOpportunities || 0
      team.totalFaceoffWins += stats.faceoffWins || 0
      team.totalFaceoffs += stats.faceoffTotal || 0
      team.totalHits += stats.hits || 0
      team.totalBlockedShots += stats.blockedShots || 0
    }
  }
  
  // Calculate averages
  const averages = {}
  for (const [teamId, stats] of Object.entries(allStats)) {
    averages[teamId] = {
      games: stats.games,
      goalsPerGame: stats.games > 0 ? (stats.totalGoals / stats.games).toFixed(2) : 0,
      shotsPerGame: stats.games > 0 ? (stats.totalShotsOnGoal / stats.games).toFixed(1) : 0,
      powerPlayPercentage: stats.totalPowerPlayOpportunities > 0 
        ? ((stats.totalPowerPlayGoals / stats.totalPowerPlayOpportunities) * 100).toFixed(1) 
        : null,
      penaltyKillPercentage: stats.totalPenaltyKillOpportunities > 0
        ? (((stats.totalPenaltyKillOpportunities - stats.totalPenaltyKillGoalsAgainst) / stats.totalPenaltyKillOpportunities) * 100).toFixed(1)
        : null,
      faceoffPercentage: stats.totalFaceoffs > 0
        ? ((stats.totalFaceoffWins / stats.totalFaceoffs) * 100).toFixed(1)
        : null,
      hitsPerGame: stats.games > 0 ? (stats.totalHits / stats.games).toFixed(1) : 0,
      blockedShotsPerGame: stats.games > 0 ? (stats.totalBlockedShots / stats.games).toFixed(1) : 0
    }
  }
  
  return averages
}




