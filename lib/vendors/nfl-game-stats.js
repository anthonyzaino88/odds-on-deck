// Fetch player game statistics from ESPN NFL API
//
// Grading adapter: fetchNFLGameStats / getPlayerGameStat keep historical
// behavior (missing category-stat values coerce to 0). Archival parsing
// lives in lib/nfl-box-score-archive.js and keeps missing stats null.

import {
  parseEspnNflSummary,
  toGradingAdapterPlayerMap,
} from '../nfl-box-score-archive.js'

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
    const boxscore = data.boxscore
    if (!boxscore || !boxscore.players) {
      console.warn(`⚠️ No player stats available for game ${espnGameId}`)
      return null
    }

    const parsed = parseEspnNflSummary(data)
    const playerStats = toGradingAdapterPlayerMap(parsed)
    
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
    if (!gameStats) return null
    
    // Try exact match first, then fuzzy match
    let playerData = gameStats[playerName]
    
    if (!playerData) {
      const normalize = (n) => n.toLowerCase().trim().replace(/\./g, '').replace(/\s+/g, ' ')
      const target = normalize(playerName)
      const targetLast = target.split(' ').pop()
      
      for (const [name, stats] of Object.entries(gameStats)) {
        const norm = normalize(name)
        if (norm === target || norm.includes(target) || target.includes(norm)) {
          playerData = stats; break
        }
        const last = norm.split(' ').pop()
        if (last === targetLast && last.length > 3) {
          playerData = stats; break
        }
      }
    }
    
    if (!playerData) {
      console.warn(`⚠️ No stats found for ${playerName} in game ${espnGameId}`)
      return null
    }
    
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
