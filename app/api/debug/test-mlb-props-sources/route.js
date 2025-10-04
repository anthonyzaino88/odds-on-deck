// Test MLB props sources to understand where they're coming from

import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { getMLBPropsFromDatabase } from '../../../../lib/player-props.js'

const prisma = new PrismaClient()

export async function GET() {
  try {
    console.log('🎯 Testing MLB props sources...')
    
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // Check games with lineups
    const gamesWithLineups = await prisma.game.findMany({
      where: {
        date: {
          gte: today,
          lt: tomorrow,
        },
        status: { in: ['scheduled', 'pre_game', 'warmup', 'in_progress', 'Top', 'Bottom'] },
        lineups: {
          some: {}
        }
      },
      include: {
        home: true,
        away: true,
        lineups: {
          include: {
            player: true
          }
        }
      }
    })
    
    // Check all games (regardless of lineups)
    const allGames = await prisma.game.findMany({
      where: {
        date: {
          gte: today,
          lt: tomorrow,
        },
        status: { in: ['scheduled', 'pre_game', 'warmup', 'in_progress', 'Top', 'Bottom'] }
      },
      include: {
        home: true,
        away: true
      }
    })
    
    // Get database MLB props
    const dbMLBProps = await getMLBPropsFromDatabase()
    
    return NextResponse.json({
      success: true,
      breakdown: {
        gamesWithLineups: gamesWithLineups.length,
        allGames: allGames.length,
        dbMLBProps: dbMLBProps.length
      },
      gamesWithLineups: gamesWithLineups.map(g => ({
        id: g.id,
        matchup: `${g.away.abbr} @ ${g.home.abbr}`,
        lineupsCount: g.lineups.length,
        status: g.status
      })),
      allGames: allGames.map(g => ({
        id: g.id,
        matchup: `${g.away.abbr} @ ${g.home.abbr}`,
        status: g.status
      })),
      dbMLBProps: dbMLBProps.map(p => ({
        playerName: p.playerName,
        type: p.type,
        confidence: p.confidence
      }))
    })
    
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

