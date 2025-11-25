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

    // Get today's date in EST
    const now = new Date()
    const estDateStr = now.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })

    console.log(`📅 Today (EST): ${estDateStr}`)

    // Query games from yesterday through tomorrow to catch timezone issues
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)

    const { data: allGames, error } = await supabase
      .from('Game')
      .select('*')
      .gte('date', yesterday.toISOString())
      .lt('date', tomorrow.toISOString())
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
      const gameDate = new Date(game.date)
      const gameEstDateStr = gameDate.toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })

      if (gameEstDateStr === estDateStr) {
        if (game.sport === 'mlb') mlbGames.push(game)
        else if (game.sport === 'nfl') nflGames.push(game)
        else if (game.sport === 'nhl') nhlGames.push(game)
      }
    }

    console.log(`📊 Today's games: MLB=${mlbGames.length}, NFL=${nflGames.length}, NHL=${nhlGames.length}`)

    // Return response
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
        totalGames: allGames?.length || 0
      }
    })

  } catch (error) {
    console.error('❌ API Error:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}