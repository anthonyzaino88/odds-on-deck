// ESPN NFL Roster API Integration

/**
 * ESPN Team ID mapping for NFL teams
 */
const ESPN_TEAM_IDS = {
  'ari': 22, 'atl': 1, 'bal': 33, 'buf': 2, 'car': 29, 'chi': 3,
  'cin': 4, 'cle': 5, 'dal': 6, 'den': 7, 'det': 8, 'gb': 9,
  'hou': 34, 'ind': 11, 'jax': 30, 'kc': 12, 'lv': 13, 'lac': 24,
  'lar': 14, 'mia': 15, 'min': 16, 'ne': 17, 'no': 18, 'nyg': 19,
  'nyj': 20, 'phi': 21, 'pit': 23, 'sf': 25, 'sea': 26, 'tb': 27,
  'ten': 10, 'was': 28
}

/**
 * Fetch live NFL team roster from ESPN API
 */
export async function fetchESPNTeamRoster(teamAbbr) {
  try {
    const teamId = ESPN_TEAM_IDS[teamAbbr.toLowerCase()]
    if (!teamId) {
      console.log(`No ESPN team ID for: ${teamAbbr}`)
      return null
    }
    
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`
    console.log(`Fetching ESPN roster for ${teamAbbr} (ID: ${teamId}): ${url}`)
    
    const response = await fetch(url)
    if (!response.ok) {
      console.error(`ESPN API error: ${response.status}`)
      return null
    }
    
    const data = await response.json()
    return mapESPNRosterData(data, teamAbbr)
    
  } catch (error) {
    console.error(`Error fetching ESPN roster for ${teamAbbr}:`, error.message)
    return null
  }
}

/**
 * Map ESPN roster data to our format
 */
function mapESPNRosterData(espnData, teamAbbr) {
  try {
    if (!espnData || !espnData.athletes || !Array.isArray(espnData.athletes)) {
      console.log(`No roster data for ${teamAbbr}`)
      return null
    }
    
    const roster = {
      QB: [],
      RB: [],
      WR: [],
      TE: [],
      OL: [],
      DL: [],
      LB: [],
      DB: [],
      ST: []
    }
    
    // Process all position groups
    espnData.athletes.forEach(positionGroup => {
      if (!positionGroup.items || !Array.isArray(positionGroup.items)) {
        return
      }
      
      positionGroup.items.forEach(athlete => {
      const position = athlete.position?.abbreviation || 'UNKNOWN'
      const name = athlete.displayName || athlete.fullName
      const jersey = athlete.jersey ? parseInt(athlete.jersey) : null
      const experience = athlete.experience?.years || 0
      const status = athlete.status?.name || 'Active'
      const height = athlete.displayHeight || null
      const weight = athlete.displayWeight || null
      const age = athlete.age || null
      const college = athlete.college?.name || null
      
      const playerData = {
        name,
        jersey,
        experience,
        position,
        status,
        height,
        weight,
        age,
        college,
        espnId: athlete.id
      }
      
      // Map to our position groups
      if (['QB'].includes(position)) {
        roster.QB.push(playerData)
      } else if (['RB', 'FB'].includes(position)) {
        roster.RB.push(playerData)
      } else if (['WR'].includes(position)) {
        roster.WR.push(playerData)
      } else if (['TE'].includes(position)) {
        roster.TE.push(playerData)
      } else if (['C', 'G', 'T', 'OT', 'OG'].includes(position)) {
        roster.OL.push(playerData)
      } else if (['DE', 'DT', 'NT'].includes(position)) {
        roster.DL.push(playerData)
      } else if (['LB', 'ILB', 'OLB'].includes(position)) {
        roster.LB.push(playerData)
      } else if (['CB', 'S', 'FS', 'SS'].includes(position)) {
        roster.DB.push(playerData)
      } else if (['K', 'P', 'LS'].includes(position)) {
        roster.ST.push(playerData)
        }
      })
    })
    
    // Sort by jersey number and prioritize active players
    Object.keys(roster).forEach(pos => {
      roster[pos] = roster[pos]
        .sort((a, b) => {
          // Active players first
          if (a.status === 'Active' && b.status !== 'Active') return -1
          if (b.status === 'Active' && a.status !== 'Active') return 1
          // Then by jersey number
          return (a.jersey || 99) - (b.jersey || 99)
        })
    })
    
    const totalPlayers = Object.values(roster).flat().length
    console.log(`Mapped ${totalPlayers} players across ${Object.keys(roster).length} position groups for ${teamAbbr}`)
    return roster
    
  } catch (error) {
    console.error(`Error mapping ESPN data for ${teamAbbr}:`, error.message)
    return null
  }
}

/**
 * Fetch all current NFL teams and their rosters from ESPN
 */
export async function fetchAllESPNRosters() {
  const teams = Object.keys(ESPN_TEAM_IDS)
  
  const allRosters = {}
  let successCount = 0
  
  console.log('🏈 Fetching live NFL rosters from ESPN API...')
  
  for (const team of teams) {
    try {
      const roster = await fetchESPNTeamRoster(team)
      if (roster) {
        allRosters[team] = roster
        successCount++
        console.log(`✅ Fetched roster for ${team.toUpperCase()} (${Object.keys(roster).reduce((acc, pos) => acc + roster[pos].length, 0)} players)`)
      }
      
      // Rate limiting - wait 200ms between calls to be respectful
      await new Promise(resolve => setTimeout(resolve, 200))
      
    } catch (error) {
      console.error(`Failed to fetch roster for ${team}:`, error.message)
    }
  }
  
  console.log(`✅ Successfully fetched ${successCount}/${teams.length} NFL team rosters from ESPN`)
  return allRosters
}

export default {
  fetchESPNTeamRoster,
  fetchAllESPNRosters
}
