// Refresh lineups for all games that need them
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { fetchAndStoreLiveLineups } from '../../../../lib/live-data.js'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET() {
  try {
    console.log('🔄 Starting lineup refresh...')
    
    // First, check which games need lineups
    const gamesNeedingLineups = await prisma.game.findMany({
      where: {
        sport: 'mlb',
        mlbGameId: { not: null },
        status: { in: ['scheduled', 'pre_game', 'in_progress'] },
        lineups: {
          none: {} // Games with no lineups
        }
      },
      include: {
        home: true,
        away: true,
        lineups: true
      }
    })
    
    console.log(`Found ${gamesNeedingLineups.length} games needing lineups`)
    
    gamesNeedingLineups.forEach(game => {
      console.log(`  ${game.away.abbr} @ ${game.home.abbr} - ${game.lineups.length} lineups`)
    })
    
    // Fetch lineups for all games
    const lineupResult = await fetchAndStoreLiveLineups()
    
    // Also try to fetch lineups for games that already have some but might need updates
    const gamesWithLineups = await prisma.game.findMany({
      where: {
        sport: 'mlb',
        mlbGameId: { not: null },
        status: { in: ['scheduled', 'pre_game', 'in_progress'] },
        lineups: {
          some: {} // Games with some lineups
        }
      },
      include: {
        lineups: true
      }
    })
    
    console.log(`Found ${gamesWithLineups.length} games with existing lineups`)
    
    return NextResponse.json({
      success: true,
      gamesNeedingLineups: gamesNeedingLineups.length,
      gamesWithLineups: gamesWithLineups.length,
      lineupResult,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('❌ Lineup refresh error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

export async function POST() {
  return GET()
}
