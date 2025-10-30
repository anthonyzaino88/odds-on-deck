// NFL Roster and Depth Chart Management with LIVE ESPN API

import { fetchAllESPNRosters, fetchESPNTeamRoster } from './vendors/espn-nfl-roster.js'

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

// Team name mapping
function getTeamName(abbr) {
  const teamNames = {
    'ari': 'Arizona Cardinals', 'atl': 'Atlanta Falcons', 'bal': 'Baltimore Ravens', 'buf': 'Buffalo Bills',
    'car': 'Carolina Panthers', 'chi': 'Chicago Bears', 'cin': 'Cincinnati Bengals', 'cle': 'Cleveland Browns',
    'dal': 'Dallas Cowboys', 'den': 'Denver Broncos', 'det': 'Detroit Lions', 'gb': 'Green Bay Packers',
    'hou': 'Houston Texans', 'ind': 'Indianapolis Colts', 'jax': 'Jacksonville Jaguars', 'kc': 'Kansas City Chiefs',
    'lv': 'Las Vegas Raiders', 'lac': 'Los Angeles Chargers', 'lar': 'Los Angeles Rams', 'mia': 'Miami Dolphins',
    'min': 'Minnesota Vikings', 'ne': 'New England Patriots', 'no': 'New Orleans Saints', 'nyg': 'New York Giants',
    'nyj': 'New York Jets', 'phi': 'Philadelphia Eagles', 'pit': 'Pittsburgh Steelers', 'sf': 'San Francisco 49ers',
    'sea': 'Seattle Seahawks', 'tb': 'Tampa Bay Buccaneers', 'ten': 'Tennessee Titans', 'was': 'Washington Commanders'
  }
  return teamNames[abbr.toLowerCase()] || abbr.toUpperCase()
}

// Position groups for depth chart organization
export const NFL_POSITION_GROUPS = {
  offense: {
    QB: ['QB'],
    RB: ['RB', 'FB'],
    WR: ['WR1', 'WR2', 'WR3', 'WR4', 'WR5'],
    TE: ['TE1', 'TE2'],
    OL: ['LT', 'LG', 'C', 'RG', 'RT']
  },
  defense: {
    DL: ['DE1', 'DT1', 'DT2', 'DE2'],
    LB: ['OLB1', 'MLB1', 'MLB2', 'OLB2'],
    DB: ['CB1', 'FS', 'SS', 'CB2', 'NCB']
  },
  special: {
    ST: ['K', 'P', 'LS', 'KR', 'PR']
  }
}

// Sample starter data - this would typically come from ESPN API
const NFL_STARTERS_SAMPLE = {
  'kc': {
    QB: [{ name: 'Patrick Mahomes', jersey: 15, experience: 8 }],
    RB: [{ name: 'Kareem Hunt', jersey: 29, experience: 7 }],
    WR1: [{ name: 'Travis Kelce', jersey: 87, experience: 12 }],
    WR2: [{ name: 'DeAndre Hopkins', jersey: 8, experience: 12 }]
  },
  'bal': {
    QB: [{ name: 'Lamar Jackson', jersey: 8, experience: 6 }],
    RB: [{ name: 'Derrick Henry', jersey: 22, experience: 8 }],
    WR1: [{ name: 'Mark Andrews', jersey: 89, experience: 6 }]
  },
  'gb': {
    QB: [{ name: 'Jordan Love', jersey: 10, experience: 3 }],
    RB: [{ name: 'Josh Jacobs', jersey: 8, experience: 6 }],
    WR1: [{ name: 'Jayden Reed', jersey: 11, experience: 2 }],
    WR2: [{ name: 'Romeo Doubs', jersey: 87, experience: 3 }]
  },
  'dal': {
    QB: [{ name: 'Dak Prescott', jersey: 4, experience: 9 }],
    RB: [{ name: 'Ezekiel Elliott', jersey: 15, experience: 8 }],
    WR1: [{ name: 'CeeDee Lamb', jersey: 88, experience: 5 }],
    WR2: [{ name: 'Amari Cooper', jersey: 5, experience: 10 }]
  },
  'cin': {
    QB: [{ name: 'Joe Burrow', jersey: 9, experience: 4 }],
    RB: [{ name: 'Chase Brown', jersey: 30, experience: 2 }],
    WR1: [{ name: 'Ja\'Marr Chase', jersey: 1, experience: 3 }],
    WR2: [{ name: 'Tee Higgins', jersey: 5, experience: 4 }]
  },
  'den': {
    QB: [{ name: 'Bo Nix', jersey: 10, experience: 1 }],
    RB: [{ name: 'Javonte Williams', jersey: 33, experience: 4 }],
    WR1: [{ name: 'Courtland Sutton', jersey: 14, experience: 7 }],
    WR2: [{ name: 'Josh Reynolds', jersey: 11, experience: 8 }]
  },
  'nyj': {
    QB: [{ name: 'Aaron Rodgers', jersey: 8, experience: 19 }],
    RB: [{ name: 'Breece Hall', jersey: 20, experience: 2 }],
    WR1: [{ name: 'Garrett Wilson', jersey: 17, experience: 2 }],
    WR2: [{ name: 'Mike Williams', jersey: 18, experience: 7 }]
  },
  'mia': {
    QB: [{ name: 'Tua Tagovailoa', jersey: 1, experience: 4 }],
    RB: [{ name: 'De\'Von Achane', jersey: 28, experience: 1 }],
    WR1: [{ name: 'Tyreek Hill', jersey: 10, experience: 8 }],
    WR2: [{ name: 'Jaylen Waddle', jersey: 17, experience: 3 }]
  }
}

/**
 * Fetch and store NFL team rosters from ESPN API
 */
export async function fetchAndStoreNFLRosters(season = '2025') {
  try {
    console.log(`🏈 Fetching LIVE NFL rosters from ESPN API for ${season} season...`)
    
    // Fetch all team rosters from ESPN
    const allRosters = await fetchAllESPNRosters()
    
    if (!allRosters || Object.keys(allRosters).length === 0) {
      console.log('No roster data received from ESPN')
      return { success: false, message: 'No roster data received' }
    }
    
    let totalPlayersAdded = 0
    let teamsProcessed = 0
    
    // Process each team's roster
    for (const [teamAbbr, roster] of Object.entries(allRosters)) {
      try {
        console.log(`  📡 Processing roster for ${teamAbbr.toUpperCase()}...`)
        
        // Find or create team
        const team = await prisma.team.upsert({
          where: { abbr: teamAbbr.toUpperCase() },
          update: {
            name: getTeamName(teamAbbr),
            sport: 'nfl'
          },
          create: {
            abbr: teamAbbr.toUpperCase(),
            name: getTeamName(teamAbbr),
            sport: 'nfl'
          }
        })
        
        // Clear existing roster for this team
        await prisma.player.updateMany({
          where: { teamId: team.id },
          data: { teamId: null }
        })
        
        // Clear existing NFL roster entries for this team
        await prisma.nFLRosterEntry.deleteMany({
          where: { teamId: team.id, season: season }
        })
        
        // Add players from ESPN roster
        for (const [position, players] of Object.entries(roster)) {
          for (const playerData of players) {
            if (playerData.status === 'Active') {
              // Create or find player
              const player = await prisma.player.upsert({
                where: { 
                  name_team: {
                    name: playerData.name,
                    teamId: team.id
                  }
                },
                update: {
                  position: playerData.position,
                  jersey: playerData.jersey,
                  teamId: team.id,
                  sport: 'nfl'
                },
                create: {
                  name: playerData.name,
                  position: playerData.position,
                  jersey: playerData.jersey,
                  teamId: team.id,
                  sport: 'nfl'
                }
              })
              
              // Create NFL roster entry
              await prisma.nFLRosterEntry.create({
                data: {
                  playerId: player.id,
                  teamId: team.id,
                  season: season,
                  positionGroup: position,
                  specificPosition: playerData.position,
                  depthOrder: 1, // Assume all ESPN players are starters for now
                  isActive: true,
                  injuryStatus: playerData.injuryStatus || 'Healthy'
                }
              })
              
              totalPlayersAdded++
            }
          }
        }
        
        teamsProcessed++
        console.log(`    ✅ Processed ${teamAbbr.toUpperCase()} roster (${Object.values(roster).flat().length} players)`)
        
      } catch (error) {
        console.error(`  ❌ Error processing roster for ${teamAbbr}:`, error.message)
      }
    }
    
    console.log(`✅ NFL Rosters Updated:`)
    console.log(`   • Teams processed: ${teamsProcessed}`)
    console.log(`   • Players added: ${totalPlayersAdded}`)
    
    return {
      success: true,
      teamsProcessed,
      totalPlayersAdded,
      message: `Processed ${teamsProcessed} teams with ${totalPlayersAdded} players`
    }
    
  } catch (error) {
    console.error('❌ Error fetching NFL rosters:', error.message)
    return { success: false, message: error.message }
  }
}

/**
 * Get team roster with depth chart
 */
export async function getTeamRoster(teamId, season = '2025') {
  try {
    const roster = await prisma.nFLRosterEntry.findMany({
      where: {
        teamId: teamId,
        season: season,
        isActive: true
      },
      include: {
        player: true,
        team: true
      },
      orderBy: [
        { positionGroup: 'asc' },
        { specificPosition: 'asc' },
        { depthOrder: 'asc' }
      ]
    })
    
    // Group by position
    const depthChart = {}
    
    roster.forEach(entry => {
      if (!depthChart[entry.positionGroup]) {
        depthChart[entry.positionGroup] = {}
      }
      if (!depthChart[entry.positionGroup][entry.specificPosition]) {
        depthChart[entry.positionGroup][entry.specificPosition] = []
      }
      
      depthChart[entry.positionGroup][entry.specificPosition].push({
        ...entry.player,
        depthOrder: entry.depthOrder,
        injuryStatus: entry.injuryStatus,
        specificPosition: entry.specificPosition
      })
    })
    
    return depthChart
    
  } catch (error) {
    console.error('Error getting team roster:', error)
    return {}
  }
}

/**
 * Get starting lineup for a game
 */
export async function getGameStarters(gameId) {
  try {
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        home: true,
        away: true
      }
    })
    
    if (!game) return null
    
    const homeStarters = await getTeamStarters(game.homeId)
    const awayStarters = await getTeamStarters(game.awayId)
    
    return {
      home: {
        team: game.home,
        starters: homeStarters
      },
      away: {
        team: game.away,
        starters: awayStarters
      }
    }
    
  } catch (error) {
    console.error('Error getting game starters:', error)
    return null
  }
}

/**
 * Get team starters (depth order 1)
 */
export async function getTeamStarters(teamId, season = '2025') {
  try {
    const starters = await prisma.nFLRosterEntry.findMany({
      where: {
        teamId: teamId,
        season: season,
        depthOrder: 1,
        isActive: true
      },
      include: {
        player: true
      },
      orderBy: [
        { positionGroup: 'asc' },
        { specificPosition: 'asc' }
      ]
    })
    
    return starters.map(entry => ({
      ...entry.player,
      position: entry.specificPosition,
      injuryStatus: entry.injuryStatus
    }))
    
  } catch (error) {
    console.error('Error getting team starters:', error)
    return []
  }
}

/**
 * Update player injury status
 */
export async function updatePlayerInjuryStatus(playerId, teamId, injuryStatus, season = '2024') {
  try {
    await prisma.nFLRosterEntry.updateMany({
      where: {
        playerId: playerId,
        teamId: teamId,
        season: season
      },
      data: {
        injuryStatus: injuryStatus
      }
    })
    
    console.log(`Updated ${playerId} injury status to: ${injuryStatus}`)
    return { success: true }
    
  } catch (error) {
    console.error('Error updating injury status:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Get injury report for a team
 */
export async function getTeamInjuryReport(teamId, season = '2024') {
  try {
    const injuredPlayers = await prisma.nFLRosterEntry.findMany({
      where: {
        teamId: teamId,
        season: season,
        injuryStatus: {
          not: 'healthy'
        }
      },
      include: {
        player: true
      },
      orderBy: [
        { positionGroup: 'asc' },
        { depthOrder: 'asc' }
      ]
    })
    
    return injuredPlayers.map(entry => ({
      ...entry.player,
      position: entry.specificPosition,
      injuryStatus: entry.injuryStatus,
      depthOrder: entry.depthOrder
    }))
    
  } catch (error) {
    console.error('Error getting injury report:', error)
    return []
  }
}

export default {
  fetchAndStoreNFLRosters,
  getTeamRoster,
  getGameStarters,
  getTeamStarters,
  updatePlayerInjuryStatus,
  getTeamInjuryReport
}
