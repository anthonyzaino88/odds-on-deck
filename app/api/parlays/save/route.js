export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

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
    for (let i = 0; i < parlay.legs.length; i++) {
      const leg = parlay.legs[i]
      if (leg.betType === 'prop' || leg.type) {
        // Generate unique propId that includes parlayId and legOrder to avoid collisions
        const legOrder = i + 1
        const propData = {
          // Include parlayId and legOrder in propId to ensure uniqueness per leg
          propId: `parlay-${savedParlay.id}-leg-${legOrder}-${leg.playerName}-${leg.propType || leg.type}-${leg.gameId}`,
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
        
        // Directly create validation record
        try {
          // Check if game exists
          const { data: game, error: gameError } = await supabase
            .from('Game')
            .select('id, sport')
            .eq('id', propData.gameId)
            .maybeSingle();

          if (gameError || !game) {
            console.warn(`   ⚠️ Game not found for leg ${legOrder}: ${propData.gameId}`);
            continue;
          }

          const propId = propData.propId;

          // Check for existing validation
          const { data: existingRecords } = await supabase
            .from('PropValidation')
            .select('*')
            .eq('propId', propId)
            .order('timestamp', { ascending: false })
            .limit(1);

          const existing = existingRecords && existingRecords.length > 0 ? existingRecords[0] : null;

          if (existing && existing.status === 'completed') {
            console.log(`   ✅ Prop already completed: ${leg.playerName} ${leg.propType || leg.type}`);
            validationRecordsCreated++;
            continue;
          }

          const validationData = {
            propId: propId,
            gameIdRef: propData.gameId,
            playerName: propData.playerName,
            propType: propData.type || 'unknown',
            threshold: propData.threshold || 0,
            prediction: propData.pick || 'over',
            projectedValue: propData.projection || propData.projectedValue || 0,
            confidence: propData.confidence || 'low',
            edge: propData.edge || 0,
            odds: propData.odds || null,
            probability: propData.probability || null,
            qualityScore: 50,
            source: 'parlay_leg',
            parlayId: savedParlay.id,
            status: 'pending',
            sport: propData.sport || 'nhl',
            timestamp: new Date().toISOString()
          };

          let result;
          if (existing) {
            // Update existing
            const { data, error } = await supabase
              .from('PropValidation')
              .update({
                threshold: validationData.threshold,
                prediction: validationData.prediction,
                projectedValue: validationData.projectedValue,
                confidence: validationData.confidence,
                edge: validationData.edge,
                odds: validationData.odds,
                probability: validationData.probability,
                qualityScore: validationData.qualityScore,
                source: validationData.source,
                parlayId: validationData.parlayId,
                status: validationData.status
              })
              .eq('id', existing.id)
              .select()
              .single();

            if (error) throw error;
            result = data;
            console.log(`   ✅ Updated validation for leg ${legOrder}: ${leg.playerName} ${leg.propType || leg.type}`);
          } else {
            // Create new
            validationData.id = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            const { data, error } = await supabase
              .from('PropValidation')
              .insert(validationData)
              .select()
              .single();

            if (error) throw error;
            result = data;
            console.log(`   ✅ Created validation for leg ${legOrder}: ${leg.playerName} ${leg.propType || leg.type}`);
          }

          if (result) {
            validationRecordsCreated++;
          }
        } catch (error) {
          console.error(`   ❌ Error recording leg ${legOrder}:`, error.message);
        }
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