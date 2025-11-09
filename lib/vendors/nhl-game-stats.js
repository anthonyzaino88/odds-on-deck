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
        const labels = statCategory.labels || [] // Get labels from stat category
        
        for (const athlete of athletes) {
          const athleteName = athlete.athlete?.displayName || athlete.athlete?.fullName
          
          // Match player name (case-insensitive, flexible matching)
          if (athleteName && matchPlayerName(athleteName, playerName)) {
            console.log(`✅ Found player: ${athleteName}`)
            
            // Get the stat value based on prop type (pass labels for positional lookup)
            const statValue = getStatValue(athlete, propType, labels)
            
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
 * ESPN returns stats as arrays with labels in parent statCategory
 */
function getStatValue(athlete, propType, labels) {
  const stats = athlete.stats || []
  
  // Map prop types to ESPN stat labels (case-insensitive)
  const statMapping = {
    // Goals
    'goals': 'G',
    'player_goals': 'G',
    
    // Assists
    'assists': 'A',
    'player_assists': 'A',
    
    // Points - calculated as Goals + Assists
    'points': 'POINTS',
    'player_points': 'POINTS',
    
    // Shots (total shots attempted)
    'shots': 'S',
    'player_shots': 'S',
    
    // Shots on Goal (shots that reached the net)
    'shots_on_goal': 'SOG',
    'player_shots_on_goal': 'SOG',
    
    // Power Play Points - needs calculation
    'powerplay_points': 'PPP',
    'player_power_play_points': 'PPP',
    'power_play_points': 'PPP',
    
    // Blocked Shots
    'blocked_shots': 'BS',
    'player_blocked_shots': 'BS',
    
    // Hits
    'hits': 'HT',
    'player_hits': 'HT',
    
    // Plus/Minus
    'plus_minus': '+/-',
    'player_plus_minus': '+/-',
    
    // Saves (Goalies)
    'saves': 'SV',
    'goalie_saves': 'SV'
  }
  
  // Normalize prop type
  const normalizedPropType = propType.toLowerCase().replace('player_', '').replace('goalie_', '')
  
  // Get the target stat label
  const targetLabel = statMapping[propType] || statMapping[normalizedPropType]
  
  if (!targetLabel) {
    console.log(`⚠️ Unknown prop type: ${propType}`)
    return null
  }
  
  console.log(`🔍 Looking for stat: ${propType} → ESPN label: ${targetLabel}`)
  
  // Special handling for Points (Goals + Assists)
  if (targetLabel === 'POINTS') {
    const goals = findStatByLabel(stats, labels, 'G')
    const assists = findStatByLabel(stats, labels, 'A')
    
    if (goals !== null && assists !== null) {
      const totalPoints = goals + assists
      console.log(`   ✅ Calculated points: ${goals} G + ${assists} A = ${totalPoints} PTS`)
      return totalPoints
    }
    console.log(`   ❌ Could not calculate points (Goals: ${goals}, Assists: ${assists})`)
    return null
  }
  
  // Find the stat by label
  const value = findStatByLabel(stats, labels, targetLabel)
  
  if (value !== null) {
    console.log(`   ✅ Found ${targetLabel}: ${value}`)
    return value
  }
  
  console.log(`   ❌ Stat ${targetLabel} not found`)
  return null
}

/**
 * Find stat value by matching label in stats array
 * ESPN returns stats as positional arrays with separate labels
 */
function findStatByLabel(stats, labels, targetLabel) {
  if (!labels || !Array.isArray(labels)) {
    return null
  }
  
  // Find the index of the target label (case-insensitive)
  const targetLabelUpper = targetLabel.toUpperCase()
  const index = labels.findIndex(label => label.toUpperCase() === targetLabelUpper)
  
  if (index === -1 || index >= stats.length) {
    return null
  }
  
  // Get the value at that index
  const value = parseFloat(stats[index])
  return isNaN(value) ? null : value
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

