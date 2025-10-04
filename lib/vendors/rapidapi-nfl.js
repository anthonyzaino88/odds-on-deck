// RapidAPI NFL Data Integration
// Get your free API key at: https://rapidapi.com/api-sports/api/api-nfl

const RAPIDAPI_KEY = process.env.RAPIDAPI_NFL_KEY || 'YOUR_API_KEY_HERE'
const RAPIDAPI_HOST = 'api-nfl-v1.p.rapidapi.com'

/**
 * Fetch live NFL teams from RapidAPI
 */
export async function fetchRapidAPITeams() {
  try {
    console.log('🏈 Fetching NFL teams from RapidAPI...')
    
    const response = await fetch('https://api-nfl-v1.p.rapidapi.com/teams', {
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      }
    })
    
    if (!response.ok) {
      console.error(`RapidAPI teams error: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    return data.response || []
    
  } catch (error) {
    console.error('Error fetching RapidAPI teams:', error.message)
    return null
  }
}

/**
 * Fetch live NFL roster for a specific team
 */
export async function fetchRapidAPIRoster(teamId) {
  try {
    console.log(`🏈 Fetching roster for team ${teamId} from RapidAPI...`)
    
    const response = await fetch(`https://api-nfl-v1.p.rapidapi.com/players?team=${teamId}&season=2024`, {
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      }
    })
    
    if (!response.ok) {
      console.error(`RapidAPI roster error: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    return mapRapidAPIRoster(data.response || [], teamId)
    
  } catch (error) {
    console.error(`Error fetching RapidAPI roster for ${teamId}:`, error.message)
    return null
  }
}

/**
 * Map RapidAPI roster data to our format
 */
function mapRapidAPIRoster(players, teamId) {
  const roster = {}
  
  players.forEach(player => {
    const position = player.position || 'UNKNOWN'
    const name = player.name || 'Unknown Player'
    const jersey = player.jersey ? parseInt(player.jersey) : null
    const experience = player.experience || 0
    const height = player.height || null
    const weight = player.weight || null
    const age = player.age || null
    
    // Map to position groups
    let positionGroup = 'OTHER'
    if (['QB'].includes(position)) positionGroup = 'QB'
    else if (['RB', 'FB'].includes(position)) positionGroup = 'RB'
    else if (['WR'].includes(position)) positionGroup = 'WR'
    else if (['TE'].includes(position)) positionGroup = 'TE'
    else if (['K', 'P'].includes(position)) positionGroup = 'ST'
    else if (['OL', 'OT', 'OG', 'C'].includes(position)) positionGroup = 'OL'
    else if (['DL', 'DE', 'DT', 'NT'].includes(position)) positionGroup = 'DL'
    else if (['LB', 'ILB', 'OLB'].includes(position)) positionGroup = 'LB'
    else if (['CB', 'S', 'SS', 'FS'].includes(position)) positionGroup = 'DB'
    
    if (!roster[positionGroup]) {
      roster[positionGroup] = []
    }
    
    roster[positionGroup].push({
      name,
      jersey,
      experience,
      position,
      height,
      weight,
      age,
      teamId
    })
  })
  
  // Sort by experience/jersey and prioritize starters
  Object.keys(roster).forEach(pos => {
    roster[pos] = roster[pos]
      .sort((a, b) => (b.experience || 0) - (a.experience || 0))
      .slice(0, pos === 'WR' ? 6 : pos === 'RB' ? 3 : pos === 'DB' ? 4 : 2)
  })
  
  return roster
}

/**
 * Fetch live NFL games for current week
 */
export async function fetchRapidAPIGames() {
  try {
    console.log('🏈 Fetching current NFL games from RapidAPI...')
    
    const currentYear = new Date().getFullYear()
    const response = await fetch(`https://api-nfl-v1.p.rapidapi.com/games?season=${currentYear}`, {
      headers: {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      }
    })
    
    if (!response.ok) {
      console.error(`RapidAPI games error: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    return data.response || []
    
  } catch (error) {
    console.error('Error fetching RapidAPI games:', error.message)
    return null
  }
}

export default {
  fetchRapidAPITeams,
  fetchRapidAPIRoster,
  fetchRapidAPIGames
}
