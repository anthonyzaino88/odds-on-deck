import { sanitizedErrorMessage, sanitizeLoggedValue } from '../../../lib/sanitize-error.js'
// Player Props API - Query PlayerPropCache from Supabase

import { NextResponse } from 'next/server'
import { isSupabaseAdminConfigured, supabase } from '../../../lib/supabase.js'
import { clampPropsLimit } from '../../../lib/api-limits.js'
import {
  PUBLISHED_SPORTS,
  isPublicPropSport,
  isShadowPublishedCohort,
  omitStalePropCacheRows,
} from '../../../lib/published-picks.js'
import { toPublicPropsApiRow } from '../../../lib/line-shopping.js'
import { attachPublicAltLines } from '../../../lib/nfl-alt-lines.js'
import { applyPublicPropFreshness, omitUnfreshPublicPropRows } from '../../../lib/live-odds-landing.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json({ success: false, error: 'Database not configured. Check Supabase environment variables.' }, { status: 500 })
    }

    const { searchParams } = new URL(request.url)
    const sport = String(searchParams.get('sport') || '').toLowerCase().trim()
    const gameId = searchParams.get('gameId') // Optional: filter by specific game
    const limit = clampPropsLimit(searchParams.get('limit'))

    // Sports outside PUBLISHED_SPORTS are not served on the public API.
    if (sport && !isPublicPropSport(sport)) {
      return NextResponse.json({ success: true, props: [], count: 0 })
    }
    
    // Build query — public sports only (same list as the homepage board).
    let query = supabase
      .from('PlayerPropCache')
      .select('*')
      .in('sport', PUBLISHED_SPORTS)
      .order('gameTime', { ascending: true })
      .order('qualityScore', { ascending: false })
      .limit(limit)
    
    if (sport) {
      query = query.eq('sport', sport)
    }
    
    // Filter by game if provided
    if (gameId) {
      query = query.eq('gameId', gameId)
    }
    
    // Only get non-stale props that haven't expired and whose games are still in the future
    const now = new Date().toISOString()
    query = applyPublicPropFreshness(query
      .eq('isStale', false)
      .gte('expiresAt', now)
      .gt('gameTime', now), now)
    
    const { data, error } = await query
    
    if (error) {
      console.error('Error fetching player props:', sanitizeLoggedValue(error))
      return NextResponse.json(
        { error: 'Failed to fetch player props', details: sanitizedErrorMessage(error) },
        { status: 500 }
      )
    }
    
    // Transform and filter out unbettable lines
    const MIN_DECIMAL_ODDS = 1.25   // worse than -400 is not a real bet
    const MAX_DECIMAL_ODDS = 15.0   // worse than +1400 is lottery territory

    const props = omitUnfreshPublicPropRows(omitStalePropCacheRows(data), now)
      .filter(prop => isPublicPropSport(prop.sport))
      .filter(prop => !isShadowPublishedCohort(prop))
      .filter(prop => {
        if (!prop.odds) return true
        return prop.odds >= MIN_DECIMAL_ODDS && prop.odds <= MAX_DECIMAL_ODDS
      })
      .map(prop => attachPublicAltLines(toPublicPropsApiRow(prop), prop))
    
    return NextResponse.json({
      success: true,
      props,
      count: props.length
    })
    
  } catch (error) {
    console.error('Error in props API:', sanitizeLoggedValue(error))
    return NextResponse.json(
      { error: 'Failed to fetch player props', details: sanitizedErrorMessage(error) },
      { status: 500 }
    )
  }
}
