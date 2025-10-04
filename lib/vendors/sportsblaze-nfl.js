// SportsBlaze NFL API Integration
// Live 2025 NFL roster data
// Get API key at: https://sportsblaze.com/

const SPORTSBLAZE_API_KEY = process.env.SPORTSBLAZE_API_KEY || 'YOUR_API_KEY_HERE'
const BASE_URL = 'https://api.sportsblaze.com/v1/nfl'

/**
 * Fetch live 2025 NFL team roster from SportsBlaze
 */
export async function fetchSportsBlazeRoster(teamAbbr) {
  try {
    console.log(`🏈 Fetching 2025 roster for ${teamAbbr} from SportsBlaze...`)
    
    const response = await fetch(`${BASE_URL}/team-rosters?team=${teamAbbr.toUpperCase()}&season=2024`, {
      headers: {
        'Authorization': `Bearer ${SPORTSBLAZE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (!response.ok) {
      console.error(`SportsBlaze roster error: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    return mapSportsBlazeRoster(data, teamAbbr)
    
  } catch (error) {
    console.error(`Error fetching SportsBlaze roster for ${teamAbbr}:`, error.message)
    return null
  }
}

/**
 * Map SportsBlaze roster data to our format
 */
function mapSportsBlazeRoster(data, teamAbbr) {
  try {
    if (!data.players || !Array.isArray(data.players)) {
      console.log(`No players data for ${teamAbbr}`)
      return null
    }
    
    const roster = {}
    
    data.players.forEach(player => {
      const position = player.position || 'UNKNOWN'
      const name = player.name || player.full_name || 'Unknown Player'
      const jersey = player.jersey_number ? parseInt(player.jersey_number) : null
      const experience = player.years_pro || player.experience || 0
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
      else if (['OT', 'OG', 'C', 'OL'].includes(position)) positionGroup = 'OL'
      else if (['DE', 'DT', 'NT', 'DL'].includes(position)) positionGroup = 'DL'
      else if (['LB', 'ILB', 'OLB', 'MLB'].includes(position)) positionGroup = 'LB'
      else if (['CB', 'S', 'SS', 'FS', 'DB'].includes(position)) positionGroup = 'DB'
      
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
        team: teamAbbr
      })
    })
    
    // Sort by experience and take top players
    Object.keys(roster).forEach(pos => {
      roster[pos] = roster[pos]
        .sort((a, b) => (b.experience || 0) - (a.experience || 0))
        .slice(0, pos === 'WR' ? 6 : pos === 'RB' ? 3 : pos === 'DB' ? 4 : pos === 'LB' ? 3 : 2)
    })
    
    console.log(`✅ Mapped ${Object.keys(roster).length} position groups for ${teamAbbr}`)
    return roster
    
  } catch (error) {
    console.error(`Error mapping SportsBlaze data for ${teamAbbr}:`, error.message)
    return null
  }
}

/**
 * Fetch all NFL teams from SportsBlaze
 */
export async function fetchSportsBlazeTeams() {
  try {
    console.log('🏈 Fetching NFL teams from SportsBlaze...')
    
    const response = await fetch(`${BASE_URL}/teams`, {
      headers: {
        'Authorization': `Bearer ${SPORTSBLAZE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (!response.ok) {
      console.error(`SportsBlaze teams error: ${response.status}`)
      return null
    }
    
    const teams = await response.json()
    return teams || []
    
  } catch (error) {
    console.error('Error fetching SportsBlaze teams:', error.message)
    return null
  }
}

export default {
  fetchSportsBlazeRoster,
  fetchSportsBlazeTeams
}
