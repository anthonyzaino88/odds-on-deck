export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../../../lib/supabase-admin.js'
import { recordPropPrediction } from '../../../../lib/validation.js'

// Use admin client for writes (bypasses RLS)
const supabase = supabaseAdmin

// Generate unique ID (same format as other parts of the app)
function generateId() {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

export async function POST(request) {
  try {
    const body = await request.json()
    const { parlay } = body

    if (!parlay) {
      return NextResponse.json(
        { error: 'No parlay data provided' },
        { status: 400 }
      )
    }

    console.log(`💾 Saving parlay with ${parlay.legs?.length || 0} legs`)

    // Generate parlay ID
    const parlayId = generateId()

    // Save parlay to database using Supabase
    const now = new Date().toISOString()
    const { data: savedParlay, error: parlayError } = await supabase
      .from('Parlay')
      .insert({
        id: parlayId,
        sport: parlay.sport || 'mixed',
        type: parlay.type || 'multi_game',
        legCount: parlay.legs?.length || 0,
        totalOdds: parlay.totalOdds || 1.5,
        probability: parlay.probability || 0.5,
        edge: parlay.edge || 0.1,
        expectedValue: parlay.expectedValue || 0.05,
        confidence: parlay.confidence || 'medium',
        status: 'pending',
        notes: `User saved parlay with ${parlay.legs?.length || 0} legs`,
        createdAt: now,
        updatedAt: now
      })
      .select()
      .single()

    if (parlayError) {
      throw new Error(`Failed to save parlay: ${parlayError.message}`)
    }

    // Save parlay legs separately
    if (parlay.legs && parlay.legs.length > 0) {
      const legs = parlay.legs.map((leg, index) => ({
        id: generateId(),
        parlayId: parlayId,
        gameIdRef: leg.gameId,
        betType: leg.betType || 'prop',
        selection: leg.selection || leg.pick,
        odds: leg.odds || -110,
        probability: leg.probability || 0.5,
        edge: leg.edge || 0,
        confidence: leg.confidence || 'medium',
        legOrder: index + 1,
        notes: leg.reasoning,
        playerName: leg.playerName,
        propType: leg.propType || leg.type,
        threshold: leg.threshold,
        createdAt: now,
        updatedAt: now
      }))

      const { error: legsError } = await supabase
        .from('ParlayLeg')
        .insert(legs)

      if (legsError) {
        console.error('⚠️ Error saving parlay legs:', legsError.message)
        // Don't fail the entire request, just log the error
      }
    }

    console.log(`✅ Saved parlay ${savedParlay.id} to database`)

    // Record each prop leg for validation tracking
    let validationRecordsCreated = 0
    for (const leg of parlay.legs) {
      if (leg.betType === 'prop' || leg.type) {
        const propData = {
          id: `prop-${leg.playerId || leg.playerName}-${leg.propType || leg.type}-${leg.gameId}`,
          playerId: leg.playerId,
          playerName: leg.playerName,
          gameId: leg.gameId,
          team: leg.team,
          type: leg.propType || leg.type,
          pick: leg.selection || leg.pick,
          threshold: leg.threshold,
          odds: leg.odds,
          probability: leg.probability,
          edge: leg.edge,
          confidence: leg.confidence,
          reasoning: leg.reasoning,
          gameTime: leg.gameTime || new Date(),
          sport: leg.sport || parlay.sport || 'mlb',
          category: leg.category || 'batting',
          projection: leg.projection
        }
        
        await recordPropPrediction(propData, 'parlay_leg', savedParlay.id)
        validationRecordsCreated++
      }
    }

    console.log(`✅ Recorded ${validationRecordsCreated} prop predictions for validation`)

    return NextResponse.json({
      success: true,
      parlay: savedParlay,
      validationRecordsCreated: validationRecordsCreated,
      message: 'Parlay saved and props recorded for validation'
    })

  } catch (error) {
    console.error('❌ Error saving parlay:', error)
    return NextResponse.json(
      { error: 'Failed to save parlay', details: error.message },
      { status: 500 }
    )
  }
}