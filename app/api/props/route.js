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
    
    // Step 1: Get active games (not finished)
    // NFL: Show all week's games (Thu-Mon)
    // NHL/MLB: Only show TODAY's games
    let activeGamesQuery = supabase
      .from('Game')
      .select('id, sport, date')
      .in('status', ['scheduled', 'in_progress', 'in-progress', 'halftime'])
    
    // For NHL/MLB, filter to today's games only (by EST date)
    if (sport === 'nhl' || sport === 'mlb') {
      const today = new Date()
      const todayEST = today.toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
      const [month, day, year] = todayEST.split('/')
      const todayStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
      
      // Get a wide UTC range (yesterday to tomorrow) then filter by EST date below
      const yesterdayUTC = new Date(today)
      yesterdayUTC.setDate(yesterdayUTC.getDate() - 1)
      yesterdayUTC.setHours(0, 0, 0, 0)
      
      const tomorrowUTC = new Date(today)
      tomorrowUTC.setDate(tomorrowUTC.getDate() + 2)
      tomorrowUTC.setHours(0, 0, 0, 0)
      
      activeGamesQuery = activeGamesQuery
        .eq('sport', sport)
        .gte('date', yesterdayUTC.toISOString())
        .lt('date', tomorrowUTC.toISOString())
    }
    
    const { data: activeGames, error: gamesError } = await activeGamesQuery
    
    if (gamesError) {
      console.error('Error fetching active games:', gamesError)
      return NextResponse.json(
        { error: 'Failed to fetch active games', details: gamesError.message },
        { status: 500 }
      )
    }
    
    const activeGameIds = (activeGames || []).map(g => g.id)
    console.log(`✅ Found ${activeGameIds.length} active games`)
    
    if (activeGameIds.length === 0) {
      // No active games, return empty props
      return NextResponse.json({
        success: true,
        props: [],
        count: 0
      })
    }
    
    // Step 2: Build query for props - only from active games
    let query = supabase
      .from('PlayerPropCache')
      .select('*')
      .in('gameId', activeGameIds) // CRITICAL: Only props from active games
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



