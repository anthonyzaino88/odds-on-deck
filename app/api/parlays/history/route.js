// Featured-cleared parlay history. Explorer Builder rows stay out.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../lib/supabase-admin.js'
import {
  FEATURED_COHORT_TAG,
  attachFeaturedHistoryLegDisplay,
  dedupeFeaturedCohortRows,
  filterFeaturedCohortRows,
  summarizeFeaturedParlays,
} from '../../../../lib/featured-parlays.js'
import { fetchFeaturedPropValidations } from '../../../../lib/featured-validation-query.js'
import { clampHistoryLimit } from '../../../../lib/api-limits.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = clampHistoryLimit(searchParams.get('limit'))
    const sport = searchParams.get('sport')
    const status = searchParams.get('status')

    console.log(`📊 Fetching Featured parlay history (limit: ${limit})`)

    let query = supabase
      .from('Parlay')
      .select('*, legs:ParlayLeg(*)')
      .ilike('notes', `%${FEATURED_COHORT_TAG}%`)
      .order('createdAt', { ascending: false })
      .limit(limit)

    if (sport) {
      query = query.eq('sport', sport)
    }

    if (status) {
      query = query.eq('status', status)
    }

    const { data: rows, error } = await query

    if (error) {
      throw new Error(`Database query failed: ${error.message}`)
    }

    // Belt-and-suspenders: never let untagged Builder rows into the track.
    // Duplicate snapshot-key inserts (race) are hidden; first write wins.
    const parlays = dedupeFeaturedCohortRows(filterFeaturedCohortRows(rows || []))

    console.log(`✅ Found ${parlays.length} Featured-cleared parlays`)

    const legs = parlays.flatMap((parlay) => parlay.legs || [])
    const { data: validations, error: validationError } = await fetchFeaturedPropValidations(supabase, legs)
    if (validationError) {
      throw new Error(`PropValidation lookup failed: ${validationError.message}`)
    }

    for (const parlay of parlays) {
      if (!parlay.legs) continue
      parlay.legs = parlay.legs.map((leg) => attachFeaturedHistoryLegDisplay(leg, validations || []))
    }

    return NextResponse.json({
      success: true,
      parlays,
      count: parlays.length,
      performance: summarizeFeaturedParlays(parlays),
      cohort: 'featured',
      fetchedAt: new Date().toISOString()
    })

  } catch (error) {
    console.error('❌ Error fetching Featured parlay history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch parlay history', details: error.message },
      { status: 500 }
    )
  }
}
