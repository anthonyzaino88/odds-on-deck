#!/usr/bin/env node

import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createScriptSupabaseClient()

async function fixLateEveningDates() {
  console.log('🔧 Fixing late evening EST games (8 PM - 11 PM EST)...\n')
  console.log('These games should have UTC dates on the NEXT day\n')
  
  // Get all NHL games from Nov 5-7
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, date, espnGameId, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
    .gte('date', '2025-11-05T00:00:00')
    .lte('date', '2025-11-08T23:59:59')
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
    // Parse the date (add Z if missing)
    const dateStr = game.date || ''
    const dateWithZ = dateStr.includes('Z') || dateStr.includes('+') || dateStr.match(/[+-]\d{2}:\d{2}$/)
      ? dateStr
      : dateStr + 'Z'
    
    const currentDate = new Date(dateWithZ)
    const estHour = currentDate.toLocaleString('en-US', { 
      timeZone: 'America/New_York', 
      hour: 'numeric',
      hour12: false
    })
    const estDate = currentDate.toLocaleDateString('en-US', { 
      timeZone: 'America/New_York',
      month: 'numeric',
      day: 'numeric',
      year: 'numeric'
    })
    const utcDate = currentDate.toISOString().split('T')[0]
    
    // Check if this is a late evening game (8 PM - 11 PM EST)
    const hour24 = parseInt(estHour.split(':')[0])
    const isLateEvening = hour24 >= 20 && hour24 <= 23
    
    if (isLateEvening) {
      // Late evening EST games should have UTC date on the NEXT day
      // e.g., 10 PM EST on Nov 6 = 3 AM UTC on Nov 7
      const [estMonth, estDay, estYear] = estDate.split('/')
      const expectedUtcDate = new Date(Date.UTC(
        parseInt(estYear),
        parseInt(estMonth) - 1,
        parseInt(estDay),
        currentDate.getUTCHours(),
        currentDate.getUTCMinutes(),
        currentDate.getUTCSeconds()
      ))
      // Add 1 day to get the correct UTC date
      expectedUtcDate.setUTCDate(expectedUtcDate.getUTCDate() + 1)
      
      const currentUtcDateStr = utcDate
      const expectedUtcDateStr = expectedUtcDate.toISOString().split('T')[0]
      
      if (currentUtcDateStr !== expectedUtcDateStr) {
        console.log(`🔄 ${game.away?.abbr} @ ${game.home?.abbr}`)
        console.log(`   Current: ${currentDate.toISOString()} → ${estDate} ${estHour} EST (UTC: ${currentUtcDateStr})`)
        console.log(`   Should be: UTC date ${expectedUtcDateStr} to show ${estDate} ${estHour} EST`)
        
        const { error: updateError } = await supabase
          .from('Game')
          .update({ date: expectedUtcDate.toISOString() })
          .eq('id', game.id)
        
        if (updateError) {
          console.error(`  ❌ Error: ${updateError.message}`)
          errors++
        } else {
          updated++
          console.log(`   ✅ Updated to ${expectedUtcDate.toISOString()}`)
        }
        console.log('')
      } else {
        skipped++
      }
    } else {
      skipped++
    }
  }
  
  console.log(`\n✅ Summary:`)
  console.log(`  🔄 Updated: ${updated} games`)
  console.log(`  ✓ Skipped: ${skipped} games`)
  if (errors > 0) {
    console.log(`  ❌ Errors: ${errors}`)
  }
}

fixLateEveningDates().catch(console.error)

