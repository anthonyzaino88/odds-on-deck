// API endpoint to get today's games
// Homepage calls this instead of querying DB directly
// This gives us better control over timeouts and caching

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30 // 30 second timeout

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET() {
  try {
    console.log('📅 API: Fetching today\'s games...')
    
    // Get today's date range
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // Get this week (for NFL)
    const weekEnd = new Date(today)
    weekEnd.setDate(weekEnd.getDate() + 7)
    
    try {
      // Query all games in parallel with timeout protection
      const gamesPromise = Promise.all([
        // MLB: today only
        prisma.game.findMany({
          where: {
            sport: 'mlb',
            date: { gte: today, lt: tomorrow }
          },
          select: {
            id: true,
            date: true,
            status: true,
            homeScore: true,
            awayScore: true,
            home: { select: { abbr: true, name: true } },
            away: { select: { abbr: true, name: true } }
          },
          orderBy: { date: 'asc' },
          take: 100 // Limit to prevent huge queries
        }),
        
        // NFL: this week
        prisma.game.findMany({
          where: {
            sport: 'nfl',
            date: { gte: today, lt: weekEnd }
          },
          select: {
            id: true,
            date: true,
            status: true,
            homeScore: true,
            awayScore: true,
            home: { select: { abbr: true, name: true } },
            away: { select: { abbr: true, name: true } }
          },
          orderBy: { date: 'asc' },
          take: 100
        }),
        
        // NHL: today only
        prisma.game.findMany({
          where: {
            sport: 'nhl',
            date: { gte: today, lt: tomorrow }
          },
          select: {
            id: true,
            date: true,
            status: true,
            homeScore: true,
            awayScore: true,
            home: { select: { abbr: true, name: true } },
            away: { select: { abbr: true, name: true } }
          },
          orderBy: { date: 'asc' },
          take: 100
        })
      ])
      
      const [mlbGames, nflGames, nhlGames] = await gamesPromise
      
      console.log(`✅ Games loaded: ${mlbGames.length} MLB, ${nflGames.length} NFL, ${nhlGames.length} NHL`)
      
      return NextResponse.json({
        success: true,
        data: {
          mlb: mlbGames,
          nfl: nflGames,
          nhl: nhlGames
        },
        timestamp: new Date().toISOString()
      })
      
    } catch (queryError) {
      console.error('❌ Query error:', queryError.message)
      return NextResponse.json({
        success: false,
        error: 'Failed to fetch games',
        data: { mlb: [], nfl: [], nhl: [] },
        timestamp: new Date().toISOString()
      }, { status: 500 })
    }
    
  } catch (error) {
    console.error('❌ API error:', error.message)
    return NextResponse.json({
      success: false,
      error: error.message,
      data: { mlb: [], nfl: [], nhl: [] },
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}
