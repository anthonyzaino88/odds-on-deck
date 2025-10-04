// Official NFL.com API Integration
// Free access to official NFL data

/**
 * Fetch team roster from official NFL API
 */
export async function fetchNFLOfficialRoster(teamAbbr) {
  try {
    console.log(`🏈 Fetching official NFL roster for ${teamAbbr}...`)
    
    // Convert team abbreviation to NFL.com format
    const nflTeamMap = {
      'ari': 'ARI', 'atl': 'ATL', 'bal': 'BAL', 'buf': 'BUF', 'car': 'CAR',
      'chi': 'CHI', 'cin': 'CIN', 'cle': 'CLE', 'dal': 'DAL', 'den': 'DEN',
      'det': 'DET', 'gb': 'GB', 'hou': 'HOU', 'ind': 'IND', 'jax': 'JAX',
      'kc': 'KC', 'lv': 'LV', 'lac': 'LAC', 'lar': 'LAR', 'mia': 'MIA',
      'min': 'MIN', 'ne': 'NE', 'no': 'NO', 'nyg': 'NYG', 'nyj': 'NYJ',
      'phi': 'PHI', 'pit': 'PIT', 'sf': 'SF', 'sea': 'SEA', 'tb': 'TB',
      'ten': 'TEN', 'was': 'WAS'
    }
    
    const nflTeam = nflTeamMap[teamAbbr.toLowerCase()]
    if (!nflTeam) {
      console.log(`No NFL mapping for team: ${teamAbbr}`)
      return null
    }
    
    // Try multiple NFL API endpoints
    const endpoints = [
      `https://www.nfl.com/teams/${teamAbbr.toLowerCase()}/roster/`,
      `https://api.nfl.com/v1/teams/${nflTeam}/roster`,
      `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamAbbr.toLowerCase()}/roster`
    ]
    
    for (const url of endpoints) {
      try {
        console.log(`Trying: ${url}`)
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json, text/html',
            'Cache-Control': 'no-cache'
          }
        })
        
        if (response.ok) {
          const data = await response.json()
          const roster = mapNFLOfficialRoster(data, teamAbbr)
          if (roster) {
            console.log(`✅ Success with: ${url}`)
            return roster
          }
        } else {
          console.log(`❌ Failed: ${url} (${response.status})`)
        }
        
      } catch (error) {
        console.log(`❌ Error with ${url}: ${error.message}`)
        continue
      }
    }
    
    return null
    
  } catch (error) {
    console.error(`Error fetching NFL official roster for ${teamAbbr}:`, error.message)
    return null
  }
}

/**
 * Map NFL official roster data to our format
 */
function mapNFLOfficialRoster(data, teamAbbr) {
  try {
    console.log(`Raw data structure for ${teamAbbr}:`, JSON.stringify(data, null, 2).substring(0, 500))
    
    // Handle ESPN API format: athletes array with position groups
    let allPlayers = []
    
    if (data.athletes && Array.isArray(data.athletes)) {
      // ESPN format: [{ position: "offense", items: [...] }, { position: "defense", items: [...] }]
      data.athletes.forEach(positionGroup => {
        if (positionGroup.items && Array.isArray(positionGroup.items)) {
          allPlayers = allPlayers.concat(positionGroup.items)
        }
      })
    } else if (data.roster) {
      allPlayers = data.roster
    } else if (data.players) {
      allPlayers = data.players
    } else if (Array.isArray(data)) {
      allPlayers = data
    }
    
    console.log(`Found ${allPlayers.length} total players for ${teamAbbr}`)
    
    if (!allPlayers || allPlayers.length === 0) {
      console.log(`No players found for ${teamAbbr}`)
      return null
    }
    
    const roster = {}
    
    allPlayers.forEach(player => {
      const position = player.position?.abbreviation || player.position?.name || 'UNKNOWN'
      const name = player.displayName || player.fullName || `${player.firstName} ${player.lastName}` || 'Unknown Player'
      const jersey = player.jersey || player.jerseyNumber || player.number
      const experience = player.experience?.years || player.yearsExperience || (typeof player.experience === 'number' ? player.experience : 0)
      
      // Map to position groups
      let positionGroup = 'OTHER'
      if (['QB'].includes(position)) positionGroup = 'QB'
      else if (['RB', 'FB'].includes(position)) positionGroup = 'RB'
      else if (['WR'].includes(position)) positionGroup = 'WR'
      else if (['TE'].includes(position)) positionGroup = 'TE'
      else if (['K', 'P'].includes(position)) positionGroup = 'ST'
      
      if (!roster[positionGroup]) {
        roster[positionGroup] = []
      }
      
      roster[positionGroup].push({
        name,
        jersey: jersey ? parseInt(jersey) : null,
        experience,
        position,
        team: teamAbbr
      })
    })
    
    // Sort and limit
    Object.keys(roster).forEach(pos => {
      roster[pos] = roster[pos]
        .sort((a, b) => (b.experience || 0) - (a.experience || 0))
        .slice(0, pos === 'WR' ? 4 : pos === 'RB' ? 2 : 1)
    })
    
    return roster
    
  } catch (error) {
    console.error(`Error mapping NFL official data for ${teamAbbr}:`, error.message)
    return null
  }
}

/**
 * Fetch current week NFL games
 */
export async function fetchNFLOfficialGames() {
  try {
    console.log('🏈 Fetching current NFL games from official API...')
    
    const currentYear = new Date().getFullYear()
    const urls = [
      `https://api.nfl.com/v1/games?season=${currentYear}&seasonType=REG`,
      `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`,
      `https://www.nfl.com/scores/`
    ]
    
    for (const url of urls) {
      try {
        const response = await fetch(url)
        if (response.ok) {
          const data = await response.json()
          console.log(`✅ Games fetched from: ${url}`)
          return data
        }
      } catch (error) {
        continue
      }
    }
    
    return null
    
  } catch (error) {
    console.error('Error fetching NFL official games:', error.message)
    return null
  }
}

export default {
  fetchNFLOfficialRoster,
  fetchNFLOfficialGames
}
