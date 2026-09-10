export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { persistFeaturedClearedParlay } from '../../../../lib/featured-parlay-persist.js'
import { rateLimit, rateLimited, badRequest, serverError } from '../../../../lib/api-security.js'
import { NextResponse } from 'next/server'

const NOT_FEATURED_MESSAGE =
  'Only Featured-cleared parlays enter the tracked cohort. Explorer Builder cards are not saved.'

export async function POST(request) {
  const limit = rateLimit(request, { key: 'parlays-save', limit: 20, windowMs: 60_000 })
  if (!limit.allowed) return rateLimited(limit.retryAfter)
  try {
    const body = await request.json().catch(() => ({}))
    const { parlay } = body

    if (!parlay || typeof parlay !== 'object') {
      return badRequest('No parlay data provided')
    }
    if (!Array.isArray(parlay.legs) || parlay.legs.length === 0 || parlay.legs.length > 20) {
      return badRequest('Parlay must have between 1 and 20 legs')
    }

    const result = await persistFeaturedClearedParlay(parlay)

    if (result.rejected) {
      return NextResponse.json(
        { success: false, error: NOT_FEATURED_MESSAGE, reason: result.reason },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      parlay: result.parlay,
      skipped: result.skipped,
      reason: result.reason,
      validationRecordsCreated: 0,
      message: result.skipped
        ? 'Featured snapshot already on the tracked cohort for this slate slot'
        : 'Featured-cleared parlay saved to the tracked cohort',
    })
  } catch (error) {
    console.error('❌ Error saving Featured parlay:', error)
    return serverError()
  }
}
