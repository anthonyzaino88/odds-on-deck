// Check MLB player props in database

import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET() {
  try {
    console.log('🎯 Checking MLB player props in database...')
    
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayAfterTomorrow = new Date(today)
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
    
    // Check MLB games
    const mlbGames = await prisma.game.findMany({
      where: {
        sport: 'mlb',
        date: {
          gte: today,
          lt: dayAfterTomorrow
        }
      },
      include: {
        home: true,
        away: true
      }
    })
    
    // Check MLB player props
    const mlbProps = await prisma.nFLPlayerProp.findMany({
      where: {
        game: {
          sport: 'mlb',
          date: {
            gte: today,
            lt: dayAfterTomorrow
          }
        }
      },
      include: {
        player: true,
        game: {
          include: {
            home: true,
            away: true
          }
        }
      }
    })
    
    return NextResponse.json({
      success: true,
      currentTime: new Date().toISOString(),
      mlbGames: mlbGames.map(g => ({
        id: g.id,
        matchup: `${g.away.abbr} @ ${g.home.abbr}`,
        date: g.date,
        status: g.status,
        hasLineups: g.lineups ? g.lineups.length > 0 : false
      })),
      mlbProps: mlbProps.map(p => ({
        id: p.id,
        playerName: p.player?.fullName,
        propType: p.propType,
        threshold: p.threshold,
        projection: p.projection,
        edge: p.edge,
        game: `${p.game?.away?.abbr} @ ${p.game?.home?.abbr}`
      })),
      stats: {
        mlbGamesCount: mlbGames.length,
        mlbPropsCount: mlbProps.length
      }
    })
    
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

