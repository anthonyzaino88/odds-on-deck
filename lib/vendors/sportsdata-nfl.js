// SportsData.io NFL API Integration
// Professional NFL data with depth charts, injury reports, etc.
// Get API key at: https://sportsdata.io/nfl-api

const SPORTSDATA_API_KEY = process.env.SPORTSDATA_NFL_KEY || 'YOUR_API_KEY_HERE'
const BASE_URL = 'https://api.sportsdata.io/v3/nfl'

/**
 * Fetch live NFL teams with current season info
 */
export async function fetchSportsDataTeams() {
  try {
    console.log('🏈 Fetching NFL teams from SportsData.io...')
    
    const response = await fetch(`${BASE_URL}/scores/json/AllTeams?key=${SPORTSDATA_API_KEY}`)
    
    if (!response.ok) {
      console.error(`SportsData teams error: ${response.status}`)
      return null
    }
    
    const teams = await response.json()
    return teams || []
    
  } catch (error) {
    console.error('Error fetching SportsData teams:', error.message)
    return null
  }
}

/**
 * Fetch current NFL depth chart for a team
 */
export async function fetchSportsDataDepthChart(teamKey) {
  try {
    console.log(`🏈 Fetching depth chart for ${teamKey} from SportsData.io...`)
    
    const response = await fetch(`${BASE_URL}/scores/json/DepthChart/${teamKey}?key=${SPORTSDATA_API_KEY}`)
    
    if (!response.ok) {
      console.error(`SportsData depth chart error: ${response.status}`)
      return null
    }
    
    const depthChart = await response.json()
    return mapSportsDataDepthChart(depthChart, teamKey)
    
  } catch (error) {
    console.error(`Error fetching SportsData depth chart for ${teamKey}:`, error.message)
    return null
  }
}

/**
 * Map SportsData depth chart to our format
 */
function mapSportsDataDepthChart(depthChart, teamKey) {
  const roster = {}
  
  if (!depthChart.Offense && !depthChart.Defense && !depthChart.SpecialTeams) {
    console.log(`No depth chart data for ${teamKey}`)
    return null
  }
  
  // Process Offense
  if (depthChart.Offense) {
    depthChart.Offense.forEach(player => {
      const position = player.Position || 'UNKNOWN'
      const name = player.Name || 'Unknown Player'
      const jersey = player.Jersey ? parseInt(player.Jersey) : null
      const depthOrder = player.DepthOrder || 1
      
      // Map position to our groups
      let positionGroup = position
      if (['QB'].includes(position)) positionGroup = 'QB'
      else if (['RB', 'FB'].includes(position)) positionGroup = 'RB'
      else if (['WR'].includes(position)) positionGroup = 'WR'
      else if (['TE'].includes(position)) positionGroup = 'TE'
      
      if (!roster[positionGroup]) {
        roster[positionGroup] = []
      }
      
      roster[positionGroup].push({
        name,
        jersey,
        position,
        depthOrder,
        teamKey,
        side: 'offense'
      })
    })
  }
  
  // Process Defense
  if (depthChart.Defense) {
    depthChart.Defense.forEach(player => {
      const position = player.Position || 'UNKNOWN'
      const name = player.Name || 'Unknown Player'
      const jersey = player.Jersey ? parseInt(player.Jersey) : null
      const depthOrder = player.DepthOrder || 1
      
      let positionGroup = position
      if (['DE', 'DT', 'NT', 'DL'].includes(position)) positionGroup = 'DL'
      else if (['LB', 'ILB', 'OLB', 'MLB'].includes(position)) positionGroup = 'LB'
      else if (['CB', 'S', 'SS', 'FS', 'DB'].includes(position)) positionGroup = 'DB'
      
      if (!roster[positionGroup]) {
        roster[positionGroup] = []
      }
      
      roster[positionGroup].push({
        name,
        jersey,
        position,
        depthOrder,
        teamKey,
        side: 'defense'
      })
    })
  }
  
  // Sort by depth order
  Object.keys(roster).forEach(pos => {
    roster[pos] = roster[pos]
      .sort((a, b) => a.depthOrder - b.depthOrder)
      .slice(0, 4) // Top 4 at each position
  })
  
  return roster
}

/**
 * Fetch live NFL scores and games
 */
export async function fetchSportsDataScores() {
  try {
    console.log('🏈 Fetching live NFL scores from SportsData.io...')
    
    const currentYear = new Date().getFullYear()
    const response = await fetch(`${BASE_URL}/scores/json/ScoresByWeek/${currentYear}/REG/4?key=${SPORTSDATA_API_KEY}`)
    
    if (!response.ok) {
      console.error(`SportsData scores error: ${response.status}`)
      return null
    }
    
    const scores = await response.json()
    return scores || []
    
  } catch (error) {
    console.error('Error fetching SportsData scores:', error.message)
    return null
  }
}

/**
 * Fetch player injury reports
 */
export async function fetchSportsDataInjuries() {
  try {
    console.log('🏈 Fetching NFL injury reports from SportsData.io...')
    
    const response = await fetch(`${BASE_URL}/scores/json/Injuries?key=${SPORTSDATA_API_KEY}`)
    
    if (!response.ok) {
      console.error(`SportsData injuries error: ${response.status}`)
      return null
    }
    
    const injuries = await response.json()
    return injuries || []
    
  } catch (error) {
    console.error('Error fetching SportsData injuries:', error.message)
    return null
  }
}

export default {
  fetchSportsDataTeams,
  fetchSportsDataDepthChart,
  fetchSportsDataScores,
  fetchSportsDataInjuries
}
