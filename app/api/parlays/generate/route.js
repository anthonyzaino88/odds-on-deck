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
 * fills an empty sport+kind+ET-day slot so /parlays cannot show a
 * second SGP or a different mid-day line than the tracked card.
 */
async function resolveFeaturedGenerate(options) {
  const { sport, type, generateParlays } = options
  try {
    const existing = await loadFeaturedSnapshotCard({ sport, type })
    if (existing) {
      return { parlays: [existing], savedParlays: [existing], fromSnapshot: true }
    }
  } catch (error) {
    console.error('⚠️ Featured snapshot load failed (will generate live):', error)
  }

  const parlays = await generateParlays()
  const savedParlays = await persistFeaturedIfNeeded(parlays, true)

  try {
    const snapped = await loadFeaturedSnapshotCard({ sport, type })
    if (snapped) {
      return { parlays: [snapped], savedParlays, fromSnapshot: true }
    }
  } catch (error) {
    console.error('⚠️ Featured snapshot reload failed:', error)
  }

  return { parlays, savedParlays, fromSnapshot: false }
}

export async function POST(request) {
  try {
    const body = await request.json()
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

    const generateParlays = () => generateSimpleParlays({
      sport,
      type,
      // Featured is exactly FEATURED_LEG_COUNT Published-eligible legs or empty.
      legCount: isFeatured ? FEATURED_LEG_COUNT : legCount,
      minEdge,
      maxParlays,
      minConfidence,
      filterMode,
      gameId,
      featured: isFeatured,
    })

    // Explorer generate never writes. Featured-cleared cards snapshot
    // to the tracked cohort (first write for the slate slot wins).
    const resolved = isFeatured
      ? await resolveFeaturedGenerate({ sport, type, generateParlays })
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
      { error: 'Failed to generate parlays', details: error.message },
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

    const generateParlays = () => generateSimpleParlays({
      sport,
      type,
      legCount: featuredLegCount,
      minEdge,
      maxParlays,
      filterMode,
      gameId,
      featured,
    })

    const resolved = featured
      ? await resolveFeaturedGenerate({ sport, type, generateParlays })
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
      { error: 'Failed to generate parlays', details: error.message },
      { status: 500 }
    )
  }
}
