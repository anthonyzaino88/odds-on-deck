// Add all today's MLB playoff games

import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { MLB_TEAM_NAMES } from '../../../../lib/team-mapping.js'

const prisma = new PrismaClient()

export async function GET() {
  try {
    console.log('🏆 Adding MLB playoff games...')
    
    const results = {
      success: true,
      gamesAdded: 0,
      errors: [],
      timestamp: new Date().toISOString()
    }
    
    // Today's playoff games based on the schedule
    const playoffGames = [
      {
        id: 'CLE_at_BAL_2025-09-30',
        mlbGameId: '813001',
        away: { id: '114', name: 'Cleveland Guardians', abbr: 'CLE' },
        home: { id: '110', name: 'Baltimore Orioles', abbr: 'BAL' },
        date: '2025-09-30T17:00:00.000Z', // 1:00 PM ET
        status: 'scheduled',
        gameType: 'P',
        seriesDescription: 'AL Wild Card Game 1'
      },
      {
        id: 'SD_at_CHC_2025-09-30',
        mlbGameId: '813002', 
        away: { id: '135', name: 'San Diego Padres', abbr: 'SD' },
        home: { id: '112', name: 'Chicago Cubs', abbr: 'CHC' },
        date: '2025-09-30T19:00:00.000Z', // 3:00 PM ET
        status: 'scheduled',
        gameType: 'P',
        seriesDescription: 'NL Wild Card Game 1'
      },
      {
        id: 'CIN_at_LAD_2025-09-30',
        mlbGameId: '813003',
        away: { id: '113', name: 'Cincinnati Reds', abbr: 'CIN' },
        home: { id: '119', name: 'Los Angeles Dodgers', abbr: 'LAD' },
        date: '2025-09-30T01:00:00.000Z', // 9:00 PM ET (next day UTC)
        status: 'scheduled',
        gameType: 'P',
        seriesDescription: 'NL Wild Card Game 1'
      }
    ]
    
    for (const game of playoffGames) {
      try {
        // Get team abbreviations
        const awayAbbr = MLB_TEAM_NAMES[game.away.name] || game.away.abbr
        const homeAbbr = MLB_TEAM_NAMES[game.home.name] || game.home.abbr
        
        // Teams should already exist, just verify
        const awayTeam = await prisma.team.findUnique({ where: { id: game.away.id } })
        const homeTeam = await prisma.team.findUnique({ where: { id: game.home.id } })
        
        if (!awayTeam || !homeTeam) {
          console.log(`⚠️ Teams not found for ${game.away.abbr} @ ${game.home.abbr}, skipping`)
          continue
        }
        
        // Add the playoff game
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
        console.log(`✅ Added playoff game: ${game.away.abbr} @ ${game.home.abbr}`)
        
      } catch (error) {
        console.error(`Error adding playoff game ${game.id}:`, error.message)
        results.errors.push({
          game: `${game.away.abbr} @ ${game.home.abbr}`,
          error: error.message
        })
      }
    }
    
    console.log(`✅ Added ${results.gamesAdded} MLB playoff games`)
    
    return NextResponse.json(results)
    
  } catch (error) {
    console.error('❌ Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
