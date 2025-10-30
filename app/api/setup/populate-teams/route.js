// One-time setup endpoint to populate NFL and NHL teams
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { fetchNFLTeams } from '../../../../lib/vendors/nfl-stats.js'
import { fetchNHLTeams } from '../../../../lib/vendors/nhl-stats.js'
import { prisma } from '../../../../lib/db.js'

export async function POST(request) {
  try {
    const { authorization } = await request.headers
    
    // Simple auth check (you can remove this after running once)
    // if (authorization !== 'Bearer setup-teams-2025') {
    //   return Response.json({ error: 'Unauthorized' }, { status: 401 })
    // }
    
    console.log('🚀 SETUP: Populating NFL and NHL teams...')
    
    let nflAdded = 0
    let nflUpdated = 0
    let nhlAdded = 0
    let nhlUpdated = 0
    
    // Fetch and upsert NFL teams
    console.log('🏈 Fetching NFL teams from ESPN...')
    const nflTeams = await fetchNFLTeams()
    console.log(`Found ${nflTeams.length} NFL teams from API`)
    
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
    
    return Response.json({
      success: true,
      results: {
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
      message: `Successfully populated ${nflAdded + nhlAdded} new teams and updated ${nflUpdated + nhlUpdated} existing teams`
    })
  } catch (error) {
    console.error('Setup error:', error)
    return Response.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}

