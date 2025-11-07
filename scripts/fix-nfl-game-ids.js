#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { createGameId } from '../lib/team-mapping.js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixNFLGameIds() {
  console.log('🔧 Fixing NFL game IDs to use EST dates instead of UTC dates...\n')
  
  // Get all NFL games from the past week and next week
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
    .eq('sport', 'nfl')
    .gte('date', `${dateStart}T00:00:00`)
    .lte('date', `${dateEnd}T23:59:59`)
    .order('date')
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`📊 Found ${games?.length || 0} NFL games\n`)
  
  let updated = 0
  let skipped = 0
  let errors = 0
  
  for (const game of games || []) {
    // Parse the date (add Z if missing to treat as UTC)
    const dateStr = game.date || ''
    const dateWithZ = dateStr.includes('Z') || dateStr.includes('+') || dateStr.match(/[+-]\d{2}:\d{2}$/)
      ? dateStr
      : dateStr + 'Z'
    
    const gameDate = new Date(dateWithZ)
    
    // Get EST date from the stored date
    const estDateStr = gameDate.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    // Convert MM/DD/YYYY to YYYY-MM-DD
    const [month, day, year] = estDateStr.split('/')
    const estDateForId = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    
    // Get current game ID date
    const idParts = game.id.split('_')
    const currentIdDate = idParts[idParts.length - 1] // Last part is the date
    
    if (currentIdDate !== estDateForId) {
      console.log(`🔄 ${game.away?.abbr} @ ${game.home?.abbr}`)
      console.log(`   Current ID: ${game.id} (date in ID: ${currentIdDate})`)
      console.log(`   Game date (EST): ${estDateForId}`)
      console.log(`   Game time (EST): ${gameDate.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`)
      
      // Create new game ID with correct EST date
      const newGameId = createGameId(game.away?.abbr, game.home?.abbr, estDateForId)
      console.log(`   New ID: ${newGameId}`)
      
      // Check if new ID already exists
      const { data: existingGame } = await supabase
        .from('Game')
        .select('id')
        .eq('id', newGameId)
        .single()
      
      if (existingGame) {
        console.log(`   ⚠️  New ID already exists! Skipping to avoid conflicts.`)
        skipped++
      } else {
        // Update game ID - need to update all related records first
        // 1. Update Odds records
        const { error: oddsError } = await supabase
          .from('Odds')
          .update({ gameId: newGameId })
          .eq('gameId', game.id)
        
        if (oddsError) {
          console.error(`   ❌ Error updating Odds: ${oddsError.message}`)
          errors++
          continue
        }
        
        // 2. Update EdgeSnapshot records
        const { error: edgeError } = await supabase
          .from('EdgeSnapshot')
          .update({ gameId: newGameId })
          .eq('gameId', game.id)
        
        if (edgeError) {
          console.error(`   ❌ Error updating EdgeSnapshot: ${edgeError.message}`)
          errors++
          continue
        }
        
        // 3. Update PlayerPropCache records
        const { error: propsError } = await supabase
          .from('PlayerPropCache')
          .update({ gameId: newGameId })
          .eq('gameId', game.id)
        
        if (propsError) {
          console.error(`   ❌ Error updating PlayerPropCache: ${propsError.message}`)
          errors++
          continue
        }
        
        // 4. Update NFLGameData records
        const { error: nflError } = await supabase
          .from('NFLGameData')
          .update({ gameId: newGameId })
          .eq('gameId', game.id)
        
        if (nflError) {
          console.error(`   ❌ Error updating NFLGameData: ${nflError.message}`)
          errors++
          continue
        }
        
        // 5. Finally, update the Game record itself
        const { error: gameError } = await supabase
          .from('Game')
          .update({ id: newGameId })
          .eq('id', game.id)
        
        if (gameError) {
          console.error(`   ❌ Error updating Game: ${gameError.message}`)
          errors++
        } else {
          updated++
          console.log(`   ✅ Updated game ID`)
        }
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

fixNFLGameIds().catch(console.error)

