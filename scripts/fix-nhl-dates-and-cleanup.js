#!/usr/bin/env node

/**
 * Fix NHL game dates and remove incorrect games
 * This will fetch current games from ESPN and update/delete games with wrong dates
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixAndCleanup() {
  console.log('🔧 Fixing NHL game dates and cleaning up...\n')
  
  // Get today's date
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const todayStr = today.toISOString().split('T')[0]
  
  console.log(`📅 Today (UTC): ${todayStr}\n`)
  
  // Fetch current games from ESPN for next 7 days
  const espnGames = new Map()
  
  console.log('🔄 Fetching current games from ESPN...\n')
  
  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(today)
    targetDate.setUTCDate(today.getUTCDate() + i)
    const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '')
    
    const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${dateStr}`
    
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'OddsOnDeck/1.0' }
      })
      
      if (response.ok) {
        const data = await response.json()
        const events = data.events || []
        
        for (const event of events) {
          // Normalize date to UTC
          const gameDate = new Date(event.date)
          const utcDate = new Date(Date.UTC(
            gameDate.getUTCFullYear(),
            gameDate.getUTCMonth(),
            gameDate.getUTCDate()
          ))
          const correctDate = utcDate.toISOString().split('T')[0]
          
          espnGames.set(event.id, {
            espnId: event.id,
            correctDate,
            event
          })
        }
        
        if (events.length > 0) {
          console.log(`  📅 ${targetDate.toISOString().split('T')[0]}: ${events.length} games`)
        }
      }
      
      await new Promise(r => setTimeout(r, 200))
    } catch (error) {
      console.warn(`  ⚠️  Error fetching ${targetDate.toISOString().split('T')[0]}: ${error.message}`)
    }
  }
  
  console.log(`\n📊 Found ${espnGames.size} current games from ESPN\n`)
  
  // Get all NHL games from database
  const { data: dbGames, error } = await supabase
    .from('Game')
    .select('id, date, espnGameId, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
    .not('espnGameId', 'is', null)
    .order('date', { ascending: true })
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`📊 Found ${dbGames.length} NHL games in database\n`)
  
  let updated = 0
  let deleted = 0
  let errors = 0
  
  // Process each database game
  for (const dbGame of dbGames) {
    const espnData = espnGames.get(dbGame.espnGameId)
    
    if (!espnData) {
      // Game not in ESPN's current schedule - might be old, delete it
      console.log(`🗑️  Deleting old game: ${dbGame.away.abbr} @ ${dbGame.home.abbr} (ESPN: ${dbGame.espnGameId})`)
      
      // Delete related records first
      await supabase.from('Odds').delete().eq('gameId', dbGame.id)
      await supabase.from('EdgeSnapshot').delete().eq('gameId', dbGame.id)
      await supabase.from('PlayerPropCache').delete().eq('gameId', dbGame.id)
      
      const { error: deleteError } = await supabase
        .from('Game')
        .delete()
        .eq('id', dbGame.id)
      
      if (deleteError) {
        console.error(`  ❌ Error deleting: ${deleteError.message}`)
        errors++
      } else {
        deleted++
      }
      continue
    }
    
    // Game exists in ESPN - check if date is correct
    const currentDate = new Date(dbGame.date).toISOString().split('T')[0]
    
    if (currentDate !== espnData.correctDate) {
      console.log(`🔄 Updating ${dbGame.away.abbr} @ ${dbGame.home.abbr}: ${currentDate} → ${espnData.correctDate}`)
      
      const { error: updateError } = await supabase
        .from('Game')
        .update({ date: espnData.correctDate })
        .eq('id', dbGame.id)
      
      if (updateError) {
        console.error(`  ❌ Error: ${updateError.message}`)
        errors++
      } else {
        updated++
      }
    }
  }
  
  console.log(`\n✅ Summary:`)
  console.log(`  🔄 Updated: ${updated}`)
  console.log(`  🗑️  Deleted: ${deleted}`)
  if (errors > 0) {
    console.log(`  ❌ Errors: ${errors}`)
  }
  
  // Check what's left for today
  const { data: todayGames } = await supabase
    .from('Game')
    .select('id, espnGameId, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
    .gte('date', todayStr)
    .lt('date', new Date(today.getTime() + 86400000).toISOString().split('T')[0])
  
  console.log(`\n📊 NHL games for today after cleanup: ${todayGames?.length || 0}`)
}

fixAndCleanup().catch(console.error)

