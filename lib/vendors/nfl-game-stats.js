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
    
    if (!gameStats || !gameStats[playerName]) {
      console.warn(`⚠️ No stats found for ${playerName} in game ${espnGameId}`)
      return null
    }
    
    const playerData = gameStats[playerName]
    
    // Map prop types to stat fields (support both with and without 'player_' prefix)
    const statMap = {
      'passing_yards': 'passingYards',
      'player_passing_yards': 'passingYards',
      'player_pass_yds': 'passingYards',
      'passing_touchdowns': 'passingTouchdowns',
      'player_passing_touchdowns': 'passingTouchdowns',
      'player_pass_tds': 'passingTouchdowns',
      'passing_completions': 'passingCompletions',
      'player_passing_completions': 'passingCompletions',
      'player_pass_completions': 'passingCompletions',
      'passing_attempts': 'passingAttempts',
      'player_passing_attempts': 'passingAttempts',
      'player_pass_attempts': 'passingAttempts',
      'interceptions': 'interceptions',
      'player_interceptions': 'interceptions',
      'rushing_yards': 'rushingYards',
      'player_rushing_yards': 'rushingYards',
      'player_rush_yds': 'rushingYards',
      'rushing_touchdowns': 'rushingTouchdowns',
      'player_rushing_touchdowns': 'rushingTouchdowns',
      'player_rush_tds': 'rushingTouchdowns',
      'rushing_attempts': 'rushingAttempts',
      'player_rushing_attempts': 'rushingAttempts',
      'player_rush_attempts': 'rushingAttempts',
      'receiving_yards': 'receivingYards',
      'player_receiving_yards': 'receivingYards',
      'player_reception_yds': 'receivingYards',
      'receiving_touchdowns': 'receivingTouchdowns',
      'player_receiving_touchdowns': 'receivingTouchdowns',
      'player_reception_tds': 'receivingTouchdowns',
      'receptions': 'receptions',
      'player_receptions': 'receptions',
      'targets': 'targets',
      'player_targets': 'targets',
      'tackles': 'tackles',
      'player_tackles': 'tackles',
      'sacks': 'sacks',
      'player_sacks': 'sacks',
      'defensive_interceptions': 'defensiveInterceptions',
      'player_defensive_interceptions': 'defensiveInterceptions'
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




