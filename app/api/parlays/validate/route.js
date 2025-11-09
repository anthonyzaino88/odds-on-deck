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
        
        for (const leg of legs) {
          // Find the PropValidation record for this leg
          // The parlayId is stored in PropValidation.parlayId
          const { data: validations, error: validationError } = await supabase
            .from('PropValidation')
            .select('*')
            .eq('parlayId', parlay.id)
            .eq('playerName', leg.playerName || '')
            .eq('propType', leg.propType || '')
            .eq('threshold', leg.threshold || 0)
            .limit(1)
          
          if (validationError || !validations || validations.length === 0) {
            // No validation record found - leg not yet validated
            allLegsValidated = false
            legResults.push({ leg: leg.legOrder, status: 'pending' })
            break
          }
          
          const validation = validations[0]
          
          if (validation.status !== 'completed') {
            // Leg validation not complete yet
            allLegsValidated = false
            legResults.push({ leg: leg.legOrder, status: 'pending' })
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

