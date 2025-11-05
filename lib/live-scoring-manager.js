// Live Scoring Manager - Optimized for real-time game updates
// Maintains streamlined data flow while providing live scoring

import { PrismaClient } from '@prisma/client'
import { fetchLiveGameData } from './vendors/stats.js'
import { fetchNFLGameDetail } from './vendors/nfl-stats.js'
import { fetchNHLGameDetail } from './vendors/nhl-stats.js'

const prisma = new PrismaClient()

// Live scoring cache for performance
const liveScoringCache = {
  lastUpdate: null,
  updateInterval: 15000, // 15 seconds for live games
  isUpdating: false,
  activeGames: new Set()
}

/**
 * Get live scoring data for active games only
 * This is optimized to only fetch data for games that are actually live
 */
export async function getLiveScoringData() {
  try {
    console.log('🏈 Getting live scoring data...')
    
    // Get only active games (in progress, warmup, halftime)
    const activeGames = await prisma.game.findMany({
      where: {
        OR: [
          // MLB active games
          {
            sport: 'mlb',
            status: { in: ['in_progress', 'warmup'] },
            mlbGameId: { not: null }
          },
          // NFL active games  
          {
            sport: 'nfl',
            status: { in: ['in_progress', 'halftime'] },
            espnGameId: { not: null }
          },
          // NHL active games
          {
            sport: 'nhl',
            status: { in: ['in_progress'] },
            espnGameId: { not: null }
          }
        ]
      },
      include: {
        home: true,
        away: true,
        nflData: true
      },
      orderBy: { date: 'asc' }
    })
    
    console.log(`📊 Found ${activeGames.length} active games for live scoring`)
    
    // Update live data for active games
    const updatedGames = await updateLiveDataForActiveGames(activeGames)
    
    return {
      activeGames: updatedGames,
      lastUpdate: new Date(),
      totalActive: activeGames.length
    }
    
  } catch (error) {
    console.error('❌ Error getting live scoring data:', error)
    return {
      activeGames: [],
      lastUpdate: new Date(),
      totalActive: 0,
      error: error.message
    }
  }
}

/**
 * Update live data for active games only
 * This is the core function that fetches and stores live scores
 */
async function updateLiveDataForActiveGames(activeGames) {
  if (liveScoringCache.isUpdating) {
    console.log('⏳ Live scoring update already in progress, skipping...')
    return activeGames
  }
  
  liveScoringCache.isUpdating = true
  
  try {
    const updatedGames = []
    
    for (const game of activeGames) {
      try {
        let liveData = null
        
        // Fetch live data based on sport
        if (game.sport === 'mlb' && game.mlbGameId) {
          liveData = await fetchLiveGameData(game.mlbGameId, true) // Force refresh
        } else if (game.sport === 'nfl' && game.espnGameId) {
          liveData = await fetchNFLGameDetail(game.espnGameId)
        } else if (game.sport === 'nhl' && game.espnGameId) {
          liveData = await fetchNHLGameDetail(game.espnGameId)
        }
        
        if (liveData) {
          // Update game with live data
          const updatedGame = await updateGameWithLiveData(game, liveData)
          updatedGames.push(updatedGame)
          
          console.log(`✅ Updated ${game.away.abbr} @ ${game.home.abbr}: ${liveData.awayScore || 0}-${liveData.homeScore || 0}`)
        } else {
          // Keep existing game data if no live data available
          updatedGames.push(game)
          console.log(`⚠️ No live data for ${game.away.abbr} @ ${game.home.abbr}`)
        }
        
        // Small delay between API calls to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200))
        
      } catch (error) {
        console.error(`❌ Error updating ${game.away.abbr} @ ${game.home.abbr}:`, error.message)
        // Keep existing game data on error
        updatedGames.push(game)
      }
    }
    
    liveScoringCache.lastUpdate = new Date()
    return updatedGames
    
  } finally {
    liveScoringCache.isUpdating = false
  }
}

/**
 * Update a single game with live data
 */
async function updateGameWithLiveData(game, liveData) {
  try {
    // Update main game record
    const updatedGame = await prisma.game.update({
      where: { id: game.id },
      data: {
        homeScore: liveData.homeScore,
        awayScore: liveData.awayScore,
        status: liveData.status,
        lastUpdate: new Date(),
        // MLB specific fields
        ...(game.sport === 'mlb' && {
          inning: liveData.inning,
          inningHalf: liveData.inningHalf,
          outs: liveData.outs,
          balls: liveData.balls,
          strikes: liveData.strikes,
          runnerOn1st: liveData.runnerOn1st,
          runnerOn2nd: liveData.runnerOn2nd,
          runnerOn3rd: liveData.runnerOn3rd,
          currentBatterId: liveData.currentBatterId,
          currentPitcherId: liveData.currentPitcherId,
          lastPlay: liveData.lastPlay
        }),
        // NHL specific fields (store period info in lastPlay for now)
        ...(game.sport === 'nhl' && liveData.period && {
          lastPlay: liveData.periodDescriptor || `Period ${liveData.period}${liveData.clock ? ` - ${liveData.clock}` : ''}`
        })
      },
      include: {
        home: true,
        away: true,
        nflData: true
      }
    })
    
    // Update NFL-specific data if applicable
    if (game.sport === 'nfl' && liveData.quarter !== undefined) {
      await prisma.nFLGameData.upsert({
        where: { gameId: game.id },
        update: {
          quarter: liveData.quarter,
          timeLeft: liveData.timeLeft,
          possession: liveData.possession,
          down: liveData.down,
          distance: liveData.distance,
          yardLine: liveData.yardLine,
          redZone: liveData.redZone,
          lastPlay: liveData.lastPlay
        },
        create: {
          gameId: game.id,
          quarter: liveData.quarter,
          timeLeft: liveData.timeLeft,
          possession: liveData.possession,
          down: liveData.down,
          distance: liveData.distance,
          yardLine: liveData.yardLine,
          redZone: liveData.redZone,
          lastPlay: liveData.lastPlay
        }
      })
    }
    
    return updatedGame
    
  } catch (error) {
    console.error(`❌ Error updating game ${game.id}:`, error)
    return game // Return original game on error
  }
}

/**
 * Check if live scoring should be updated
 * Always update on startup to ensure fresh data
 */
export function shouldUpdateLiveScoring() {
  // Always update if no previous update (startup)
  if (!liveScoringCache.lastUpdate) return true
  
  // Check if enough time has passed
  const timeSinceLastUpdate = Date.now() - liveScoringCache.lastUpdate.getTime()
  const isStale = timeSinceLastUpdate > liveScoringCache.updateInterval
  
  // Also check if data is from a previous day (force refresh for new day)
  const lastUpdateDate = new Date(liveScoringCache.lastUpdate)
  const today = new Date()
  const isNewDay = lastUpdateDate.toDateString() !== today.toDateString()
  
  return isStale || isNewDay
}

/**
 * Get live scoring status
 */
export function getLiveScoringStatus() {
  return {
    lastUpdate: liveScoringCache.lastUpdate,
    isUpdating: liveScoringCache.isUpdating,
    updateInterval: liveScoringCache.updateInterval,
    shouldUpdate: shouldUpdateLiveScoring()
  }
}

/**
 * Force update live scoring (for manual refresh)
 */
export async function forceUpdateLiveScoring() {
  console.log('⚡ Force updating live scoring...')
  liveScoringCache.lastUpdate = null // Force update
  return await getLiveScoringData()
}

