// Parlay Validation Endpoint
// Checks saved parlays to see if they won or lost based on individual leg results

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function POST(request) {
  try {
    console.log('🔍 Validating pending parlays...')
    
    // Get all pending parlays
    const { data: pendingParlays, error: parlaysError } = await supabase
      .from('Parlay')
      .select('*')
      .eq('status', 'pending')
    
    if (parlaysError) {
      throw new Error(`Failed to fetch parlays: ${parlaysError.message}`)
    }
    
    if (!pendingParlays || pendingParlays.length === 0) {
      return NextResponse.json({
        success: true,
        validated: 0,
        message: 'No pending parlays to validate'
      })
    }
    
    console.log(`📊 Found ${pendingParlays.length} pending parlays`)
    
    let validatedCount = 0
    let wonCount = 0
    let lostCount = 0
    
    // Validate each parlay
    for (const parlay of pendingParlays) {
      try {
        // Get all legs for this parlay
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
          console.warn(`⚠️ Parlay ${parlay.id} has no legs`)
          continue
        }
        
        // Check if all legs have been validated
        // We need to check PropValidation records for each leg
        let allLegsValidated = true
        let allLegsWon = true
        const legResults = []
        
        console.log(`   Checking ${legs.length} legs for parlay ${parlay.id}`)
        
        for (const leg of legs) {
          // Find the PropValidation record for this leg
          // Try matching by propId first (new format includes parlayId and legOrder)
          const expectedPropId = `parlay-${parlay.id}-leg-${leg.legOrder}-${leg.playerName}-${leg.propType || ''}-${leg.gameIdRef || ''}`
          
          // First try exact propId match (for new parlays)
          let { data: validations, error: validationError } = await supabase
            .from('PropValidation')
            .select('*')
            .eq('propId', expectedPropId)
            .limit(1)
          
          // If no match by propId, try matching by parlayId + player + propType + threshold (for old parlays)
          if (!validations || validations.length === 0) {
            let query = supabase
              .from('PropValidation')
              .select('*')
              .eq('parlayId', parlay.id)
            
            // Add filters only if values exist (handle null/undefined)
            if (leg.playerName) {
              query = query.eq('playerName', leg.playerName.trim())
            }
            if (leg.propType) {
              query = query.eq('propType', leg.propType)
            }
            if (leg.threshold != null && leg.threshold !== undefined) {
              // Handle both string and number thresholds
              query = query.eq('threshold', leg.threshold)
            }
            
            const result = await query.limit(5)
            validations = result.data
            validationError = result.error
          }
          
          console.log(`   Leg ${leg.legOrder}: ${leg.playerName || 'N/A'} ${leg.propType || 'N/A'} ${leg.threshold || 'N/A'}`)
          console.log(`   Found ${validations?.length || 0} validation records`)
          
          if (validationError) {
            console.error(`   ❌ Error querying validations: ${validationError.message}`)
            allLegsValidated = false
            legResults.push({ leg: leg.legOrder, status: 'pending', error: validationError.message })
            break
          }
          
          if (!validations || validations.length === 0) {
            // No validation record found - try broader search
            console.log(`   🔍 No exact match, trying broader search...`)
            const { data: broadValidations } = await supabase
              .from('PropValidation')
              .select('*')
              .eq('parlayId', parlay.id)
              .eq('playerName', leg.playerName?.trim() || '')
              .limit(5)
            
            if (broadValidations && broadValidations.length > 0) {
              console.log(`   ⚠️ Found ${broadValidations.length} validations with matching parlayId and player, but different prop/threshold`)
              broadValidations.forEach(v => {
                console.log(`      - PropType: ${v.propType} (expected: ${leg.propType})`)
                console.log(`        Threshold: ${v.threshold} (expected: ${leg.threshold})`)
              })
            }
            
            // No validation record found - leg not yet validated
            console.log(`   ⏸️ Leg ${leg.legOrder} not validated yet`)
            allLegsValidated = false
            legResults.push({ leg: leg.legOrder, status: 'pending' })
            break
          }
          
          // Use the first matching validation (or find best match if multiple)
          let validation = validations[0]
          
          // If multiple matches, prefer exact threshold match
          if (validations.length > 1 && leg.threshold != null) {
            const exactMatch = validations.find(v => 
              v.threshold === leg.threshold || 
              Math.abs(parseFloat(v.threshold) - parseFloat(leg.threshold)) < 0.01
            )
            if (exactMatch) {
              validation = exactMatch
            }
          }
          
          if (validation.status !== 'completed') {
            // Leg validation not complete yet
            console.log(`   ⏸️ Leg ${leg.legOrder} validation not complete (status: ${validation.status})`)
            allLegsValidated = false
            legResults.push({ leg: leg.legOrder, status: 'pending', validationStatus: validation.status })
            break
          }
          
          // Check if leg won
          const legWon = validation.result === 'correct'
          legResults.push({ 
            leg: leg.legOrder, 
            status: legWon ? 'won' : 'lost',
            result: validation.result,
            actualValue: validation.actualValue
          })
          
          console.log(`   ✅ Leg ${leg.legOrder}: ${validation.result} (actual: ${validation.actualValue || 'N/A'})`)
          
          if (!legWon) {
            allLegsWon = false
          }
        }
        
        // If all legs are validated, update parlay status
        if (allLegsValidated) {
          const parlayResult = allLegsWon ? 'won' : 'lost'
          const parlayStatus = allLegsWon ? 'won' : 'lost'
          
          const { error: updateError } = await supabase
            .from('Parlay')
            .update({
              status: parlayStatus,
              outcome: parlayResult,
              actualResult: allLegsWon 
                ? `All ${legs.length} legs won`
                : `Lost on leg(s): ${legResults.filter(r => r.status === 'lost').map(r => r.leg).join(', ')}`,
              updatedAt: new Date().toISOString()
            })
            .eq('id', parlay.id)
          
          if (updateError) {
            console.error(`⚠️ Error updating parlay ${parlay.id}:`, updateError.message)
            continue
          }
          
          // Update leg outcomes
          for (const legResult of legResults) {
            const leg = legs.find(l => l.legOrder === legResult.leg)
            if (leg) {
              await supabase
                .from('ParlayLeg')
                .update({
                  outcome: legResult.status,
                  actualResult: legResult.actualValue ? `Actual: ${legResult.actualValue}` : null,
                  updatedAt: new Date().toISOString()
                })
                .eq('id', leg.id)
            }
          }
          
          validatedCount++
          if (allLegsWon) wonCount++
          else lostCount++
          
          console.log(`✅ Parlay ${parlay.id}: ${parlayResult.toUpperCase()} (${legs.length} legs)`)
          
          // SAVE TO HISTORY: Before deleting, save the parlay result for tracking
          console.log(`💾 Saving parlay ${parlay.id} to history...`)
          try {
            // Build legs array with results
            const legsWithResults = legs.map((leg, index) => ({
              gameId: leg.gameIdRef,
              betType: leg.betType,
              selection: leg.selection,
              playerName: leg.playerName,
              propType: leg.propType,
              threshold: leg.threshold,
              odds: leg.odds,
              probability: leg.probability,
              outcome: legResults[index]?.status || 'unknown',
              actualValue: legResults[index]?.actualValue,
              legOrder: leg.legOrder
            }))
            
            const historyRecord = {
              id: parlay.id,
              sport: parlay.sport || 'mixed',
              type: parlay.type || 'multi_game',
              legCount: parlay.legCount || legs.length,
              totalOdds: parlay.totalOdds || 0,
              probability: parlay.probability || 0,
              edge: parlay.edge || 0,
              expectedValue: parlay.expectedValue || 0,
              confidence: parlay.confidence || 'medium',
              outcome: parlayResult,
              actualResult: allLegsWon 
                ? `All ${legs.length} legs won`
                : `Lost on leg(s): ${legResults.filter(r => r.status === 'lost').map(r => r.leg).join(', ')}`,
              legs: legsWithResults,
              createdAt: parlay.createdAt || parlay.generatedAt,
              completedAt: new Date().toISOString(),
              validatedAt: new Date().toISOString()
            }
            
            const { error: historyError } = await supabase
              .from('ParlayHistory')
              .insert([historyRecord])
            
            if (historyError) {
              // If table doesn't exist, just log it - don't fail validation
              if (historyError.message.includes('Could not find the table') || historyError.message.includes('ParlayHistory')) {
                console.log(`⚠️ ParlayHistory table not created yet. Parlay result not saved to history.`)
                console.log(`   Run scripts/create-parlay-history-table.sql to enable tracking`)
              } else {
                console.error(`⚠️ Error saving to history: ${historyError.message}`)
              }
              // Don't fail - continue with deletion even if history save fails
            } else {
              console.log(`✅ Saved to history`)
            }
          } catch (historyErr) {
            console.error(`⚠️ Error saving parlay history:`, historyErr.message)
          }
          
          // AUTO-CLEANUP: Delete validated parlays immediately to keep list clean
          // (User can see results before refresh, then it auto-cleans)
          console.log(`🗑️ Auto-deleting validated parlay ${parlay.id}`)
          try {
            // Delete legs first (foreign key constraint)
            await supabase.from('ParlayLeg').delete().eq('parlayId', parlay.id)
            // Then delete parlay
            await supabase.from('Parlay').delete().eq('id', parlay.id)
            console.log(`✅ Deleted parlay ${parlay.id}`)
          } catch (deleteErr) {
            console.error(`⚠️ Error deleting parlay ${parlay.id}:`, deleteErr.message)
          }
        }
        
      } catch (error) {
        console.error(`❌ Error validating parlay ${parlay.id}:`, error.message)
        continue
      }
    }
    
    return NextResponse.json({
      success: true,
      validated: validatedCount,
      won: wonCount,
      lost: lostCount,
      pending: pendingParlays.length - validatedCount,
      message: `Validated ${validatedCount} parlays (${wonCount} won, ${lostCount} lost)`
    })
    
  } catch (error) {
    console.error('❌ Error in parlay validation:', error)
    return NextResponse.json(
      { error: 'Failed to validate parlays', details: error.message },
      { status: 500 }
    )
  }
}

export async function GET(request) {
  try {
    // Get parlay statistics
    const { data: allParlays, error } = await supabase
      .from('Parlay')
      .select('status, outcome')
    
    if (error) {
      throw new Error(`Failed to fetch parlays: ${error.message}`)
    }
    
    const stats = {
      total: allParlays?.length || 0,
      pending: allParlays?.filter(p => p.status === 'pending').length || 0,
      won: allParlays?.filter(p => p.status === 'won' || p.outcome === 'won').length || 0,
      lost: allParlays?.filter(p => p.status === 'lost' || p.outcome === 'lost').length || 0
    }
    
    return NextResponse.json({
      success: true,
      stats
    })
    
  } catch (error) {
    console.error('❌ Error fetching parlay stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch parlay stats', details: error.message },
      { status: 500 }
    )
  }
}

