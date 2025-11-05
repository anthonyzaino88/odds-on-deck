#!/usr/bin/env node

/**
 * Copy odds from one game to another
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function copyOdds() {
  const sourceGameId = 'VAN_at_NSH_2025-11-04'
  const targetGameId = '401802552'
  
  console.log(`📋 Copying odds from ${sourceGameId} to ${targetGameId}...\n`)
  
  // Get odds from source game
  const { data: sourceOdds, error: fetchError } = await supabase
    .from('Odds')
    .select('*')
    .eq('gameId', sourceGameId)
  
  if (fetchError) {
    console.error('❌ Error fetching odds:', fetchError)
    return
  }
  
  if (!sourceOdds || sourceOdds.length === 0) {
    console.log('⚠️  No odds found for source game')
    return
  }
  
  console.log(`📊 Found ${sourceOdds.length} odds records to copy\n`)
  
  // Copy each odds record with new gameId and generate new IDs
  const newOdds = sourceOdds.map(odd => {
    const { id, gameId, ...rest } = odd
    // Generate new ID: gameId_book_market_timestamp
    const newId = `${targetGameId}_${odd.book}_${odd.market}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    return {
      id: newId,
      ...rest,
      gameId: targetGameId
    }
  })
  
  // Insert new odds
  const { data: insertedOdds, error: insertError } = await supabase
    .from('Odds')
    .insert(newOdds)
    .select()
  
  if (insertError) {
    console.error('❌ Error inserting odds:', insertError)
  } else {
    console.log(`✅ Successfully copied ${insertedOdds?.length || 0} odds records!`)
    console.log(`   Source: ${sourceGameId}`)
    console.log(`   Target: ${targetGameId}`)
  }
}

copyOdds().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

