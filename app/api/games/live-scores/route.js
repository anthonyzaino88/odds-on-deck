export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase.js'

export async function GET(req) {
  try {
    // Get query params
    const { searchParams } = new URL(req.url)
    const gameId = searchParams.get('gameId')
    const sport = searchParams.get('sport')
    
    console.log(`🔄 Fetching live scores for ${sport}...`)
    
    let query = supabase
      .from('Game')
      .select('id, sport, date, status, homeScore, awayScore, inning, inningHalf')
    
    // Filter by sport or specific game
    if (gameId) {
      query = query.eq('id', gameId)
    } else if (sport) {
      query = query.eq('sport', sport)
    } else {
      // Default: get all in-progress or recent games
      query = query.in('status', ['in_progress', 'final'])
    }
    
    const { data: games, error } = await query.limit(50)
    
    if (error) throw error
    
    console.log(`✅ Found ${games?.length} games`)
    
    return NextResponse.json({
      success: true,
      data: games,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('❌ Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      data: []
    }, { status: 500 })
  }
}
