// API endpoint to get today's games
// Homepage calls this instead of querying DB directly

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

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
    
    console.log(`Querying games from ${today.toISOString()} to ${tomorrow.toISOString()}`)
    
    // Query games with individual error handling
    let mlbGames = []
    let nflGames = []
    let nhlGames = []
    
    // MLB games
    try {
      mlbGames = await prisma.game.findMany({
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
        take: 100
      })
      console.log(`✅ MLB: ${mlbGames.length} games`)
    } catch (err) {
      console.error('❌ MLB query failed:', err.message)
    }
    
    // NFL games
    try {
      nflGames = await prisma.game.findMany({
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
