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
 * Fetch player-level stats from a completed NHL game
 * @param {string} espnGameId - ESPN game ID
 * @returns {Promise<object|null>} Player stats organized by team or null
 */
export async function fetchNHLPlayerGameStats(espnGameId) {
  try {
    console.log(`📊 Fetching player stats for NHL game ${espnGameId}`)
    
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
    
    // Debug: Check what's available in boxscore
    console.log('🔍 Boxscore structure:', {
      hasPlayers: !!boxscore.players,
      hasLeaders: !!boxscore.leaders,
      hasLeadersByCategory: !!boxscore.leadersByCategory,
      boxscoreKeys: Object.keys(boxscore)
    })
    
    const playerStats = {
      skaters: [], // Forwards and defensemen
      goalies: []
    }
    
    // Try to get stats from leaders if available (often more complete)
    if (boxscore.leadersByCategory) {
      console.log('📊 Found leadersByCategory, checking for player stats...')
      // Leaders might have the actual game stats
    }
    
    // Process player statistics
    const players = boxscore.players || []
    
    for (const team of players) {
      const teamId = team.team?.id
      const teamAbbr = team.team?.abbreviation
      const teamName = team.team?.displayName
      
      if (!teamId) continue
      
      const statistics = team.statistics || []
      
      for (const statCategory of statistics) {
        const categoryName = statCategory.name?.toLowerCase() || ''
        const athletes = statCategory.athletes || []
        
        // Get stat labels/names from the category - ESPN uses labels array to map positions
        const statLabels = statCategory.labels || statCategory.names || []
        
        // Debug: Log stat category structure once
        if (playerStats.skaters.length === 0 && playerStats.goalies.length === 0 && statLabels.length > 0) {
          console.log('🔍 Stat category labels:', {
            categoryName,
            labels: statLabels,
            labelCount: statLabels.length
          })
        }
        
        for (const athlete of athletes) {
          const athleteData = athlete.athlete
          const playerName = athleteData?.displayName || athleteData?.fullName
          const playerId = athleteData?.id
          const position = athleteData?.position?.abbreviation || ''
          
          if (!playerName) continue
          
          const stats = athlete.stats || []
          
          // ESPN returns stats as an array of strings/values, not objects
          // We need to map positions using the labels array
          
          const playerStat = {
            playerId: playerId,
            playerName: playerName,
            teamId: `NHL_${teamId}`,
            teamAbbr: teamAbbr,
            teamName: teamName,
            position: position,
            goals: 0,
            assists: 0,
            points: 0,
            shots: 0,
            penaltyMinutes: 0,
            saves: null, // For goalies
            goalsAgainst: null, // For goalies
            savePercentage: null // For goalies
          }
          
          // ESPN returns stats as an array of strings/values - map using labels
          // Stats array: ['0', '0', '1', '2', '16:29', ...]
          // Labels array: ['G', 'A', 'PTS', '+/-', 'TOI', ...]
          for (let i = 0; i < stats.length && i < statLabels.length; i++) {
            const statValue = stats[i]
            const label = (statLabels[i] || '').toLowerCase()
            
            // Skip time-based stats (TOI, etc.) - they're strings like '16:29'
            if (typeof statValue === 'string' && statValue.includes(':')) {
              continue
            }
            
            const value = parseFloat(statValue) || 0
            
            // Map based on label position
            // Common NHL stat order: G, A, PTS, +/-, PIM, SOG, etc.
            if (label === 'g' || label === 'goals') {
              playerStat.goals = value
            } else if (label === 'a' || label === 'assists') {
              playerStat.assists = value
            } else if (label === 'pts' || label === 'points') {
              playerStat.points = value
            } else if (label === 'sog' || label === 'shots' || label === 'shots on goal') {
              playerStat.shots = value
            } else if (label === 'pim' || label === 'pen' || label === 'penalty minutes') {
              playerStat.penaltyMinutes = value
            } else if (label === 'sv' || label === 'saves') {
              playerStat.saves = value
            } else if (label === 'ga' || label === 'goals against') {
              playerStat.goalsAgainst = value
            } else if (label === 'sv%' || label === 'svpct' || label === 'save%' || label === 'save percentage') {
              // Save percentage might be a decimal (0.95) or percentage (95)
              playerStat.savePercentage = value > 1 ? value / 100 : value
            }
          }
          
          // Fallback: If no labels, try positional mapping for forwards/defensemen
          // Typical order: [Goals, Assists, Points, +/-, PIM, SOG, ...]
          if (statLabels.length === 0 && Array.isArray(stats) && stats.length >= 3) {
            // Try positional mapping (less reliable but better than nothing)
            if (categoryName.includes('forward') || categoryName.includes('defenseman') || categoryName.includes('skater')) {
              const goals = parseFloat(stats[0]) || 0
              const assists = parseFloat(stats[1]) || 0
              const points = parseFloat(stats[2]) || 0
              
              // Only use if values make sense
              if (points === goals + assists || (goals > 0 || assists > 0)) {
                playerStat.goals = goals
                playerStat.assists = assists
                playerStat.points = points || (goals + assists)
              }
              
              // Look for SOG and PIM in later positions
              for (let i = 3; i < Math.min(stats.length, 10); i++) {
                const val = parseFloat(stats[i])
                if (!isNaN(val) && val > 0) {
                  // PIM is usually a smaller number, SOG is usually larger
                  if (val >= 1 && val <= 20 && playerStat.penaltyMinutes === 0) {
                    playerStat.penaltyMinutes = val
                  } else if (val >= 1 && val <= 10 && playerStat.shots === 0) {
                    playerStat.shots = val
                  }
                }
              }
            }
          }
          
          // Calculate points if not provided
          if (playerStat.points === 0 && playerStat.goals > 0 || playerStat.assists > 0) {
            playerStat.points = playerStat.goals + playerStat.assists
          }
          
          // Determine if goalie (has saves or position is G)
          const isGoalie = position === 'G' || playerStat.saves !== null
          
          if (isGoalie) {
            playerStats.goalies.push(playerStat)
          } else {
            playerStats.skaters.push(playerStat)
          }
        }
      }
    }
    
    // Sort skaters by points (highest first), then goals
    playerStats.skaters.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      return b.goals - a.goals
    })
    
    // Sort goalies by saves (most saves first)
    playerStats.goalies.sort((a, b) => {
      if (a.saves === null && b.saves === null) return 0
      if (a.saves === null) return 1
      if (b.saves === null) return -1
      return b.saves - a.saves
    })
    
    console.log(`✅ Extracted stats for ${playerStats.skaters.length} skaters and ${playerStats.goalies.length} goalies`)
    return playerStats
    
  } catch (error) {
    console.error('❌ Error fetching NHL player game stats:', error)
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




