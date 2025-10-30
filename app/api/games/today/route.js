// API endpoint to fetch today's games data

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getTodaysGames, prisma } from '../../../../lib/db.js'
import { getThisWeeksNFLGames } from '../../../../lib/nfl-db.js'

export async function GET() {
  try {
    console.log('🎯 Fetching today\'s games data...')
    
    const [mlbGames, nflGames] = await Promise.all([
      getTodaysGames(),
      getThisWeeksNFLGames()
    ])
    
    // Fetch pitcher names for MLB games
    
    const mlbGamesWithPitchers = await Promise.all(
      mlbGames.map(async (game) => {
        const [homePitcher, awayPitcher] = await Promise.all([
          game.probableHomePitcherId ? 
            prisma.player.findUnique({ where: { id: game.probableHomePitcherId } }) : 
            null,
          game.probableAwayPitcherId ? 
            prisma.player.findUnique({ where: { id: game.probableAwayPitcherId } }) : 
            null
        ])
        
        return {
          ...game,
          probableHomePitcher: homePitcher,
          probableAwayPitcher: awayPitcher
        }
      })
    )
    
    return NextResponse.json({
      success: true,
      games: {
        mlb: mlbGamesWithPitchers,
        nfl: nflGames
      },
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('Error fetching today\'s games:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}
