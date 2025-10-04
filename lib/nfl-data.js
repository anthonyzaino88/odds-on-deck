// NFL Live Data Service - Fetch and store NFL game data

import { PrismaClient } from '@prisma/client'
import { fetchNFLSchedule, fetchNFLGameDetail, fetchNFLTeams } from './vendors/nfl-stats.js'

const prisma = new PrismaClient()

/**
 * Fetch and store NFL schedule for current week
 * @param {number|null} week - Week number (1-18), or null for current week
 * @param {number|null} seasonYear - Season year (e.g., 2024), or null for current year
 */
export async function fetchAndStoreNFLSchedule(week = null, seasonYear = null) {
  console.log(`Fetching NFL schedule for ${seasonYear || 'current'} season, week ${week || 'current'}...`)
  
  try {
    // Fetch games (teams are already seeded)
    const games = await fetchNFLSchedule(week, seasonYear)
    
    for (const game of games) {
      // Find existing teams by ID (homeId and awayId are already lowercase abbreviations)
      const homeTeam = await prisma.team.findFirst({ 
        where: { 
          OR: [
            { id: game.homeId },
            { abbr: game.homeId.toUpperCase() }
          ]
        } 
      })
      const awayTeam = await prisma.team.findFirst({ 
        where: { 
          OR: [
            { id: game.awayId },
            { abbr: game.awayId.toUpperCase() }
          ]
        } 
      })
      
      if (!homeTeam || !awayTeam) {
        console.log(`Skipping game ${game.id} - missing teams: ${game.awayId} @ ${game.homeId}`)
        continue
      }
      
      // Upsert game
      await prisma.game.upsert({
        where: { id: game.id },
        update: {
          sport: 'nfl',
          espnGameId: game.espnGameId,
          date: game.date,
          homeId: homeTeam.id,
          awayId: awayTeam.id,
          status: game.status,
          week: game.week,
          season: game.season.toString(),
          homeScore: game.homeScore,
          awayScore: game.awayScore
        },
        create: {
          id: game.id,
          sport: 'nfl',
          espnGameId: game.espnGameId,
          date: game.date,
          homeId: homeTeam.id,
          awayId: awayTeam.id,
          status: game.status,
          week: game.week,
          season: game.season.toString(),
          homeScore: game.homeScore,
          awayScore: game.awayScore
        }
      })
      
      console.log(`Stored NFL game: ${game.awayId.toUpperCase()} @ ${game.homeId.toUpperCase()}`)
    }
    
    console.log(`NFL schedule fetch completed. Stored ${games.length} games.`)
    return { success: true, games: games.length, teams: 32 }
    
  } catch (error) {
    console.error('Error in fetchAndStoreNFLSchedule:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Fetch and store live NFL game data
 */
export async function fetchAndStoreNFLLiveData() {
  console.log('Fetching NFL live game data...')

  try {
    // Get active NFL games
    const games = await prisma.game.findMany({
      where: {
        sport: 'nfl',
        espnGameId: { not: null },
        status: { in: ['scheduled', 'pre_game', 'in_progress', 'halftime'] }
      }
    })

    let gamesUpdated = 0

    for (const game of games) {
      try {
        console.log(`Fetching live data for NFL game ${game.id} (ESPN: ${game.espnGameId})`)

        const liveData = await fetchNFLGameDetail(game.espnGameId)

        if (liveData) {
          // Update game with live data
          await prisma.game.update({
            where: { id: game.id },
            data: {
              homeScore: liveData.homeScore,
              awayScore: liveData.awayScore,
              status: liveData.status,
              lastUpdate: liveData.lastUpdate
            }
          })

          // Update or create NFL-specific data
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

          gamesUpdated++
          console.log(`  Updated NFL live data: ${liveData.awayScore}-${liveData.homeScore} Q${liveData.quarter || '?'}`)
        }

        // Delay between API calls
        await new Promise(resolve => setTimeout(resolve, 100))

      } catch (error) {
        console.error(`Failed to fetch live data for NFL game ${game.id}:`, error)
      }
    }

    console.log(`NFL live game data fetch completed. Updated ${gamesUpdated} games.`)
    return { success: true, gamesUpdated }

  } catch (error) {
    console.error('Error in fetchAndStoreNFLLiveData:', error)
    return { success: false, error: error.message }
  }
}
