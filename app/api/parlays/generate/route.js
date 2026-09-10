// Parlay Generation API Endpoint

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { generateSimpleParlays } from '../../../../lib/simple-parlay-generator.js'
import { FEATURED_LEG_COUNT } from '../../../../lib/parlay-integrity.js'
import { persistFeaturedClearedParlays } from '../../../../lib/featured-parlay-persist.js'

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

export async function POST(request) {
  try {
    const body = await request.json()
    const {
      sport = 'mlb',
      type = 'multi_game',
      legCount = 3,
      minEdge = 0.05,
      maxParlays = 10,
      minConfidence = 'medium',
      filterMode = 'balanced',
      gameId = null,
      featured = false,
    } = body

    console.log(`🎯 Generating parlays: ${legCount}-leg ${sport} (${type})${gameId ? ` for game ${gameId}` : ''}`)

    if (legCount < 2 || legCount > 10) {
      return NextResponse.json(
        { error: 'Leg count must be between 2 and 10' },
        { status: 400 }
      )
    }

    if (!['mlb', 'nfl', 'nhl', 'mixed'].includes(sport)) {
      return NextResponse.json(
        { error: 'Sport must be mlb, nfl, nhl, or mixed' },
        { status: 400 }
      )
    }

    if (!['single_game', 'multi_game', 'cross_sport'].includes(type)) {
      return NextResponse.json(
        { error: 'Type must be single_game, multi_game, or cross_sport' },
        { status: 400 }
      )
    }

    const isFeatured = featured === true || featured === '1' || featured === 'true'

    const parlays = await generateSimpleParlays({
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
    const savedParlays = await persistFeaturedIfNeeded(parlays, isFeatured)

    return NextResponse.json({
      success: true,
      parlays: parlays,
      savedParlays: savedParlays,
      count: parlays.length,
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
    const sport = searchParams.get('sport') || 'mlb'
    const type = searchParams.get('type') || 'multi_game'
    const legCount = parseInt(searchParams.get('legs')) || 3
    const minEdge = parseFloat(searchParams.get('minEdge')) || 0.05
    const maxParlays = parseInt(searchParams.get('maxParlays')) || 10
    const filterMode = searchParams.get('filterMode') || 'safe'
    const gameId = searchParams.get('gameId') || null
    const featuredParam = searchParams.get('featured')
    const featured = featuredParam === '1' || featuredParam === 'true'
    const featuredLegCount = featured ? FEATURED_LEG_COUNT : legCount

    const parlays = await generateSimpleParlays({
      sport,
      type,
      legCount: featuredLegCount,
      minEdge,
      maxParlays,
      filterMode,
      gameId,
      featured,
    })

    const savedParlays = await persistFeaturedIfNeeded(parlays, featured)

    return NextResponse.json({
      success: true,
      parlays: parlays,
      savedParlays: savedParlays,
      count: parlays.length,
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
