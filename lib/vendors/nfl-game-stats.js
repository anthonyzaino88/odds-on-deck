// Fetch player game statistics from ESPN NFL API

const ESPN_NFL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'

/**
 * Fetch box score and player stats for a completed NFL game
 * @param {string} espnGameId - ESPN game ID
 * @returns {Promise<object>} Player stats by name
 */
export async function fetchNFLGameStats(espnGameId) {
  try {
    console.log(`🏈 Fetching stats for NFL game ${espnGameId}...`)
    
    const url = `${ESPN_NFL_BASE}/summary?event=${espnGameId}`
    const response = await fetch(url)
    
    if (!response.ok) {
      console.error(`❌ ESPN API error: ${response.status} ${response.statusText}`)
      return null
    }
    
    const data = await response.json()
    
    // Extract player stats from box score
    const playerStats = {}
    
    // Process box score statistics
    const boxscore = data.boxscore
    if (!boxscore || !boxscore.players) {
      console.warn(`⚠️ No player stats available for game ${espnGameId}`)
      return null
    }
    
    // Process both teams
    for (const team of boxscore.players) {
      // Process each stat category (passing, rushing, receiving, defense, etc.)
      for (const category of team.statistics || []) {
        const statType = category.name // "passing", "rushing", "receiving", etc.
        const athletes = category.athletes || []
        
        for (const athlete of athletes) {
          const name = athlete.athlete?.displayName
          if (!name) continue
          
          // Initialize player if not exists
          if (!playerStats[name]) {
            playerStats[name] = {}
          }
          
          // Parse stats based on category
          const stats = athlete.stats || []
          
          if (statType === 'passing') {
            // Stats: C/ATT, YDS, AVG, TD, INT, QBR, RTG
            playerStats[name].passingYards = parseFloat(stats[1]) || 0
            playerStats[name].passingTouchdowns = parseFloat(stats[3]) || 0
            playerStats[name].interceptions = parseFloat(stats[4]) || 0
            playerStats[name].passingCompletions = stats[0] ? parseInt(stats[0].split('/')[0]) : 0
            playerStats[name].passingAttempts = stats[0] ? parseInt(stats[0].split('/')[1]) : 0
          } else if (statType === 'rushing') {
            // Stats: CAR, YDS, AVG, TD, LONG
            playerStats[name].rushingYards = parseFloat(stats[1]) || 0
            playerStats[name].rushingTouchdowns = parseFloat(stats[3]) || 0
            playerStats[name].rushingAttempts = parseFloat(stats[0]) || 0
          } else if (statType === 'receiving') {
            // Stats: REC, YDS, AVG, TD, LONG, TGTS
            playerStats[name].receivingYards = parseFloat(stats[1]) || 0
            playerStats[name].receivingTouchdowns = parseFloat(stats[3]) || 0
            playerStats[name].receptions = parseFloat(stats[0]) || 0
            playerStats[name].targets = parseFloat(stats[5]) || 0
          } else if (statType === 'defensive') {
            // Stats: TOT, SOLO, SACKS, TFL, PD, QB HTS, TD
            playerStats[name].tackles = parseFloat(stats[0]) || 0
            playerStats[name].sacks = parseFloat(stats[2]) || 0
          } else if (statType === 'interceptions') {
            // Stats: INT, YDS, TD
            playerStats[name].defensiveInterceptions = parseFloat(stats[0]) || 0
          } else if (statType === 'kickReturns' || statType === 'puntReturns') {
            // Stats: NO, YDS, AVG, LONG, TD
            const returnType = statType === 'kickReturns' ? 'kickReturn' : 'puntReturn'
            playerStats[name][`${returnType}Yards`] = parseFloat(stats[1]) || 0
            playerStats[name][`${returnType}Touchdowns`] = parseFloat(stats[4]) || 0
          }
        }
      }
    }
    
    console.log(`✅ Found stats for ${Object.keys(playerStats).length} players in game ${espnGameId}`)
    return playerStats
    
  } catch (error) {
    console.error(`❌ Error fetching NFL game stats for ${espnGameId}:`, error)
    return null
  }
}

/**
 * Get a specific player's stat from a game
 * @param {string} espnGameId - ESPN game ID
 * @param {string} playerName - Full player name
 * @param {string} statType - Stat type (passing_yards, rushing_yards, etc.)
 * @returns {Promise<number|null>}
 */
export async function getPlayerGameStat(espnGameId, playerName, statType) {
  try {
    const gameStats = await fetchNFLGameStats(espnGameId)
    
    if (!gameStats) {
      console.warn(`⚠️ No game stats available for ${espnGameId}`)
      return null
    }
    
    // Try exact match first
    let playerData = gameStats[playerName]
    
    // If not found, try fuzzy matching by last name
    if (!playerData) {
      console.log(`🔍 Exact match failed for "${playerName}", trying fuzzy match...`)
      
      // Extract last name (last word in the name)
      const nameParts = playerName.trim().split(' ')
      const lastName = nameParts[nameParts.length - 1]
      
      // Determine stat category (offensive vs defensive)
      const offensiveStats = ['passing_yards', 'player_pass_yds', 'passing_touchdowns', 'player_pass_tds', 
                              'passing_completions', 'player_pass_completions', 'passing_attempts', 'player_pass_attempts',
                              'rushing_yards', 'player_rush_yds', 'rushing_touchdowns', 'player_rush_tds', 
                              'rushing_attempts', 'player_rush_attempts', 'receiving_yards', 'player_reception_yds', 
                              'receiving_touchdowns', 'player_reception_tds', 'receptions', 'player_receptions', 
                              'targets', 'player_targets']
      const defensiveStats = ['tackles', 'player_tackles', 'sacks', 'player_sacks', 
                              'defensive_interceptions', 'interceptions', 'player_interceptions']
      
      const isOffensiveStat = offensiveStats.includes(statType)
      const isDefensiveStat = defensiveStats.includes(statType)
      
      // Find players with matching last name AND appropriate stat category
      const matchingPlayers = Object.keys(gameStats).filter(name => {
        const espnNameParts = name.trim().split(' ')
        const espnLastName = espnNameParts[espnNameParts.length - 1]
        
        if (espnLastName.toLowerCase() !== lastName.toLowerCase()) {
          return false
        }
        
        // Check if player has the right stat category
        const stats = gameStats[name]
        
        if (isOffensiveStat) {
          // Must have at least one offensive stat
          return stats.passingYards !== undefined || stats.rushingYards !== undefined || 
                 stats.receivingYards !== undefined || stats.receptions !== undefined
        } else if (isDefensiveStat) {
          // Must have at least one defensive stat
          return stats.tackles !== undefined || stats.sacks !== undefined || 
                 stats.defensiveInterceptions !== undefined
        }
        
        return true // If stat category unclear, include player
      })
      
      if (matchingPlayers.length === 1) {
        // Unique match - use it!
        const matchedName = matchingPlayers[0]
        console.log(`✅ Fuzzy matched "${playerName}" → "${matchedName}" (by last name + stat category)`)
        playerData = gameStats[matchedName]
        playerName = matchedName // Update for logging
      } else if (matchingPlayers.length > 1) {
        console.warn(`⚠️ Multiple ${isOffensiveStat ? 'offensive' : isDefensiveStat ? 'defensive' : ''} players with last name "${lastName}": ${matchingPlayers.join(', ')}`)
        return null
      } else {
        console.warn(`⚠️ No stats found for ${playerName} in game ${espnGameId}`)
        return null
      }
    }
    
    // Map prop types to stat fields
    const statMap = {
      'passing_yards': 'passingYards',
      'player_pass_yds': 'passingYards',
      'passing_touchdowns': 'passingTouchdowns',
      'player_pass_tds': 'passingTouchdowns',
      'passing_completions': 'passingCompletions',
      'player_pass_completions': 'passingCompletions',
      'passing_attempts': 'passingAttempts',
      'player_pass_attempts': 'passingAttempts',
      'interceptions': 'interceptions',
      'player_interceptions': 'interceptions',
      'rushing_yards': 'rushingYards',
      'player_rush_yds': 'rushingYards',
      'rushing_touchdowns': 'rushingTouchdowns',
      'player_rush_tds': 'rushingTouchdowns',
      'rushing_attempts': 'rushingAttempts',
      'player_rush_attempts': 'rushingAttempts',
      'receiving_yards': 'receivingYards',
      'player_reception_yds': 'receivingYards',
      'receiving_touchdowns': 'receivingTouchdowns',
      'player_reception_tds': 'receivingTouchdowns',
      'receptions': 'receptions',
      'player_receptions': 'receptions', // Alias for player_receptions
      'targets': 'targets',
      'player_targets': 'targets',
      'tackles': 'tackles',
      'player_tackles': 'tackles',
      'sacks': 'sacks',
      'player_sacks': 'sacks',
      'defensive_interceptions': 'defensiveInterceptions'
    }
    
    const statField = statMap[statType]
    
    if (!statField) {
      console.warn(`⚠️ Unknown NFL stat type: ${statType}`)
      return null
    }
    
    const value = playerData[statField]
    
    if (value === undefined || value === null) {
      console.warn(`⚠️ Stat ${statField} not available for ${playerName}`)
      return null
    }
    
    console.log(`✅ ${playerName} ${statType}: ${value}`)
    return value
    
  } catch (error) {
    console.error(`❌ Error getting NFL stat for ${playerName}:`, error)
    return null
  }
}




