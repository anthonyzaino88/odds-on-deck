// Grade Featured-cleared parlays from settled PropValidation rows.
// Explorer Builder pending rows are not this track.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '../../../../lib/supabase-admin.js'
import { isAuthorizedAdmin, unauthorized, serverError } from '../../../../lib/api-security.js'
import {
  FEATURED_COHORT_TAG,
  featuredLegGradePatch,
  featuredParlayGradePatch,
  filterFeaturedCohortRows,
  gradeFeaturedParlayFromValidations,
  isFeaturedCohortRow,
  summarizeFeaturedParlays,
} from '../../../../lib/featured-parlays.js'

export async function POST(request) {
  if (!isAuthorizedAdmin(request)) return unauthorized()
  try {
    console.log('🔍 Validating Featured-cleared pending parlays...')

    const { data: pendingRows, error: parlaysError } = await supabase
      .from('Parlay')
      .select('*')
      .eq('status', 'pending')
      .ilike('notes', `%${FEATURED_COHORT_TAG}%`)

    if (parlaysError) {
      throw new Error(`Failed to fetch parlays: ${parlaysError.message}`)
    }

    const pendingParlays = filterFeaturedCohortRows(pendingRows || [])

    if (pendingParlays.length === 0) {
      return NextResponse.json({
        success: true,
        validated: 0,
        message: 'No pending Featured-cleared parlays to validate',
        cohort: 'featured',
      })
    }

    console.log(`📊 Found ${pendingParlays.length} pending Featured parlays`)

    let validatedCount = 0
    let wonCount = 0
    let lostCount = 0
    let pushCount = 0

    for (const parlay of pendingParlays) {
      try {
        const { data: legs, error: legsError } = await supabase
          .from('ParlayLeg')
          .select('*')
          .eq('parlayId', parlay.id)
          .order('legOrder', { ascending: true })

        if (legsError) {
          console.error(`⚠️ Error fetching legs for parlay ${parlay.id}:`, legsError.message)
          continue
        }

        if (!legs || legs.length === 0) {
          console.warn(`⚠️ Featured parlay ${parlay.id} has no legs`)
          continue
        }

        const playerNames = [...new Set(legs.map((leg) => leg.playerName).filter(Boolean))]
        let validationsQuery = supabase
          .from('PropValidation')
          .select('*')
        if (playerNames.length > 0) {
          validationsQuery = validationsQuery.in('playerName', playerNames)
        } else {
          validationsQuery = validationsQuery.eq('parlayId', parlay.id)
        }

        const { data: validations, error: validationError } = await validationsQuery
        if (validationError) {
          console.error(`⚠️ Error fetching validations for parlay ${parlay.id}:`, validationError.message)
          continue
        }

        const grade = gradeFeaturedParlayFromValidations(legs, validations || [])
        const now = new Date()
        const parlayPatch = featuredParlayGradePatch(grade, now)

        for (const legOutcome of grade.legOutcomes) {
          const legPatch = featuredLegGradePatch(legOutcome, now)
          if (!legPatch || !legOutcome.leg?.id) continue
          await supabase
            .from('ParlayLeg')
            .update(legPatch)
            .eq('id', legOutcome.leg.id)
        }

        if (!parlayPatch) continue

        const { error: updateError } = await supabase
          .from('Parlay')
          .update(parlayPatch)
          .eq('id', parlay.id)

        if (updateError) {
          console.error(`⚠️ Error updating parlay ${parlay.id}:`, updateError.message)
          continue
        }

        validatedCount++
        if (grade.parlayOutcome === 'won') wonCount++
        else if (grade.parlayOutcome === 'push') pushCount++
        else lostCount++

        console.log(`✅ Featured parlay ${parlay.id}: ${grade.parlayOutcome.toUpperCase()} (${legs.length} legs)`)
      } catch (error) {
        console.error(`❌ Error validating Featured parlay ${parlay.id}:`, error.message)
      }
    }

    return NextResponse.json({
      success: true,
      validated: validatedCount,
      won: wonCount,
      lost: lostCount,
      push: pushCount,
      pending: pendingParlays.length - validatedCount,
      cohort: 'featured',
      message: `Validated ${validatedCount} Featured parlays (${wonCount} won, ${lostCount} lost, ${pushCount} push)`,
    })
  } catch (error) {
    console.error('❌ Error in Featured parlay validation:', error)
    return serverError()
  }
}

export async function GET() {
  try {
    const { data: allParlays, error } = await supabase
      .from('Parlay')
      .select('status, outcome, notes, edge, expectedValue, totalOdds')
      .ilike('notes', `%${FEATURED_COHORT_TAG}%`)

    if (error) {
      throw new Error(`Failed to fetch parlays: ${error.message}`)
    }

    const featured = (allParlays || []).filter(isFeaturedCohortRow)
    const summary = summarizeFeaturedParlays(featured)

    return NextResponse.json({
      success: true,
      cohort: 'featured',
      stats: {
        total: summary.totalParlays,
        pending: summary.pendingParlays,
        won: summary.wonParlays,
        lost: summary.lostParlays,
        push: summary.pushParlays,
      },
      performance: summary,
    })
  } catch (error) {
    console.error('❌ Error fetching Featured parlay stats:', error)
    return serverError()
  }
}
