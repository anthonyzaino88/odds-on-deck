// Player Props API - Query PlayerPropCache from Supabase

import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const sport = searchParams.get('sport') // 'mlb', 'nfl', 'nhl', or null for all
    const gameId = searchParams.get('gameId') // Optional: filter by specific game
    const limit = parseInt(searchParams.get('limit') || '1000')
    
    // Build query
    let query = supabase
      .from('PlayerPropCache')
      .select('*')
      .order('gameTime', { ascending: true })
      .order('qualityScore', { ascending: false })
      .limit(limit)
    
    // Filter by sport if provided
    if (sport && ['mlb', 'nfl', 'nhl'].includes(sport)) {
      query = query.eq('sport', sport)
    }
    
    // Filter by game if provided
    if (gameId) {
      query = query.eq('gameId', gameId)
    }
    
    // Only get non-stale props that haven't expired
    const now = new Date().toISOString()
    query = query
      .eq('isStale', false)
      .gte('expiresAt', now)
    
    const { data, error } = await query
    
    if (error) {
      console.error('Error fetching player props:', error)
      return NextResponse.json(
        { error: 'Failed to fetch player props', details: error.message },
        { status: 500 }
      )
    }
    
    // Transform data to match expected format
    const props = (data || []).map(prop => ({
      propId: prop.propId,
      gameId: prop.gameId,
      playerName: prop.playerName,
      team: prop.team,
      type: prop.type,
      pick: prop.pick,
      threshold: prop.threshold,
      odds: prop.odds,
      probability: prop.probability || 0.5,
      edge: prop.edge || 0,
      confidence: prop.confidence || 'low',
      qualityScore: prop.qualityScore || 0,
      sport: prop.sport,
      category: prop.category,
      reasoning: prop.reasoning,
      projection: prop.projection,
      bookmaker: prop.bookmaker,
      gameTime: prop.gameTime
    }))
    
    return NextResponse.json({
      success: true,
      props,
      count: props.length
    })
    
  } catch (error) {
    console.error('Error in props API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player props', details: error.message },
      { status: 500 }
    )
  }
}


