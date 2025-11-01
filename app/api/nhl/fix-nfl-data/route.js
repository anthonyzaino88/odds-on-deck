// Fix NHL games that incorrectly have NFLGameData records
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function POST(request) {
  try {
    console.log('🔧 Fixing NHL games with incorrect NFLGameData...')
    
    // Find all NHL games
    const nhlGames = await prisma.game.findMany({
      where: {
        sport: 'nhl'
      },
      include: {
        nflData: true
      }
    })
    
    console.log(`Found ${nhlGames.length} NHL games`)
    
    let fixedCount = 0
    let deletedCount = 0
    
    for (const game of nhlGames) {
      // If NHL game has NFLGameData, delete it
      if (game.nflData) {
        await prisma.nFLGameData.delete({
          where: { gameId: game.id }
        }).catch(() => {
          // Ignore if already deleted
        })
        deletedCount++
        console.log(`🗑️ Deleted NFLGameData for NHL game ${game.id}`)
      }
      
      // Ensure sport is set correctly
      if (game.sport !== 'nhl') {
        await prisma.game.update({
          where: { id: game.id },
          data: { sport: 'nhl' }
        })
        fixedCount++
        console.log(`✅ Fixed sport field for game ${game.id}`)
      }
    }
    
    return NextResponse.json({
      success: true,
      message: `Fixed ${fixedCount} NHL games and deleted ${deletedCount} incorrect NFLGameData records`,
      stats: {
        totalNHLGames: nhlGames.length,
        fixed: fixedCount,
        deletedNFLData: deletedCount
      }
    })
  } catch (error) {
    console.error('❌ Error fixing NHL games:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}

export async function GET(request) {
  try {
    // Check status - find NHL games with NFLGameData
    const nhlGamesWithNFLData = await prisma.game.findMany({
      where: {
        sport: 'nhl',
        nflData: { isNot: null }
      },
      select: {
        id: true,
        sport: true
      }
    })
    
    return NextResponse.json({
      needsFix: nhlGamesWithNFLData.length > 0,
      count: nhlGamesWithNFLData.length,
      games: nhlGamesWithNFLData
    })
  } catch (error) {
    return NextResponse.json({
      error: error.message
    }, { status: 500 })
  }
}

