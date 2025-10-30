// Debug endpoint to check team fetching
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { fetchNFLTeams } from '../../../../lib/vendors/nfl-stats.js'
import { fetchNHLTeams } from '../../../../lib/vendors/nhl-stats.js'
import { prisma } from '../../../../lib/db.js'

export async function GET() {
  try {
    console.log('🔍 DEBUG: Fetching teams from ESPN APIs...')
    
    // Fetch teams from APIs
    const nflTeams = await fetchNFLTeams()
    const nhlTeams = await fetchNHLTeams()
    
    // Check what's in the database
    const dbTeams = await prisma.team.findMany({
      select: {
        id: true,
        name: true,
        abbr: true,
        sport: true
      },
      orderBy: {
        sport: 'asc'
      }
    })
    
    // Group by sport
    const teamsBySport = {
      mlb: dbTeams.filter(t => t.sport === 'baseball_mlb' || t.sport === 'mlb' || (!t.sport && parseInt(t.id) > 100 && parseInt(t.id) < 160)),
      nfl: dbTeams.filter(t => t.sport === 'nfl' || t.sport === 'football_nfl'),
      nhl: dbTeams.filter(t => t.sport === 'nhl' || t.sport === 'hockey_nhl')
    }
    
    return Response.json({
      success: true,
      apiResults: {
        nflTeams: {
          count: nflTeams.length,
          sample: nflTeams.slice(0, 3),
          all: nflTeams
        },
        nhlTeams: {
          count: nhlTeams.length,
          sample: nhlTeams.slice(0, 3),
          all: nhlTeams
        }
      },
      databaseTeams: {
        total: dbTeams.length,
        byType: {
          mlb: teamsBySport.mlb.length,
          nfl: teamsBySport.nfl.length,
          nhl: teamsBySport.nhl.length,
          unknown: dbTeams.filter(t => !t.sport || t.sport === null).length
        },
        allTeams: dbTeams
      }
    })
  } catch (error) {
    console.error('Debug error:', error)
    return Response.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}

