#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixDateTimes() {
  console.log('🔧 Fixing NHL game date times...\n')
  
  // Get all NHL games for Nov 6, 2025 (the date the user is looking at)
  // Check a wider range to catch any games that might be stored with wrong dates
  const targetDate = '2025-11-06'
  const dateStart = '2025-11-05T00:00:00'
  const dateEnd = '2025-11-07T23:59:59'
  
  console.log(`📅 Checking games around ${targetDate} (Nov 5-7)\n`)
  
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, date, espnGameId, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
    .gte('date', dateStart)
    .lte('date', dateEnd)
    .order('date')
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`📊 Found ${games?.length || 0} NHL games\n`)
  
  let updated = 0
  let errors = 0
  
  for (const game of games || []) {
    // Parse the current date
    const currentDate = new Date(game.date)
    const dateStr = currentDate.toISOString().split('T')[0]
    const [year, month, day] = dateStr.split('-')
    
    // Check if the time is midnight UTC (00:00:00)
    const isMidnightUTC = currentDate.getUTCHours() === 0 && 
                          currentDate.getUTCMinutes() === 0 && 
                          currentDate.getUTCSeconds() === 0
    
    if (isMidnightUTC) {
      // Fix: Change from midnight UTC to 5 AM UTC (midnight EST)
      const fixedDate = new Date(Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        5, 0, 0  // 5 AM UTC = midnight EST
      ))
      
      console.log(`🔄 ${game.away?.abbr} @ ${game.home?.abbr}`)
      console.log(`   Current: ${currentDate.toISOString()} (${currentDate.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })})`)
      console.log(`   Fixed:   ${fixedDate.toISOString()} (${fixedDate.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })})`)
      
      const { error: updateError } = await supabase
        .from('Game')
        .update({ date: fixedDate.toISOString() })
        .eq('id', game.id)
      
      if (updateError) {
        console.error(`  ❌ Error: ${updateError.message}`)
        errors++
      } else {
        updated++
        console.log(`   ✅ Updated`)
      }
      console.log('')
    } else {
      // Check what it currently shows
      const estDisplay = currentDate.toLocaleString('en-US', { 
        timeZone: 'America/New_York', 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric', 
        hour: 'numeric', 
        minute: '2-digit' 
      })
      console.log(`✓ ${game.away?.abbr} @ ${game.home?.abbr}: ${currentDate.toISOString()} → ${estDisplay}`)
    }
  }
  
  console.log(`\n✅ Fixed ${updated} game dates`)
  if (errors > 0) {
    console.log(`❌ ${errors} errors`)
  }
}

fixDateTimes().catch(console.error)

