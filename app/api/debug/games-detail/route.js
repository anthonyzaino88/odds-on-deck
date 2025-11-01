export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET() {
  try {
    console.log('🔍 DEBUG: Checking all games in detail...')
    
    // Get all games with basic info
    const allGames = await prisma.game.findMany({
      select: {
        id: true,
        sport: true,
        date: true,
        status: true,
        homeId: true,
        awayId: true,
        home: { select: { abbr: true, name: true } },
        away: { select: { abbr: true, name: true } }
      },
      orderBy: { date: 'asc' }
    })
    
    // Group by sport
    const byType = {
      mlb: allGames.filter(g => g.sport === 'mlb'),
      nfl: allGames.filter(g => g.sport === 'nfl'),
      nhl: allGames.filter(g => g.sport === 'nhl')
    }
    
    // Check for missing teams
    const missingTeams = allGames.filter(g => !g.home || !g.away)
    
    // Get Saturday games (Nov 1, 2025 or upcoming Saturdays)
    const now = new Date()
    const saturdayStart = new Date(now)
    saturdayStart.setDate(saturdayStart.getDate() + (6 - now.getDay())) // Next Saturday
    const saturdayEnd = new Date(saturdayStart)
    saturdayEnd.setDate(saturdayEnd.getDate() + 1)
    
    const saturdayGames = allGames.filter(g => 
      new Date(g.date) >= saturdayStart && new Date(g.date) < saturdayEnd
    )
    
    return NextResponse.json({
      debug: true,
      summary: {
        total: allGames.length,
        mlb: byType.mlb.length,
        nfl: byType.nfl.length,
        nhl: byType.nhl.length,
        missingTeams: missingTeams.length
      },
      saturdayGames: {
        saturdayDate: saturdayStart.toISOString(),
        count: saturdayGames.length,
        games: saturdayGames.map(g => ({
          sport: g.sport,
          matchup: g.home && g.away ? `${g.away.abbr} @ ${g.home.abbr}` : `ID: ${g.awayId} @ ${g.homeId}`,
          homeTeamFound: !!g.home,
          awayTeamFound: !!g.away,
          status: g.status
        }))
      },
      sampleGames: {
        mlbSample: byType.mlb.slice(0, 3).map(g => ({
          date: g.date,
          matchup: g.home && g.away ? `${g.away.abbr} @ ${g.home.abbr}` : `Missing teams: ${g.awayId} @ ${g.homeId}`
        })),
        nflSample: byType.nfl.slice(0, 3).map(g => ({
          date: g.date,
          matchup: g.home && g.away ? `${g.away.abbr} @ ${g.home.abbr}` : `Missing teams`
        })),
        nhlSample: byType.nhl.slice(0, 3).map(g => ({
          date: g.date,
          matchup: g.home && g.away ? `${g.away.abbr} @ ${g.home.abbr}` : `Missing teams: ${g.awayId} @ ${g.homeId}`
        }))
      },
      missingTeamExamples: missingTeams.slice(0, 5).map(g => ({
        gameId: g.id,
        sport: g.sport,
        homeId: g.homeId,
        awayId: g.awayId
      }))
    })
    
  } catch (error) {
    console.error('❌ Debug error:', error)
    return NextResponse.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}
