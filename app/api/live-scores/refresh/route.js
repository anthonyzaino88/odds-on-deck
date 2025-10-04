// API endpoint to refresh live scores for active games

import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { fetchLiveGameData } from '../../../../lib/vendors/stats.js'

const prisma = new PrismaClient()

export async function GET() {
  try {
    console.log('🔄 Refreshing live scores...')
    
    const results = {
      success: true,
      gamesUpdated: 0,
      errors: [],
      timestamp: new Date().toISOString()
    }
    
    // Get all active MLB games
    const activeGames = await prisma.game.findMany({
      where: {
        sport: 'mlb',
        status: { in: ['in_progress', 'pre_game', 'final', 'Bottom'] }, // Include more statuses for testing
        mlbGameId: { not: null }
      },
      include: {
        home: true,
        away: true
      }
    })
    
    console.log(`Found ${activeGames.length} active MLB games`)
    console.log('Active games:', activeGames.map(g => `${g.away.abbr} @ ${g.home.abbr} (${g.status})`))
    
    for (const game of activeGames) {
      try {
        console.log(`Updating live data for ${game.away.abbr} @ ${game.home.abbr}`)
        
        // Fetch live game data from MLB API (bypass cache for live updates)
        const liveData = await fetchLiveGameData(game.mlbGameId, true) // Force refresh
        
        if (liveData) {
          // Update game with live data
          await prisma.game.update({
            where: { id: game.id },
            data: {
              homeScore: liveData.homeScore,
              awayScore: liveData.awayScore,
              status: liveData.status,
              inning: liveData.inning,
              inningHalf: liveData.inningHalf
            }
          })
          
          results.gamesUpdated++
          console.log(`✅ Updated ${game.away.abbr} @ ${game.home.abbr}: ${liveData.awayScore}-${liveData.homeScore}`)
        } else {
          console.log(`⚠️ No live data available for ${game.away.abbr} @ ${game.home.abbr}`)
        }
        
      } catch (error) {
        console.error(`❌ Error updating ${game.away.abbr} @ ${game.home.abbr}:`, error.message)
        results.errors.push({
          game: `${game.away.abbr} @ ${game.home.abbr}`,
          error: error.message
        })
      }
    }
    
    console.log(`✅ Live score refresh complete!`)
    console.log(`   Games updated: ${results.gamesUpdated}`)
    console.log(`   Errors: ${results.errors.length}`)
    
    return NextResponse.json(results)
    
  } catch (error) {
    console.error('❌ Error in live score refresh:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}
