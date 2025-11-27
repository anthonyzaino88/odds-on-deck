// Simple API endpoint to get today's games
// Using Supabase client instead of Prisma (no build-time dependency!)

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase.js'

export async function GET(req) {
  try {
    console.log('📅 API: Fetching today\'s games...')

    // Get current time
    const now = new Date()
    
    // Get today's date in EST using proper formatting
    const estFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    const estDateStr = estFormatter.format(now) // Format: YYYY-MM-DD

    console.log(`📅 Today (EST): ${estDateStr}`)

    // Query games within a 48-hour window to catch all timezone edge cases
    // This ensures we don't miss games due to server timezone issues
    const windowStart = new Date(now)
    windowStart.setDate(now.getDate() - 1)
    windowStart.setHours(0, 0, 0, 0)
    
    const windowEnd = new Date(now)
    windowEnd.setDate(now.getDate() + 2)
    windowEnd.setHours(23, 59, 59, 999)

    const { data: allGames, error } = await supabase
      .from('Game')
      .select('*')
      .gte('date', windowStart.toISOString())
      .lte('date', windowEnd.toISOString())
      .order('date', { ascending: true })

    if (error) {
      console.error('❌ Database error:', error.message)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // Filter games by EST date to show only today's games
    const mlbGames = []
    const nflGames = []
    const nhlGames = []

    for (const game of allGames || []) {
      // IMPORTANT: Add 'Z' suffix if missing to ensure UTC parsing
      const dateStr = game.date?.endsWith('Z') ? game.date : game.date + 'Z'
      const gameDate = new Date(dateStr)
      
      // Get game's EST date
      const gameEstDate = estFormatter.format(gameDate) // Format: YYYY-MM-DD

      // Match games for today's EST date
      if (gameEstDate === estDateStr) {
        const fixedGame = { ...game, date: dateStr }
        if (game.sport === 'mlb') mlbGames.push(fixedGame)
        else if (game.sport === 'nfl') nflGames.push(fixedGame)
        else if (game.sport === 'nhl') nhlGames.push(fixedGame)
      }
    }

    console.log(`📊 Today's games: MLB=${mlbGames.length}, NFL=${nflGames.length}, NHL=${nhlGames.length}`)

    // Return response with CORS headers
    return NextResponse.json({
      success: true,
      data: {
        mlb: mlbGames,
        nfl: nflGames,
        nhl: nhlGames
      },
      timestamp: now.toISOString(),
      debug: {
        estDate: estDateStr,
        serverTime: now.toISOString(),
        totalGames: allGames?.length || 0
      }
    })

  } catch (error) {
    console.error('❌ API Error:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}