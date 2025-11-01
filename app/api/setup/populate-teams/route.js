// One-time setup endpoint to populate MLB, NFL, and NHL teams
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { fetchNFLTeams } from '../../../../lib/vendors/nfl-stats.js'
import { fetchNHLTeams } from '../../../../lib/vendors/nhl-stats.js'
import { prisma } from '../../../../lib/db.js'

// MLB teams from our seed file
const MLB_TEAMS = [
  { id: '108', name: 'Los Angeles Angels', abbr: 'LAA', sport: 'mlb' },
  { id: '109', name: 'Arizona Diamondbacks', abbr: 'ARI', sport: 'mlb' },
  { id: '110', name: 'Baltimore Orioles', abbr: 'BAL', sport: 'mlb' },
  { id: '111', name: 'Boston Red Sox', abbr: 'BOS', sport: 'mlb' },
  { id: '112', name: 'Chicago Cubs', abbr: 'CHC', sport: 'mlb' },
  { id: '113', name: 'Cincinnati Reds', abbr: 'CIN', sport: 'mlb' },
  { id: '114', name: 'Cleveland Guardians', abbr: 'CLE', sport: 'mlb' },
  { id: '115', name: 'Colorado Rockies', abbr: 'COL', sport: 'mlb' },
  { id: '116', name: 'Detroit Tigers', abbr: 'DET', sport: 'mlb' },
  { id: '117', name: 'Houston Astros', abbr: 'HOU', sport: 'mlb' },
  { id: '118', name: 'Kansas City Royals', abbr: 'KC', sport: 'mlb' },
  { id: '119', name: 'Los Angeles Dodgers', abbr: 'LAD', sport: 'mlb' },
  { id: '120', name: 'Washington Nationals', abbr: 'WSH', sport: 'mlb' },
  { id: '121', name: 'New York Mets', abbr: 'NYM', sport: 'mlb' },
  { id: '133', name: 'Oakland Athletics', abbr: 'OAK', sport: 'mlb' },
  { id: '134', name: 'Pittsburgh Pirates', abbr: 'PIT', sport: 'mlb' },
  { id: '135', name: 'San Diego Padres', abbr: 'SD', sport: 'mlb' },
  { id: '136', name: 'Seattle Mariners', abbr: 'SEA', sport: 'mlb' },
  { id: '137', name: 'San Francisco Giants', abbr: 'SF', sport: 'mlb' },
  { id: '138', name: 'St. Louis Cardinals', abbr: 'STL', sport: 'mlb' },
  { id: '139', name: 'Tampa Bay Rays', abbr: 'TB', sport: 'mlb' },
  { id: '140', name: 'Texas Rangers', abbr: 'TEX', sport: 'mlb' },
  { id: '141', name: 'Toronto Blue Jays', abbr: 'TOR', sport: 'mlb' },
  { id: '142', name: 'Minnesota Twins', abbr: 'MIN', sport: 'mlb' },
  { id: '143', name: 'Philadelphia Phillies', abbr: 'PHI', sport: 'mlb' },
  { id: '144', name: 'Atlanta Braves', abbr: 'ATL', sport: 'mlb' },
  { id: '145', name: 'Chicago White Sox', abbr: 'CWS', sport: 'mlb' },
  { id: '146', name: 'Miami Marlins', abbr: 'MIA', sport: 'mlb' },
  { id: '147', name: 'New York Yankees', abbr: 'NYY', sport: 'mlb' },
  { id: '158', name: 'Milwaukee Brewers', abbr: 'MIL', sport: 'mlb' },
]

async function populateTeams() {
  console.log('🚀 SETUP: Populating MLB, NFL, and NHL teams...')
    
    let mlbAdded = 0
    let mlbUpdated = 0
    let nflAdded = 0
    let nflUpdated = 0
    let nhlAdded = 0
    let nhlUpdated = 0
    
    // Upsert MLB teams
    console.log('⚾ Adding MLB teams...')
    for (const team of MLB_TEAMS) {
      try {
        const existing = await prisma.team.findUnique({
          where: { id: team.id }
        })
        
        if (existing) {
          await prisma.team.update({
            where: { id: team.id },
            data: {
              name: team.name,
              abbr: team.abbr,
              sport: team.sport
            }
          })
          mlbUpdated++
        } else {
          await prisma.team.create({
            data: {
              id: team.id,
              name: team.name,
              abbr: team.abbr,
              sport: team.sport
            }
          })
          mlbAdded++
        }
      } catch (error) {
        console.error(`Error upserting MLB team ${team.abbr}:`, error)
      }
    }
    console.log(`✅ MLB: ${mlbAdded} added, ${mlbUpdated} updated`)
    
    // Fetch and upsert NFL teams
    console.log('🏈 Fetching NFL teams from ESPN...')
    const nflTeams = await fetchNFLTeams()
    console.log(`Found ${nflTeams.length} NFL teams from API`)
    console.log('NFL teams sample:', nflTeams.slice(0, 2))
    
    for (const team of nflTeams) {
      try {
        // First check if team exists
        const existing = await prisma.team.findUnique({
          where: { id: team.id }
        })
        
        if (existing) {
          // Update existing team
          await prisma.team.update({
            where: { id: team.id },
            data: {
              name: team.name,
              abbr: team.abbr,
              sport: team.sport,
              league: team.league
            }
          })
          nflUpdated++
        } else {
          // Create new team
          await prisma.team.create({
            data: {
              id: team.id,
              name: team.name,
              abbr: team.abbr,
              sport: team.sport,
              league: team.league
            }
          })
          nflAdded++
        }
      } catch (error) {
        console.error(`Error upserting NFL team ${team.abbr}:`, error)
      }
    }
    
    // Fetch and upsert NHL teams
    console.log('🏒 Fetching NHL teams from ESPN...')
    const nhlTeams = await fetchNHLTeams()
    console.log(`Found ${nhlTeams.length} NHL teams from API`)
    
    for (const team of nhlTeams) {
      try {
        // First check if team exists
        const existing = await prisma.team.findUnique({
          where: { id: team.id }
        })
        
        if (existing) {
          // Update existing team
          await prisma.team.update({
            where: { id: team.id },
            data: {
              name: team.name,
              abbr: team.abbr,
              sport: team.sport
            }
          })
          nhlUpdated++
        } else {
          // Create new team
          await prisma.team.create({
            data: {
              id: team.id,
              name: team.name,
              abbr: team.abbr,
              sport: team.sport
            }
          })
          nhlAdded++
        }
      } catch (error) {
        console.error(`Error upserting NHL team ${team.abbr}:`, error)
      }
    }
    
    console.log('✅ SETUP COMPLETE!')
    
    return {
      success: true,
      results: {
        mlb: {
          added: mlbAdded,
          updated: mlbUpdated,
          total: mlbAdded + mlbUpdated
        },
        nfl: {
          added: nflAdded,
          updated: nflUpdated,
          total: nflAdded + nflUpdated
        },
        nhl: {
          added: nhlAdded,
          updated: nhlUpdated,
          total: nhlAdded + nhlUpdated
        }
      },
      message: `Successfully populated ${mlbAdded + nflAdded + nhlAdded} new teams and updated ${mlbUpdated + nflUpdated + nhlUpdated} existing teams`
    }
}

export async function GET(request) {
  try {
    const result = await populateTeams()
    return Response.json(result)
  } catch (error) {
    console.error('Setup error:', error)
    return Response.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const result = await populateTeams()
    return Response.json(result)
  } catch (error) {
    console.error('Setup error:', error)
    return Response.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}

