#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixDate() {
  console.log('🔧 Fixing FLA @ LA game date...\n')
  
  // Get the game
  const { data: game, error } = await supabase
    .from('Game')
    .select('id, date, espnGameId, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('id', 'FLA_at_LA_2025-11-06')
    .single()
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  if (!game) {
    console.error('❌ Game not found')
    return
  }
  
  console.log(`📊 Current date: ${game.date}`)
  const currentDate = new Date(game.date + 'Z') // Add Z to see what it currently represents
  console.log(`   Parsed: ${currentDate.toISOString()}`)
  console.log(`   EST: ${currentDate.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`)
  
  // The game should be at 10 PM EST on Nov 6, which is 3 AM UTC on Nov 7
  // We need to store it as '2025-11-07T03:00:00Z' (with Z) so it parses correctly
  // When stored with Z: 2025-11-07T03:00:00Z = 3 AM UTC on Nov 7 = 10 PM EST on Nov 6 ✅
  const correctDate = new Date('2025-11-07T03:00:00Z')
  console.log(`\n✅ Correct date: ${correctDate.toISOString()}`)
  console.log(`   EST: ${correctDate.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`)
  
  // Store with 'Z' explicitly - Supabase should preserve it
  const { error: updateError } = await supabase
    .from('Game')
    .update({ date: '2025-11-07T03:00:00Z' }) // Explicitly with Z
    .eq('id', game.id)
  
  if (updateError) {
    console.error(`\n❌ Error updating: ${updateError.message}`)
  } else {
    console.log(`\n✅ Successfully updated game date!`)
  }
}

fixDate().catch(console.error)

