// API endpoint to refresh MLB playoff data

import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { fetchSchedule } from '../../../../lib/vendors/stats.js'
import { upsertTeam, upsertGame } from '../../../../lib/db.js'

const prisma = new PrismaClient()

export async function GET() {
  try {
    console.log('🏆 Starting MLB playoff data refresh...')
    
    const results = {
      success: true,
      teamsCreated: 0,
      gamesCreated: 0,
      timestamp: new Date().toISOString()
    }
    
    // Get today's date and check for playoff games
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    
    console.log(`📅 Checking for playoff games on ${todayStr}`)
    
    // Fetch schedule for today (playoffs should be active)
    const scheduleData = await fetchSchedule(todayStr, { noCache: true })
    
    console.log(`📊 Received ${scheduleData.length} games from MLB API`)
    
    if (scheduleData.length === 0) {
      console.log('⚠️ No games found for today - playoffs may not have started yet')
      return NextResponse.json({
        ...results,
        message: 'No playoff games found for today'
      })
    }
    
    // Process teams and games
    for (const game of scheduleData) {
      try {
        // Upsert teams
        await upsertTeam({
          id: game.away.id,
          name: game.away.name,
          abbr: game.away.abbr,
          sport: 'mlb'
        })
        
        await upsertTeam({
          id: game.home.id,
          name: game.home.name,
          abbr: game.home.abbr,
          sport: 'mlb'
        })
        
        results.teamsCreated += 2
        
        // Upsert game
        await upsertGame({
          id: game.id,
          mlbGameId: game.mlbGameId,
          awayId: game.away.id,
          homeId: game.home.id,
          date: game.date,
          status: game.status,
          sport: 'mlb',
          season: 2025,
          gameType: game.gameType || 'P', // P for Playoffs
          seriesGameNumber: game.seriesGameNumber || 1,
          seriesDescription: game.seriesDescription || 'Playoff Game'
        })
        
        results.gamesCreated++
        console.log(`✅ Added playoff game: ${game.away.abbr} @ ${game.home.abbr}`)
        
      } catch (error) {
        console.error(`Error processing game ${game.id}:`, error.message)
      }
    }
    
    console.log(`✅ MLB playoff refresh complete!`)
    console.log(`   Teams: ${results.teamsCreated}`)
    console.log(`   Games: ${results.gamesCreated}`)
    
    return NextResponse.json(results)
    
  } catch (error) {
    console.error('❌ Error refreshing MLB playoffs:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}
