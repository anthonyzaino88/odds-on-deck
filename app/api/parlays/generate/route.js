// Parlay Generation API Endpoint

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { generateSimpleParlays } from '../../../../lib/simple-parlay-generator.js'
import { FEATURED_LEG_COUNT } from '../../../../lib/parlay-integrity.js'
import { parseFeaturedGenerateInput } from '../../../../lib/featured-parlays.js'
import {
  loadFeaturedSnapshotCard,
  persistFeaturedClearedParlays,
} from '../../../../lib/featured-parlay-persist.js'
import { clampMaxParlays, clampParlayLegs } from '../../../../lib/api-limits.js'
import { badRequest, isAuthorizedAdmin } from '../../../../lib/api-security.js'

async function persistFeaturedIfNeeded(parlays, isFeatured) {
  if (!isFeatured || !Array.isArray(parlays) || parlays.length === 0) {
    return []
  }
  try {
    const results = await persistFeaturedClearedParlays(parlays)
    return results.filter((row) => row.ok).map((row) => row.parlay).filter(Boolean)
  } catch (error) {
    console.error('⚠️ Featured persist failed (generate still returns the live card):', error)
    return []
  }
}

/**
 * Public Featured card is the snapped cohort row. Live generate only
 * fills an empty sport+kind+ET-day slot so /parlays still shows a card
 * when the morning record:featured job has not run yet. Public GET/POST
 * never write. Persist is CRON_SECRET / record:featured only.
 */
async function resolveFeaturedGenerate(options) {
  const { sport, type, generateParlays, allowPersist = false } = options
  try {
    const existing = await loadFeaturedSnapshotCard({ sport, type })
    if (existing) {
      return { parlays: [existing], savedParlays: [existing], fromSnapshot: true }
    }
  } catch (error) {
    console.error('⚠️ Featured snapshot load failed (will generate live):', error)
  }

  const parlays = await generateParlays()
  const savedParlays = allowPersist
    ? await persistFeaturedIfNeeded(parlays, true)
    : []

  if (allowPersist) {
    try {
      const snapped = await loadFeaturedSnapshotCard({ sport, type })
      if (snapped) {
        return { parlays: [snapped], savedParlays, fromSnapshot: true }
      }
    } catch (error) {
      console.error('⚠️ Featured snapshot reload failed:', error)
    }
  }

  return { parlays, savedParlays, fromSnapshot: false }
}

function featuredGenerateOptions(parsed, extras) {
  const { sport, type, featured } = parsed
  return {
    sport,
    type,
    featured,
    ...extras,
  }
}

export async function POST(request) {
  try {
    let body
    try {
      body = await request.json()
    } catch {
      return badRequest('Request body must be valid JSON')
    }
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      return badRequest('Request body must be a JSON object')
    }
    const parsed = parseFeaturedGenerateInput(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { sport, type, featured } = parsed
    const {
      legCount: rawLegCount = 3,
      minEdge = 0.05,
      maxParlays: rawMaxParlays = 10,
      minConfidence = 'medium',
      filterMode = 'balanced',
      gameId = null,
    } = body
    const legCount = clampParlayLegs(rawLegCount)
    const maxParlays = clampMaxParlays(rawMaxParlays)

    console.log(`🎯 Generating parlays: ${legCount}-leg ${sport} (${type})${gameId ? ` for game ${gameId}` : ''}`)

    const isFeatured = featured

    const generateParlays = () => generateSimpleParlays(featuredGenerateOptions(parsed, {
      // Featured is exactly FEATURED_LEG_COUNT Published-eligible legs or empty.
      legCount: isFeatured ? FEATURED_LEG_COUNT : legCount,
      minEdge,
      maxParlays,
      minConfidence,
      filterMode,
      gameId,
    }))

    // Explorer generate never writes. Featured persist is admin-only
    // (CRON_SECRET) or npm run record:featured. Public featured=1 still
    // returns the snapshot or a live card so /parlays looks the same.
    const resolved = isFeatured
      ? await resolveFeaturedGenerate({
        sport,
        type,
        generateParlays,
        allowPersist: isAuthorizedAdmin(request),
      })
      : { parlays: await generateParlays(), savedParlays: [], fromSnapshot: false }

    return NextResponse.json({
      success: true,
      parlays: resolved.parlays,
      savedParlays: resolved.savedParlays,
      fromSnapshot: resolved.fromSnapshot === true,
      count: resolved.parlays.length,
      generatedAt: new Date().toISOString()
    })

  } catch (error) {
    console.error('❌ Error in parlay generation API:', error)
    return NextResponse.json(
      { error: 'Failed to generate parlays' },
      { status: 500 }
    )
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const parsed = parseFeaturedGenerateInput({
      sport: searchParams.get('sport'),
      type: searchParams.get('type'),
      featured: searchParams.get('featured'),
    })
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { sport, type, featured } = parsed
    const legCount = clampParlayLegs(searchParams.get('legs'))
    const minEdge = parseFloat(searchParams.get('minEdge')) || 0.05
    const maxParlays = clampMaxParlays(searchParams.get('maxParlays'))
    const filterMode = searchParams.get('filterMode') || 'safe'
    const gameId = searchParams.get('gameId') || null
    const featuredLegCount = featured ? FEATURED_LEG_COUNT : legCount

    const generateParlays = () => generateSimpleParlays(featuredGenerateOptions(parsed, {
      legCount: featuredLegCount,
      minEdge,
      maxParlays,
      filterMode,
      gameId,
    }))

    const resolved = featured
      ? await resolveFeaturedGenerate({
        sport,
        type,
        generateParlays,
        allowPersist: isAuthorizedAdmin(request),
      })
      : { parlays: await generateParlays(), savedParlays: [], fromSnapshot: false }

    return NextResponse.json({
      success: true,
      parlays: resolved.parlays,
      savedParlays: resolved.savedParlays,
      fromSnapshot: resolved.fromSnapshot === true,
      count: resolved.parlays.length,
      generatedAt: new Date().toISOString()
    })

  } catch (error) {
    console.error('❌ Error in parlay generation GET API:', error)
    return NextResponse.json(
      { error: 'Failed to generate parlays' },
      { status: 500 }
    )
  }
}
