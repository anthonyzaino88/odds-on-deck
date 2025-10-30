// Parlay Generation API Endpoint

import { NextResponse } from 'next/server'

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { generateSimpleParlays } from '../../../../lib/simple-parlay-generator.js'

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from '../../../../lib/db.js'

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
      filterMode = 'balanced', // New: betting strategy filter
      saveToDatabase = true,
      gameId = null
    } = body

    console.log(`🎯 Generating parlays: ${legCount}-leg ${sport} (${type})${gameId ? ` for game ${gameId}` : ''}`)

    // Validate input
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

    // Generate parlays
    const parlays = await generateSimpleParlays({
      sport,
      type,
      legCount,
      minEdge,
      maxParlays,
      minConfidence,
      filterMode, // Pass filter mode to generator
      gameId
    })

    // Save parlays to database if requested
    const savedParlays = []
    if (saveToDatabase && parlays.length > 0) {
      try {
        for (const parlay of parlays) {
          const savedParlay = await prisma.parlay.create({
            data: {
              sport: parlay.sport,
              type: parlay.type,
              legCount: parlay.legs.length,
              totalOdds: parlay.totalOdds,
              probability: parlay.probability,
              edge: parlay.edge,
              expectedValue: parlay.expectedValue,
              confidence: parlay.confidence,
              status: 'generated',
              notes: `Generated parlay with ${parlay.legs.length} legs`,
              legs: {
                create: parlay.legs.map((leg, index) => ({
                  gameId: leg.gameId,
                  betType: leg.betType,
                  selection: leg.selection,
                  odds: leg.odds,
                  probability: leg.probability,
                  edge: leg.edge,
                  confidence: leg.confidence,
                  legOrder: index + 1,
                  notes: leg.reasoning,
                  playerId: leg.playerId || null,
                  propType: leg.propType || null,
                  threshold: leg.threshold || null
                }))
              }
            }
          })
          savedParlays.push(savedParlay)
        }
        console.log(`✅ Saved ${savedParlays.length} parlays to database`)
      } catch (error) {
        console.error('❌ Error saving parlays to database:', error)
        // Continue without failing the request
      }
    }

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
  } finally {
    await prisma.$disconnect()
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

    console.log(`🎯 GET: Generating ${legCount}-leg ${sport} parlays`)

    const parlays = await generateSimpleParlays({
      sport,
      type,
      legCount,
      minEdge,
      maxParlays
    })

    return NextResponse.json({
      success: true,
      parlays: parlays,
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
