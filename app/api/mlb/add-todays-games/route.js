// Add today's MLB games directly

import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { fetchSchedule } from '../../../../lib/vendors/stats.js'
import { MLB_TEAM_NAMES } from '../../../../lib/team-mapping.js'

const prisma = new PrismaClient()

export async function GET() {
  try {
    console.log('⚾ Adding today\'s MLB games...')
    
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    
    // Fetch today's games
    const scheduleData = await fetchSchedule(todayStr, { noCache: true })
    
    console.log(`Found ${scheduleData.length} games`)
    
    const results = {
      success: true,
      gamesAdded: 0,
      errors: [],
      timestamp: new Date().toISOString()
    }
    
    for (const game of scheduleData) {
      try {
        // Get team abbreviations
        const awayAbbr = MLB_TEAM_NAMES[game.away.name] || game.away.name.substring(0, 3).toUpperCase()
        const homeAbbr = MLB_TEAM_NAMES[game.home.name] || game.home.name.substring(0, 3).toUpperCase()
        
        // First, ensure teams exist (update existing if they do)
        await prisma.team.upsert({
          where: { id: game.away.id },
          update: { name: game.away.name, abbr: awayAbbr, sport: 'mlb' },
          create: {
            id: game.away.id,
            name: game.away.name,
            abbr: awayAbbr,
            sport: 'mlb'
          }
        })
        
        await prisma.team.upsert({
          where: { id: game.home.id },
          update: { name: game.home.name, abbr: homeAbbr, sport: 'mlb' },
          create: {
            id: game.home.id,
            name: game.home.name,
            abbr: homeAbbr,
            sport: 'mlb'
          }
        })
        
        // Add the game
        await prisma.game.create({
          data: {
            id: game.id,
            mlbGameId: game.mlbGameId,
            awayId: game.away.id,
            homeId: game.home.id,
            date: new Date(game.date),
            status: game.status,
            sport: 'mlb',
            season: '2025'
          }
        })
        
        results.gamesAdded++
        console.log(`✅ Added: ${game.away.abbr} @ ${game.home.abbr}`)
        
      } catch (error) {
        console.error(`Error adding game ${game.id}:`, error.message)
        results.errors.push({
          game: `${game.away.abbr} @ ${game.home.abbr}`,
          error: error.message
        })
      }
    }
    
    console.log(`✅ Added ${results.gamesAdded} MLB games`)
    
    return NextResponse.json(results)
    
  } catch (error) {
    console.error('❌ Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
