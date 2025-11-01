// One-time setup endpoint to populate games for MLB, NFL, and NHL
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { fetchSchedule as fetchMLBGames } from '../../../../lib/vendors/stats.js'
import { fetchNFLSchedule } from '../../../../lib/vendors/nfl-stats.js'
import { fetchNHLSchedule } from '../../../../lib/vendors/nhl-stats.js'
import { prisma } from '../../../../lib/db.js'

async function populateGames() {
  console.log('🚀 SETUP: Populating games for MLB, NFL, and NHL...')
  
  let mlbAdded = 0
  let nflAdded = 0
  let nhlAdded = 0
  const errors = []
  
  try {
    // Fetch MLB games (playoffs)
    console.log('⚾ Fetching MLB games...')
    const mlbGames = await fetchMLBGames({ useLocalDate: true })
    console.log(`Found ${mlbGames.length} MLB games from API`)
    
    for (const game of mlbGames) {
      try {
        // Verify teams exist
        const homeTeam = await prisma.team.findUnique({ where: { id: game.homeId } })
        const awayTeam = await prisma.team.findUnique({ where: { id: game.awayId } })
        
        if (!homeTeam || !awayTeam) {
          console.log(`⚠️ Skipping MLB game ${game.id}: Missing teams (home: ${homeTeam ? '✓' : '✗'}, away: ${awayTeam ? '✓' : '✗'})`)
          continue
        }
        
        await prisma.game.upsert({
          where: { id: game.id },
          update: {
            date: game.date,
            status: game.status,
            homeScore: game.homeScore,
            awayScore: game.awayScore,
            espnGameId: game.espnGameId
          },
          create: {
            id: game.id,
            sport: 'mlb',
            date: game.date,
            homeId: game.homeId,
            awayId: game.awayId,
            status: game.status || 'scheduled',
            homeScore: game.homeScore,
            awayScore: game.awayScore,
            espnGameId: game.espnGameId
          }
        })
        mlbAdded++
      } catch (error) {
        console.error(`Error upserting MLB game ${game.id}:`, error.message)
        errors.push({ sport: 'mlb', game: game.id, error: error.message })
      }
    }
    console.log(`✅ MLB: ${mlbAdded} games added/updated`)
    
  } catch (error) {
    console.error('Error fetching MLB games:', error)
    errors.push({ sport: 'mlb', error: error.message })
  }
  
  try {
    // Fetch NFL games (current week)
    console.log('🏈 Fetching NFL games...')
    const nflGames = await fetchNFLSchedule()
    console.log(`Found ${nflGames.length} NFL games from API`)
    
    for (const game of nflGames) {
      try {
        // Convert NFL team IDs to strings
        const homeId = `NFL_${game.homeId}`
        const awayId = `NFL_${game.awayId}`
        
        // Verify teams exist
        const homeTeam = await prisma.team.findUnique({ where: { id: homeId } })
        const awayTeam = await prisma.team.findUnique({ where: { id: awayId } })
        
        if (!homeTeam || !awayTeam) {
          console.log(`⚠️ Skipping NFL game ${game.id}: Missing teams (home: ${homeTeam ? '✓' : '✗'}, away: ${awayTeam ? '✓' : '✗'})`)
          continue
        }
        
        await prisma.game.upsert({
          where: { id: game.id },
          update: {
            sport: 'nfl', // Ensure sport is always set correctly on update
            date: game.date,
            status: game.status,
            homeScore: game.homeScore,
            awayScore: game.awayScore,
            espnGameId: game.espnGameId
          },
          create: {
            id: game.id,
            sport: 'nfl',
            date: game.date,
            homeId: homeId,
            awayId: awayId,
            status: game.status || 'scheduled',
            homeScore: game.homeScore,
            awayScore: game.awayScore,
            espnGameId: game.espnGameId
          }
        })
        nflAdded++
      } catch (error) {
        console.error(`Error upserting NFL game ${game.id}:`, error.message)
        errors.push({ sport: 'nfl', game: game.id, error: error.message })
      }
    }
    console.log(`✅ NFL: ${nflAdded} games added/updated`)
    
  } catch (error) {
    console.error('Error fetching NFL games:', error)
    errors.push({ sport: 'nfl', error: error.message })
  }
  
  try {
    // Fetch NHL games (yesterday, today, tomorrow)
    console.log('🏒 Fetching NHL games...')
    
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    const dates = [
      yesterday.toISOString().split('T')[0],
      today.toISOString().split('T')[0],
      tomorrow.toISOString().split('T')[0]
    ]
    
    const allNHLGames = []
    const seenGameIds = new Set()
    
    for (const date of dates) {
      const gamesForDate = await fetchNHLSchedule(date)
      for (const game of gamesForDate) {
        if (!seenGameIds.has(game.id)) {
          seenGameIds.add(game.id)
          allNHLGames.push(game)
        }
      }
    }
    
    console.log(`Found ${allNHLGames.length} unique NHL games from API`)
    
    for (const game of allNHLGames) {
      try {
        // Convert NHL team abbrs to IDs
        const homeId = `NHL_${game.homeId}`
        const awayId = `NHL_${game.awayId}`
        
        // Verify teams exist
        const homeTeam = await prisma.team.findUnique({ where: { id: homeId } })
        const awayTeam = await prisma.team.findUnique({ where: { id: awayId } })
        
        if (!homeTeam || !awayTeam) {
          console.log(`⚠️ Skipping NHL game ${game.id}: Missing teams (home: ${homeTeam ? '✓' : '✗'} ${homeId}, away: ${awayTeam ? '✓' : '✗'} ${awayId})`)
          continue
        }
        
        await prisma.game.upsert({
          where: { id: game.id },
          update: {
            sport: 'nhl', // Ensure sport is always set correctly on update
            date: game.date,
            status: game.status,
            homeScore: game.homeScore,
            awayScore: game.awayScore,
            espnGameId: game.espnGameId
          },
          create: {
            id: game.id,
            sport: 'nhl',
            date: game.date,
            homeId: homeId,
            awayId: awayId,
            status: game.status || 'scheduled',
            homeScore: game.homeScore,
            awayScore: game.awayScore,
            espnGameId: game.espnGameId
          }
        })
        nhlAdded++
      } catch (error) {
        console.error(`Error upserting NHL game ${game.id}:`, error.message)
        errors.push({ sport: 'nhl', game: game.id, error: error.message })
      }
    }
    console.log(`✅ NHL: ${nhlAdded} games added/updated`)
    
  } catch (error) {
    console.error('Error fetching NHL games:', error)
    errors.push({ sport: 'nhl', error: error.message })
  }
  
  console.log('✅ SETUP COMPLETE!')
  
  return {
    success: true,
    results: {
      mlb: { added: mlbAdded },
      nfl: { added: nflAdded },
      nhl: { added: nhlAdded },
      total: mlbAdded + nflAdded + nhlAdded
    },
    errors: errors.length > 0 ? errors : undefined,
    message: `Successfully populated ${mlbAdded + nflAdded + nhlAdded} games (MLB: ${mlbAdded}, NFL: ${nflAdded}, NHL: ${nhlAdded})`
  }
}

export async function GET(request) {
  try {
    const result = await populateGames()
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
    const result = await populateGames()
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

