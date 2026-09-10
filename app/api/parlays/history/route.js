// Featured-cleared parlay history. Explorer Builder rows stay out.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  FEATURED_COHORT_TAG,
  filterFeaturedCohortRows,
  summarizeFeaturedParlays,
} from '../../../../lib/featured-parlays.js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit')) || 50
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
    const parlays = filterFeaturedCohortRows(rows || [])

    console.log(`✅ Found ${parlays.length} Featured-cleared parlays`)

    const playerNames = [...new Set(parlays.flatMap((parlay) =>
      (parlay.legs || []).map((leg) => leg.playerName).filter(Boolean)
    ))]

    let validations = []
    if (playerNames.length > 0) {
      const { data } = await supabase
        .from('PropValidation')
        .select('playerName, propType, prediction, threshold, actualValue, result, status, gameIdRef, parlayId')
        .in('playerName', playerNames)
      validations = data || []
    }

    for (const parlay of parlays) {
      if (!parlay.legs) continue
      parlay.legs = parlay.legs.map((leg) => {
        const validation = validations.find((row) =>
          row.playerName === leg.playerName
          && row.propType === leg.propType
        )
        const actualFromResult = String(leg.actualResult || '').match(/Actual:\s*(\d+(?:\.\d+)?)/i)
        return {
          ...leg,
          validationResult: validation?.result || (leg.outcome === 'won' ? 'correct' : leg.outcome === 'lost' ? 'incorrect' : leg.outcome === 'push' ? 'push' : null),
          validationStatus: validation?.status || null,
          actualValue: validation?.actualValue ?? (actualFromResult ? Number(actualFromResult[1]) : null)
        }
      })
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
