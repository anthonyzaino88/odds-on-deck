// Debug endpoint - Check what games are in the database
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET() {
  try {
    console.log('🔍 DEBUG: Checking games in database...')
    
    // Get today's date
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    console.log(`Today: ${today.toISOString()}`)
    console.log(`Tomorrow: ${tomorrow.toISOString()}`)
    
    // Count total games
    const totalGames = await prisma.game.count()
    console.log(`Total games in DB: ${totalGames}`)
    
    // Get all games with their dates
    const allGames = await prisma.game.findMany({
      select: { id: true, sport: true, date: true, status: true, home: { select: { abbr: true } }, away: { select: { abbr: true } } },
      take: 50,
      orderBy: { date: 'asc' }
    })
    
    console.log(`Retrieved ${allGames.length} games`)
    
    // Check specific sport counts
    const mlbCount = await prisma.game.count({ where: { sport: 'mlb' } })
    const nflCount = await prisma.game.count({ where: { sport: 'nfl' } })
    const nhlCount = await prisma.game.count({ where: { sport: 'nhl' } })
    
    // Check today's games specifically
    const mlbToday = await prisma.game.count({
      where: {
        sport: 'mlb',
        date: { gte: today, lt: tomorrow }
      }
    })
    
    const nflToday = await prisma.game.count({
      where: {
        sport: 'nfl',
        date: { gte: today, lt: tomorrow }
      }
    })
    
    const nhlToday = await prisma.game.count({
      where: {
        sport: 'nhl',
        date: { gte: today, lt: tomorrow }
      }
    })
    
    return NextResponse.json({
      debug: true,
      today: today.toISOString(),
      tomorrow: tomorrow.toISOString(),
      counts: {
        total: totalGames,
        mlb: mlbCount,
        nfl: nflCount,
        nhl: nhlCount
      },
      todayCounts: {
        mlb: mlbToday,
        nfl: nflToday,
        nhl: nhlToday
      },
      sampleGames: allGames.map(g => ({
        sport: g.sport,
        date: g.date,
        matchup: `${g.away.abbr} @ ${g.home.abbr}`,
        status: g.status
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
