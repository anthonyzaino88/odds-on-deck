// Player Props API - Query PlayerPropCache from Supabase

import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase.js'
import { enrichPropsWithTeamContext } from '../../../lib/prop-enrichment.js'

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
    
    // Get all propIds to check which ones are already saved
    const propIds = (data || []).map(p => p.propId)
    
    let savedPropIds = new Set()
    
    // FIXED: Query ALL saved props instead of using .in() which causes "Request Header Too Large" error
    // .in() with 1000 propIds creates a URL that's too long for HTTP headers
    const { data: allSavedProps, error: savedError } = await supabase
      .from('PropValidation')
      .select('propId')
      .eq('status', 'pending') // Only get pending validations (not completed ones)
      .limit(5000) // Reasonable limit to avoid loading everything
    
    if (savedError) {
      console.error(`   Error querying saved props:`, savedError)
    } else if (allSavedProps && allSavedProps.length > 0) {
      // Filter to only propIds that are in our current props list
      const currentPropIdSet = new Set(propIds)
      const matchingSaved = allSavedProps.filter(sp => currentPropIdSet.has(sp.propId))
      
      savedPropIds = new Set(matchingSaved.map(p => p.propId))
      console.log(`   Found ${savedPropIds.size} saved props out of ${allSavedProps.length} total saved`)
      
      if (savedPropIds.size > 0) {
        console.log(`   Sample saved: ${[...savedPropIds].slice(0, 3).join(', ')}`)
      }
    } else {
      console.log(`   No saved props found in PropValidation table`)
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
      gameTime: prop.gameTime,
      isSaved: savedPropIds.has(prop.propId) // Flag if already saved
    }))
    
    // Enrich props with team context (offensive power, win probability, etc.)
    const enrichedProps = await enrichPropsWithTeamContext(props)
    
    return NextResponse.json({
      success: true,
      props: enrichedProps,
      count: enrichedProps.length
    })
    
  } catch (error) {
    console.error('Error in props API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch player props', details: error.message },
      { status: 500 }
    )
  }
}



