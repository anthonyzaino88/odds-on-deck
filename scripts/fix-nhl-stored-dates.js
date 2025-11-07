#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixStoredDates() {
  console.log('🔧 Fixing NHL game stored dates to match EST dates...\n')
  console.log('Games should be stored with UTC dates that represent the correct EST date\n')
  
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
    // Get the date from the game ID (this is the EST date)
    const idParts = game.id.split('_')
    const idDateStr = idParts[idParts.length - 1] // Last part is the date (YYYY-MM-DD)
    
    // Parse current stored date
    const dateStr = game.date || ''
    const dateWithZ = dateStr.includes('Z') || dateStr.includes('+') || dateStr.match(/[+-]\d{2}:\d{2}$/)
      ? dateStr
      : dateStr + 'Z'
    
    const currentDate = new Date(dateWithZ)
    
    // Get EST date from current stored date
    const currentEstDateStr = currentDate.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    const [currentEstMonth, currentEstDay, currentEstYear] = currentEstDateStr.split('/')
    const currentEstDateForId = `${currentEstYear}-${currentEstMonth.padStart(2, '0')}-${currentEstDay.padStart(2, '0')}`
    
    // Check if EST date matches the ID date
    if (currentEstDateForId !== idDateStr) {
      console.log(`🔄 ${game.away?.abbr} @ ${game.home?.abbr}`)
      console.log(`   Game ID date: ${idDateStr}`)
      console.log(`   Current stored: ${currentDate.toISOString()}`)
      console.log(`   Current EST: ${currentEstDateForId} (${currentDate.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })})`)
      
      // We need to adjust the UTC date so the EST date matches the ID date
      // Get the time components from the current date
      const currentHour = currentDate.getUTCHours()
      const currentMinute = currentDate.getUTCMinutes()
      const currentSecond = currentDate.getUTCSeconds()
      
      // Parse the ID date (EST date)
      const [idYear, idMonth, idDay] = idDateStr.split('-')
      
      // Create a date at midnight EST on the ID date, then add the UTC time
      // But we need to figure out what UTC time gives us the right EST time
      // Actually, we should preserve the EST time and convert to UTC
      
      // Get the EST time from current date
      const estTimeStr = currentDate.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: false
      })
      const [estHour, estMinute] = estTimeStr.split(':').map(Number)
      
      // Create date at the EST time on the ID date, then convert to UTC
      // Use a date string that represents the EST time, then parse it
      // Actually, easier: create a date in EST timezone, then get UTC equivalent
      const estDateObj = new Date(`${idYear}-${idMonth}-${idDay}T${estHour.toString().padStart(2, '0')}:${estMinute.toString().padStart(2, '0')}:00-05:00`) // EST is UTC-5
      // But DST might be in effect, so use America/New_York timezone
      // Actually, JavaScript doesn't have a direct way to create a date in a specific timezone
      // We need to calculate the UTC offset
      
      // Simpler approach: Use the current UTC time but adjust the date part
      // If current EST date is Nov 5 but should be Nov 6, we need to add 24 hours to UTC
      const dateDiff = new Date(`${idDateStr}T00:00:00Z`).getTime() - new Date(`${currentEstDateForId}T00:00:00Z`).getTime()
      const adjustedDate = new Date(currentDate.getTime() + dateDiff)
      
      console.log(`   Adjusted UTC: ${adjustedDate.toISOString()}`)
      console.log(`   Adjusted EST: ${adjustedDate.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`)
      
      const { error: updateError } = await supabase
        .from('Game')
        .update({ date: adjustedDate.toISOString() })
        .eq('id', game.id)
      
      if (updateError) {
        console.error(`   ❌ Error: ${updateError.message}`)
        errors++
      } else {
        updated++
        console.log(`   ✅ Updated`)
      }
      console.log('')
    } else {
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

fixStoredDates().catch(console.error)

