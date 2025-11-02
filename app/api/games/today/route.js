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
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    
    console.log(`Date range: ${thirtyDaysAgo.toISOString()} to ${thirtyDaysLater.toISOString()}`)
    
    // Fetch games without relationships
    let mlbGames = []
    let nflGames = []
    let nhlGames = []
    
    try {
      mlbGames = await prisma.game.findMany({
        where: {
          sport: 'mlb',
          date: { gte: thirtyDaysAgo, lte: thirtyDaysLater }
        },
        orderBy: { date: 'asc' },
        take: 100
      })
      console.log(`✅ MLB: ${mlbGames.length} games`)
    } catch (err) {
      console.error('❌ MLB query failed:', err.message)
    }
    
    try {
      nflGames = await prisma.game.findMany({
        where: {
          sport: 'nfl',
          date: { gte: thirtyDaysAgo, lte: thirtyDaysLater }
        },
        orderBy: { date: 'asc' },
        take: 100
      })
      console.log(`✅ NFL: ${nflGames.length} games`)
    } catch (err) {
      console.error('❌ NFL query failed:', err.message)
    }
    
    try {
      nhlGames = await prisma.game.findMany({
        where: {
          sport: 'nhl',
          date: { gte: thirtyDaysAgo, lte: thirtyDaysLater }
        },
        orderBy: { date: 'asc' },
        take: 100
      })
      console.log(`✅ NHL: ${nhlGames.length} games`)
    } catch (err) {
      console.error('❌ NHL query failed:', err.message)
    }
    
    // Fetch teams for all games
    const allGames = [...mlbGames, ...nflGames, ...nhlGames]
    const teamIds = [...new Set(allGames.flatMap(g => [g.homeId, g.awayId]))]
    
    let teamsMap = {}
    if (teamIds.length > 0) {
      try {
        const teams = await prisma.team.findMany({
          where: { id: { in: teamIds } }
        })
        teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
      } catch (err) {
        console.error('❌ Teams query failed:', err.message)
      }
    }
    
    // Enrich games with team data
    const enrichGames = (games) => games.map(g => ({
      ...g,
      home: teamsMap[g.homeId] || { id: g.homeId, abbr: '?', name: 'Unknown' },
      away: teamsMap[g.awayId] || { id: g.awayId, abbr: '?', name: 'Unknown' }
    }))
    
    const enrichedMlb = enrichGames(mlbGames)
    const enrichedNfl = enrichGames(nflGames)
    const enrichedNhl = enrichGames(nhlGames)
    
    console.log(`✅ API response: ${enrichedMlb.length} MLB, ${enrichedNfl.length} NFL, ${enrichedNhl.length} NHL`)
    
    return NextResponse.json({
      success: true,
      data: {
        mlb: enrichedMlb,
        nfl: enrichedNfl,
        nhl: enrichedNhl
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
