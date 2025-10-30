// Fetch NHL player game statistics from ESPN API

const ESPN_NHL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl'

/**
 * Fetch NHL game stats for a completed game
 * @param {string} espnGameId - ESPN game ID
 * @param {string} playerName - Player name to find
 * @param {string} propType - Type of prop (goals, assists, points, shots, etc.)
 * @returns {Promise<number|null>} The actual stat value or null
 */
export async function getPlayerGameStat(espnGameId, playerName, propType) {
  try {
    console.log(`📊 Fetching NHL stats for game ${espnGameId}, player: ${playerName}, prop: ${propType}`)
    
    const url = `${ESPN_NHL_BASE}/summary?event=${espnGameId}`
    const response = await fetch(url)
    
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
    
    // Get box score data
    const boxscore = data.boxscore
    if (!boxscore) {
      console.error('❌ No boxscore data available')
      return null
    }
    
    // Search for player in both teams
    const players = boxscore.players || []
    
    for (const team of players) {
      const statistics = team.statistics || []
      
      for (const statCategory of statistics) {
        const athletes = statCategory.athletes || []
        
        for (const athlete of athletes) {
          const athleteName = athlete.athlete?.displayName || athlete.athlete?.fullName
          
          // Match player name (case-insensitive, flexible matching)
          if (athleteName && matchPlayerName(athleteName, playerName)) {
            console.log(`✅ Found player: ${athleteName}`)
            
            // Get the stat value based on prop type
            const statValue = getStatValue(athlete, propType)
            
            if (statValue !== null) {
              console.log(`✅ ${athleteName} ${propType}: ${statValue}`)
              return statValue
            }
          }
        }
      }
    }
    
    console.warn(`⚠️ Player ${playerName} not found in game stats`)
    return null
    
  } catch (error) {
    console.error('❌ Error fetching NHL game stats:', error)
    return null
  }
}

/**
 * Extract stat value from athlete data based on prop type
 */
function getStatValue(athlete, propType) {
  const stats = athlete.stats || []
  
  // Map prop types to stat names
  const statMapping = {
    'goals': ['goals', 'G'],
    'assists': ['assists', 'A'],
    'points': ['points', 'PTS'],
    'shots': ['shots', 'SOG', 'shotsOnGoal'],
    'powerplay_points': ['powerPlayPoints', 'PPP'],
    'blocked_shots': ['blockedShots', 'BLK'],
    'saves': ['saves', 'SV'] // for goalies
  }
  
  const possibleNames = statMapping[propType] || [propType]
  
  // Try to find the stat
  for (const statName of possibleNames) {
    const stat = findStat(stats, statName)
    if (stat !== null) {
      return stat
    }
  }
  
  // Special cases
  if (propType === 'points') {
    // Points = Goals + Assists
    const goals = findStat(stats, 'goals') || findStat(stats, 'G')
    const assists = findStat(stats, 'assists') || findStat(stats, 'A')
    if (goals !== null && assists !== null) {
      return goals + assists
    }
  }
  
  return null
}

/**
 * Find stat value in stats array
 */
function findStat(stats, statName) {
  const normalizedName = statName.toLowerCase()
  
  for (const stat of stats) {
    const label = (stat.label || stat.name || '').toLowerCase()
    const abbr = (stat.abbreviation || '').toLowerCase()
    
    if (label === normalizedName || abbr === normalizedName) {
      const value = parseFloat(stat.value || stat.displayValue)
      return isNaN(value) ? null : value
    }
  }
  
  return null
}

/**
 * Match player names (handles variations)
 */
function matchPlayerName(apiName, targetName) {
  const normalize = (name) => name.toLowerCase().trim().replace(/\./g, '').replace(/\s+/g, ' ')
  const apiNorm = normalize(apiName)
  const targetNorm = normalize(targetName)
  
  // Direct match
  if (apiNorm === targetNorm) return true
  
  // Check if one contains the other
  if (apiNorm.includes(targetNorm) || targetNorm.includes(apiNorm)) return true
  
  // Check last name match (most important for hockey)
  const apiLast = apiNorm.split(' ').pop()
  const targetLast = targetNorm.split(' ').pop()
  if (apiLast === targetLast && apiLast.length > 3) return true
  
  return false
}

export default {
  getPlayerGameStat
}

