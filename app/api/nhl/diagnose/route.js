// Diagnostic endpoint to see what's actually in the database

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET(request) {
  try {
    console.log('🔍 DIAGNOSING NHL DATA...')
    
    // Check teams
    const nhlTeams = await prisma.team.findMany({
      where: { sport: 'nhl' },
      select: {
        id: true,
        name: true,
        abbr: true
      }
    })
    
    console.log(`Found ${nhlTeams.length} NHL teams in database`)
    
    // Check games (with raw query to see ALL fields)
    const allGames = await prisma.game.findMany({
      where: {
        OR: [
          { sport: 'nhl' },
          { id: { startsWith: 'NHL_' } }
        ]
      },
      include: {
        home: true,
        away: true
      },
      orderBy: {
        date: 'desc'
      },
      take: 20
    })
    
    console.log(`Found ${allGames.length} NHL games in database`)
    
    // Get date range
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // Check today's games specifically
    const todaysGames = await prisma.game.findMany({
      where: {
        sport: 'nhl',
        date: {
          gte: new Date(today.setHours(0, 0, 0, 0)),
          lt: new Date(tomorrow.setHours(0, 0, 0, 0))
        }
      },
      include: {
        home: true,
        away: true
      }
    })
    
    console.log(`Found ${todaysGames.length} games for today`)
    
    return NextResponse.json({
      success: true,
      summary: {
        totalTeams: nhlTeams.length,
        totalGames: allGames.length,
        todaysGames: todaysGames.length
      },
      teams: nhlTeams.slice(0, 5).map(t => ({ id: t.id, name: t.name, abbr: t.abbr })),
      games: allGames.map(g => ({
        id: g.id,
        sport: g.sport,
        date: g.date,
        status: g.status,
        home: g.home?.abbr || g.homeId,
        away: g.away?.abbr || g.awayId,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        espnGameId: g.espnGameId
      })),
      todaysGamesDetail: todaysGames.map(g => ({
        id: g.id,
        date: g.date,
        home: g.home?.name,
        away: g.away?.name,
        status: g.status
      })),
      dates: {
        today: today.toISOString(),
        yesterday: yesterday.toISOString(),
        tomorrow: tomorrow.toISOString()
      }
    })
    
  } catch (error) {
    console.error('❌ Diagnostic error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}

