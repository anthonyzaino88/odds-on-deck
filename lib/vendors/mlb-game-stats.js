// Fetch player game statistics from MLB Stats API

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1'

/**
 * Normalize player name for matching (remove accents, lowercase)
 * @param {string} name - Player name
 * @returns {string} Normalized name
 */
function normalizeName(name) {
  return name
    .normalize('NFD') // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .toLowerCase()
    .trim()
}

/**
 * Fetch box score and player stats for a completed game
 * @param {string} mlbGameId - MLB game ID (gamePk)
 * @returns {Promise<object>} Player stats by name
 */
export async function fetchMLBGameStats(mlbGameId) {
  try {
    console.log(`📊 Fetching stats for MLB game ${mlbGameId}...`)
    
    const url = `${MLB_API_BASE}/game/${mlbGameId}/boxscore`
    const response = await fetch(url)
    
    if (!response.ok) {
      console.error(`❌ MLB API error: ${response.status} ${response.statusText}`)
      return null
    }
    
    const data = await response.json()
    
    // Extract player stats from box score
    const playerStats = {}
    
    // Process home team batting stats
    const homeTeam = data.teams?.home
    if (homeTeam?.players) {
      for (const [playerId, playerData] of Object.entries(homeTeam.players)) {
        const person = playerData.person
        const stats = playerData.stats
        
        if (person && stats) {
          const fullName = person.fullName
          
          // Batting stats
          const batting = stats.batting
          if (batting) {
            playerStats[fullName] = {
              ...playerStats[fullName],
              hits: batting.hits || 0,
              runs: batting.runs || 0,
              rbi: batting.rbi || 0,
              homeRuns: batting.homeRuns || 0,
              strikeouts: batting.strikeOuts || 0,
              walks: batting.baseOnBalls || 0,
              stolenBases: batting.stolenBases || 0,
              totalBases: (batting.hits || 0) + (batting.doubles || 0) + (2 * (batting.triples || 0)) + (3 * (batting.homeRuns || 0)),
              doubles: batting.doubles || 0,
              triples: batting.triples || 0,
              atBats: batting.atBats || 0
            }
          }
          
          // Pitching stats
          const pitching = stats.pitching
          if (pitching) {
            playerStats[fullName] = {
              ...playerStats[fullName],
              inningsPitched: pitching.inningsPitched ? parseFloat(pitching.inningsPitched) : 0,
              strikeouts: pitching.strikeOuts || 0,
              hitsAllowed: pitching.hits || 0,
              earnedRuns: pitching.earnedRuns || 0,
              walksAllowed: pitching.baseOnBalls || 0,
              outs: pitching.outs || 0,
              pitchesThrown: pitching.numberOfPitches || 0
            }
          }
        }
      }
    }
    
    // Process away team batting stats
    const awayTeam = data.teams?.away
    if (awayTeam?.players) {
      for (const [playerId, playerData] of Object.entries(awayTeam.players)) {
        const person = playerData.person
        const stats = playerData.stats
        
        if (person && stats) {
          const fullName = person.fullName
          
          // Batting stats
          const batting = stats.batting
          if (batting) {
            playerStats[fullName] = {
              ...playerStats[fullName],
              hits: batting.hits || 0,
              runs: batting.runs || 0,
              rbi: batting.rbi || 0,
              homeRuns: batting.homeRuns || 0,
              strikeouts: batting.strikeOuts || 0,
              walks: batting.baseOnBalls || 0,
              stolenBases: batting.stolenBases || 0,
              totalBases: (batting.hits || 0) + (batting.doubles || 0) + (2 * (batting.triples || 0)) + (3 * (batting.homeRuns || 0)),
              doubles: batting.doubles || 0,
              triples: batting.triples || 0,
              atBats: batting.atBats || 0
            }
          }
          
          // Pitching stats
          const pitching = stats.pitching
          if (pitching) {
            playerStats[fullName] = {
              ...playerStats[fullName],
              inningsPitched: pitching.inningsPitched ? parseFloat(pitching.inningsPitched) : 0,
              strikeouts: pitching.strikeOuts || 0,
              hitsAllowed: pitching.hits || 0,
              earnedRuns: pitching.earnedRuns || 0,
              walksAllowed: pitching.baseOnBalls || 0,
              outs: pitching.outs || 0,
              pitchesThrown: pitching.numberOfPitches || 0
            }
          }
        }
      }
    }
    
    console.log(`✅ Found stats for ${Object.keys(playerStats).length} players in game ${mlbGameId}`)
    return playerStats
    
  } catch (error) {
    console.error(`❌ Error fetching MLB game stats for ${mlbGameId}:`, error)
    return null
  }
}

/**
 * Get a specific player's stat from a game
 * @param {string} mlbGameId - MLB game ID
 * @param {string} playerName - Full player name
 * @param {string} statType - Stat type (hits, runs, strikeouts, etc.)
 * @returns {Promise<number|null>}
 */
export async function getPlayerGameStat(mlbGameId, playerName, statType) {
  try {
    const gameStats = await fetchMLBGameStats(mlbGameId)
    
    if (!gameStats) {
      console.warn(`⚠️ No stats found for game ${mlbGameId}`)
      return null
    }
    
    // Try exact match first
    let playerData = gameStats[playerName]
    
    // If no exact match, try normalized name matching (handles accents)
    if (!playerData) {
      const normalizedSearchName = normalizeName(playerName)
      const matchingKey = Object.keys(gameStats).find(key => 
        normalizeName(key) === normalizedSearchName
      )
      
      if (matchingKey) {
        console.log(`✅ Found player with normalized name: "${playerName}" → "${matchingKey}"`)
        playerData = gameStats[matchingKey]
      } else {
        console.warn(`⚠️ No stats found for ${playerName} in game ${mlbGameId}`)
        return null
      }
    }
    
    // Map prop types to stat fields
    const statMap = {
      'hits': 'hits',
      'batter_hits': 'hits',
      'runs': 'runs',
      'batter_runs_scored': 'runs',
      'rbis': 'rbi',
      'batter_rbis': 'rbi',
      'home_runs': 'homeRuns',
      'batter_home_runs': 'homeRuns',
      'strikeouts': 'strikeouts',
      'batter_strikeouts': 'strikeouts',
      'walks': 'walks',
      'batter_walks': 'walks',
      'stolen_bases': 'stolenBases',
      'batter_stolen_bases': 'stolenBases',
      'total_bases': 'totalBases',
      'batter_total_bases': 'totalBases',
      'doubles': 'doubles',
      'triples': 'triples',
      'pitcher_strikeouts': 'strikeouts',
      'pitcher_hits_allowed': 'hitsAllowed',
      'hits_allowed': 'hitsAllowed',
      'pitcher_earned_runs': 'earnedRuns',
      'earned_runs': 'earnedRuns', // ✅ Added missing mapping!
      'pitcher_walks': 'walksAllowed',
      'pitcher_outs': 'outs',
      'innings_pitched': 'inningsPitched',
      'pitches_thrown': 'pitchesThrown'
    }
    
    const statField = statMap[statType]
    
    if (!statField) {
      console.warn(`⚠️ Unknown stat type: ${statType}`)
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
    console.error(`❌ Error getting stat for ${playerName}:`, error)
    return null
  }
}

