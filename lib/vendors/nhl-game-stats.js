// Fetch NHL player game statistics from NHL Official API
// Falls back to ESPN API if NHL API fails

const NHL_API_BASE = 'https://api-web.nhle.com/v1'
const ESPN_NHL_BASE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl'

/**
 * Fetch NHL game stats for a completed game
 * Uses NHL Official API first (has powerPlayGoals), falls back to ESPN
 * @param {string} espnGameId - ESPN game ID (or our internal game ID)
 * @param {string} playerName - Player name to find
 * @param {string} propType - Type of prop (goals, assists, points, shots, etc.)
 * @param {string} gameIdRef - Optional: Our internal game ID format (AWAY_at_HOME_DATE)
 * @returns {Promise<number|null>} The actual stat value or null
 */
export async function getPlayerGameStat(espnGameId, playerName, propType, gameIdRef = null) {
  try {
    console.log(`📊 Fetching NHL stats for game ${espnGameId}, player: ${playerName}, prop: ${propType}`)
    
    // Try NHL Official API first (has power play goals)
    const nhlResult = await fetchFromNHLApi(espnGameId, playerName, propType, gameIdRef)
    if (nhlResult !== null) {
      return nhlResult
    }
    
    // Fall back to ESPN API
    console.log(`⚠️ NHL API failed, trying ESPN API...`)
    return await fetchFromESPNApi(espnGameId, playerName, propType)
    
  } catch (error) {
    console.error('❌ Error fetching NHL game stats:', error)
    return null
  }
}

/**
 * Fetch from NHL Official API (api-web.nhle.com)
 */
async function fetchFromNHLApi(espnGameId, playerName, propType, gameIdRef) {
  try {
    // Try to find NHL game ID from our internal format or ESPN ID
    const nhlGameId = await findNHLGameId(espnGameId, gameIdRef)
    
    if (!nhlGameId) {
      console.log(`⚠️ Could not find NHL game ID`)
      return null
    }
    
    console.log(`🏒 Using NHL API with game ID: ${nhlGameId}`)
    
    const url = `${NHL_API_BASE}/gamecenter/${nhlGameId}/boxscore`
    const response = await fetch(url)
    
    if (!response.ok) {
      console.error(`❌ NHL API error: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    
    // Check if game is final
    if (data.gameState !== 'OFF' && data.gameState !== 'FINAL') {
      console.log(`⏳ Game not final yet (state: ${data.gameState})`)
      return null
    }

    // If PPP, try play-by-play for exact count before boxscore approximation
    if (isPPPProp(propType)) {
      const ppp = await fetchPPPFromPlayByPlay(nhlGameId, playerName)
      if (ppp !== null) {
        console.log(`✅ PPP from play-by-play: ${ppp}`)
        return ppp
      }
      console.log('⚠️ PPP play-by-play unavailable, falling back to boxscore inference')
    }
    
    // Get all players from both teams
    const homeForwards = data.playerByGameStats?.homeTeam?.forwards || []
    const homeDefense = data.playerByGameStats?.homeTeam?.defense || []
    const awayForwards = data.playerByGameStats?.awayTeam?.forwards || []
    const awayDefense = data.playerByGameStats?.awayTeam?.defense || []
    
    const allPlayers = [...homeForwards, ...homeDefense, ...awayForwards, ...awayDefense]
    
    // Find the player
    for (const player of allPlayers) {
      const name = player.name?.default || ''
      
      if (matchPlayerName(name, playerName)) {
        console.log(`✅ Found player in NHL API: ${name}`)
        
        // Get the stat value
        const statValue = getNHLStatValue(player, propType)
        
        if (statValue !== null) {
          console.log(`✅ ${name} ${propType}: ${statValue}`)
          return statValue
        }
      }
    }
    
    console.warn(`⚠️ Player ${playerName} not found in NHL API game stats`)
    return null
    
  } catch (error) {
    console.error('❌ NHL API error:', error.message)
    return null
  }
}

// Team abbreviation mapping (our format -> NHL API format)
const TEAM_ABBREV_MAP = {
  'NJ': 'NJD',    // New Jersey Devils
  'LA': 'LAK',    // Los Angeles Kings  
  'SJ': 'SJS',    // San Jose Sharks
  'TB': 'TBL',    // Tampa Bay Lightning
  'WAS': 'WSH',   // Washington Capitals
  'CBJ': 'CBJ',   // Columbus Blue Jackets (same)
  'VGK': 'VGK',   // Vegas Golden Knights (same)
}

/**
 * Convert our team abbreviation to NHL API format
 */
function toNHLAbbrev(abbrev) {
  return TEAM_ABBREV_MAP[abbrev] || abbrev
}

/**
 * Find NHL game ID from ESPN game ID or our internal format
 */
async function findNHLGameId(espnGameId, gameIdRef) {
  try {
    // If gameIdRef is provided (format: AWAY_at_HOME_YYYY-MM-DD), use it
    if (gameIdRef && gameIdRef.includes('_at_')) {
      const parts = gameIdRef.split('_at_')
      const awayTeam = toNHLAbbrev(parts[0])
      const [homeTeamRaw, dateStr] = parts[1].split('_')
      const homeTeam = toNHLAbbrev(homeTeamRaw)
      
      console.log(`   Looking for: ${awayTeam} at ${homeTeam} on ${dateStr}`)
      
      // Fetch schedule for that date
      const scheduleUrl = `${NHL_API_BASE}/schedule/${dateStr}`
      const response = await fetch(scheduleUrl)
      
      if (response.ok) {
        const data = await response.json()
        
        for (const day of data.gameWeek || []) {
          for (const game of day.games || []) {
            if (game.awayTeam?.abbrev === awayTeam && game.homeTeam?.abbrev === homeTeam) {
              return game.id
            }
          }
        }
      }
    }
    
    return null
  } catch (error) {
    console.error('Error finding NHL game ID:', error.message)
    return null
  }
}

/**
 * Get stat value from NHL API player data
 */
function getNHLStatValue(player, propType) {
  const normalizedProp = propType.toLowerCase().replace('player_', '')
  
  // Direct mappings to NHL API fields
  const statMapping = {
    'goals': player.goals,
    'assists': player.assists,
    'points': player.points,
    'shots': player.sog,
    'shots_on_goal': player.sog,
    'blocked_shots': player.blockedShots,
    'hits': player.hits,
    'plus_minus': player.plusMinus,
    'power_play_goals': player.powerPlayGoals,
    'powerplay_goals': player.powerPlayGoals,
    'power_play_points': player.powerPlayGoals, // Only PPG available, estimate
    'powerplay_points': player.powerPlayGoals,
  }
  
  // Check for power play points specifically
  if (normalizedProp.includes('power_play_point') || normalizedProp.includes('powerplay_point')) {
    // NHL API has powerPlayGoals but NOT powerPlayAssists
    // If powerPlayGoals = 0 AND total goals = 0 AND total assists = 0, PPP must be 0
    if (player.goals === 0 && player.assists === 0) {
      console.log(`   ✅ PPP = 0 (no goals or assists)`)
      return 0
    }
    
    // If has power play goals, PPP is at least that
    if (player.powerPlayGoals > 0) {
      console.log(`   ✅ PPP >= ${player.powerPlayGoals} (has PPG)`)
      // Return PPG as minimum - can't determine PP assists
      return player.powerPlayGoals
    }
    
    // Player has goals/assists but no PPG - could have PP assists but unlikely
    // For "under 0.5" props, if they have 0 PPG and 0 total points, safe to say 0
    if (player.powerPlayGoals === 0 && player.points === 0) {
      console.log(`   ✅ PPP = 0 (no points at all)`)
      return 0
    }
    
    // Has points but no PPG - might have PP assists but we can't verify
    console.log(`   ⚠️ Cannot determine exact PPP (has ${player.points} pts but 0 PPG)`)
    return null
  }
  
  // Standard stat lookup
  if (normalizedProp in statMapping) {
    return statMapping[normalizedProp]
  }
  
  // Check original propType
  if (propType in statMapping) {
    return statMapping[propType]
  }
  
  console.log(`⚠️ Unknown prop type: ${propType}`)
  return null
}

/**
 * Fall back to ESPN API
 */
async function fetchFromESPNApi(espnGameId, playerName, propType) {
  try {
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
        const labels = statCategory.labels || []
        
        for (const athlete of athletes) {
          const athleteName = athlete.athlete?.displayName || athlete.athlete?.fullName
          
          if (athleteName && matchPlayerName(athleteName, playerName)) {
            console.log(`✅ Found player: ${athleteName}`)
            
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
    console.error('❌ Error fetching ESPN NHL game stats:', error)
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
  
  // Special handling for Power Play Points (PPP)
  // ESPN doesn't provide PPP directly, but we can infer it in some cases:
  // - If player has 0 total goals AND 0 total assists, PPP must be 0
  // - If player has any goals/assists but PPTOI (PP Time) is "0:00", PPP must be 0
  if (targetLabel === 'PPP') {
    const goals = findStatByLabel(stats, labels, 'G')
    const assists = findStatByLabel(stats, labels, 'A')
    
    // Get PPTOI as string (it's formatted like "3:30" or "0:00")
    const pptoiIndex = labels?.findIndex(l => l.toUpperCase() === 'PPTOI')
    const pptoiRaw = pptoiIndex >= 0 ? stats[pptoiIndex] : null
    
    console.log(`   🔍 PPP inference: G=${goals}, A=${assists}, PPTOI=${pptoiRaw}`)
    
    // If no goals and no assists, PPP must be 0
    if (goals === 0 && assists === 0) {
      console.log(`   ✅ Inferred PPP = 0 (no goals or assists)`)
      return 0
    }
    
    // If player had no power play time (0:00), PPP must be 0
    if (pptoiRaw === '0:00' || pptoiRaw === '0' || pptoiRaw === 0) {
      console.log(`   ✅ Inferred PPP = 0 (no power play time)`)
      return 0
    }
    
    // Can't determine exact PPP - player has points and PP time
    // For props like "under 0.5", if total points > 0 we still can't validate
    const totalPoints = (goals || 0) + (assists || 0)
    if (totalPoints > 0) {
      console.log(`   ⚠️ Cannot determine exact PPP (player has ${totalPoints} total points and PP time: ${pptoiRaw})`)
      // Return null to mark as needs_review
      return null
    }
    
    return 0
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

/**
 * Determine if prop is PPP
 */
function isPPPProp(propType) {
  const p = propType.toLowerCase()
  return p.includes('power_play_point')
}

/**
 * Fetch PPP from play-by-play (exact: goals + assists on PP goals)
 */
async function fetchPPPFromPlayByPlay(nhlGameId, playerName) {
  try {
    const url = `${NHL_API_BASE}/gamecenter/${nhlGameId}/play-by-play`
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`⚠️ Play-by-play fetch failed: ${res.status}`)
      return null
    }
    const data = await res.json()
    const plays = data?.plays || []
    if (!Array.isArray(plays)) return null

    let ppp = 0
    for (const play of plays) {
      const typeKey = play?.typeDescKey || play?.typeDesc || play?.type
      if (!typeKey || typeKey.toLowerCase() !== 'goal') continue

      const strengthCode =
        play?.strength?.code ||
        play?.details?.strength?.code ||
        play?.strength ||
        ''
      const strength = String(strengthCode).toLowerCase()
      if (!(strength.includes('pp') || strength.includes('power'))) continue

      const players = play?.players || []
      for (const pl of players) {
        const role = (pl?.playerType || pl?.type || '').toLowerCase()
        const name = pl?.fullName || pl?.name || pl?.playerName || ''
        if (!name) continue
        if (!matchPlayerName(name, playerName)) continue
        if (role === 'scorer' || role === 'assist') {
          ppp += 1
        }
      }
    }

    return ppp
  } catch (e) {
    console.warn(`⚠️ Play-by-play PPP error: ${e.message}`)
    return null
  }
}

