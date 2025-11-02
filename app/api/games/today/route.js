// API endpoint to get today's games and upcoming games

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET() {
  try {
    console.log('📅 API: Fetching games...')
    
    // Get date range - show games from 30 days ago to 30 days future
    // This allows testing with historical data
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    
    console.log(`Date range: ${thirtyDaysAgo.toISOString()} to ${thirtyDaysLater.toISOString()}`)
    
    // Query games with individual error handling
    let mlbGames = []
    let nflGames = []
    let nhlGames = []
    
    // MLB games
    try {
      console.log('🔍 MLB: Starting query...')
      mlbGames = await prisma.game.findMany({
        where: {
          sport: 'mlb',
          date: { gte: thirtyDaysAgo, lte: thirtyDaysLater }
        },
        select: {
          id: true, date: true, status: true, homeScore: true, awayScore: true,
          home: { select: { abbr: true, name: true } },
          away: { select: { abbr: true, name: true } }
        },
        orderBy: { date: 'asc' },
        take: 100
      })
      console.log(`✅ MLB: ${mlbGames.length} games`)
    } catch (err) {
      console.error('❌ MLB query failed:', err.message)
      console.error('❌ Full error:', err)
    }
    
    // NFL games
    try {
      nflGames = await prisma.game.findMany({
        where: {
          sport: 'nfl',
          date: { gte: thirtyDaysAgo, lte: thirtyDaysLater }
        },
        select: {
          id: true, date: true, status: true, homeScore: true, awayScore: true,
          home: { select: { abbr: true, name: true } },
          away: { select: { abbr: true, name: true } }
        },
        orderBy: { date: 'asc' },
        take: 100
      })
      console.log(`✅ NFL: ${nflGames.length} games`)
    } catch (err) {
      console.error('❌ NFL query failed:', err.message)
    }
    
    // NHL games
    try {
      nhlGames = await prisma.game.findMany({
        where: {
          sport: 'nhl',
          date: { gte: thirtyDaysAgo, lte: thirtyDaysLater }
        },
        select: {
          id: true, date: true, status: true, homeScore: true, awayScore: true,
          home: { select: { abbr: true, name: true } },
          away: { select: { abbr: true, name: true } }
        },
        orderBy: { date: 'asc' },
        take: 100
      })
      console.log(`✅ NHL: ${nhlGames.length} games`)
    } catch (err) {
      console.error('❌ NHL query failed:', err.message)
    }
    
    console.log(`✅ API response: ${mlbGames.length} MLB, ${nflGames.length} NFL, ${nhlGames.length} NHL`)
    
    return NextResponse.json({
      success: true,
      data: {
        mlb: mlbGames,
        nfl: nflGames,
        nhl: nhlGames
      },
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('❌ API error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      data: { mlb: [], nfl: [], nhl: [] },
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}
