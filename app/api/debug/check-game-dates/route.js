// Debug endpoint to check what dates are actually in the database

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'
import { getCurrentDateET, getTodaysGamesRange } from '../../../../lib/date-utils.js'

export async function GET() {
  try {
    const currentET = getCurrentDateET()
    const { start, end } = getTodaysGamesRange()
    
    // Get all recent games
    const allGames = await prisma.game.findMany({
      where: {
        date: {
          gte: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // Last 2 days
          lte: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)  // Next 2 days
        }
      },
      include: {
        home: true,
        away: true
      },
      orderBy: { date: 'asc' }
    })
    
    const mlbGames = allGames.filter(g => g.sport === 'mlb')
    const nflGames = allGames.filter(g => g.sport === 'nfl')
    const nhlGames = allGames.filter(g => g.sport === 'nhl')
    
    return NextResponse.json({
      currentTime: {
        et: currentET.toISOString(),
        etDisplay: currentET.toLocaleString('en-US', { timeZone: 'America/New_York' }),
        utc: new Date().toISOString()
      },
      queryRange: {
        start: start.toISOString(),
        end: end.toISOString(),
        startET: new Date(start).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        endET: new Date(end).toLocaleString('en-US', { timeZone: 'America/New_York' })
      },
      counts: {
        totalGames: allGames.length,
        mlb: mlbGames.length,
        nfl: nflGames.length,
        nhl: nhlGames.length
      },
      mlbGames: mlbGames.map(g => ({
        id: g.id,
        date: g.date,
        dateET: new Date(g.date).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        home: g.home?.abbr,
        away: g.away?.abbr,
        status: g.status,
        inRange: new Date(g.date) >= start && new Date(g.date) <= end
      })),
      nflGames: nflGames.slice(0, 5).map(g => ({
        id: g.id,
        date: g.date,
        dateET: new Date(g.date).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        home: g.home?.abbr,
        away: g.away?.abbr,
        status: g.status,
        inRange: new Date(g.date) >= start && new Date(g.date) <= end
      })),
      nhlGames: nhlGames.map(g => ({
        id: g.id,
        date: g.date,
        dateET: new Date(g.date).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        home: g.home?.abbr,
        away: g.away?.abbr,
        status: g.status,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        inRange: new Date(g.date) >= start && new Date(g.date) <= end
      }))
    })
    
  } catch (error) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}

