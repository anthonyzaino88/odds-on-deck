#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixAllDates() {
  console.log('🔧 Fixing ALL NHL game dates to ensure correct storage...\n')
  
  // Get all NHL games from the past week and next week
  const today = new Date()
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const weekFromNow = new Date(today)
  weekFromNow.setDate(weekFromNow.getDate() + 7)
  
  const dateStart = weekAgo.toISOString().split('T')[0]
  const dateEnd = weekFromNow.toISOString().split('T')[0]
  
  console.log(`📅 Checking games from ${dateStart} to ${dateEnd}\n`)
  
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, date, espnGameId, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
    .gte('date', `${dateStart}T00:00:00`)
    .lte('date', `${dateEnd}T23:59:59`)
    .order('date')
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`📊 Found ${games?.length || 0} NHL games\n`)
  
  let updated = 0
  let skipped = 0
  let errors = 0
  
  for (const game of games || []) {
    const currentDate = new Date(game.date)
    const dateStr = currentDate.toISOString().split('T')[0]
    const [year, month, day] = dateStr.split('-')
    
    // Check if the time is midnight UTC (00:00:00) - this is the problematic case
    const isMidnightUTC = currentDate.getUTCHours() === 0 && 
                          currentDate.getUTCMinutes() === 0 && 
                          currentDate.getUTCSeconds() === 0
    
    if (isMidnightUTC) {
      // Fix: Change from midnight UTC to 5 AM UTC (midnight EST)
      // This ensures the date shows correctly as the intended day in EST
      const fixedDate = new Date(Date.UTC(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        5, 0, 0  // 5 AM UTC = midnight EST
      ))
      
      console.log(`🔄 ${game.away?.abbr} @ ${game.home?.abbr}`)
      console.log(`   Current: ${currentDate.toISOString()} → ${currentDate.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`)
      console.log(`   Fixed:   ${fixedDate.toISOString()} → ${fixedDate.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`)
      
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
      // Date already has correct time - verify it shows correctly
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
      skipped++
    }
  }
  
  console.log(`\n✅ Summary:`)
  console.log(`  🔄 Updated: ${updated} games`)
  console.log(`  ✓ Skipped (already correct): ${skipped} games`)
  if (errors > 0) {
    console.log(`  ❌ Errors: ${errors}`)
  }
}

fixAllDates().catch(console.error)

