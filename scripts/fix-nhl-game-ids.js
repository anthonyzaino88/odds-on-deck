#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixGameIds() {
  console.log('🔧 Fixing NHL game IDs to match dates...\n')
  
  // Get all NHL games from the past few days
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, date, espnGameId, oddsApiEventId, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
    .gte('date', '2025-11-05')
    .lte('date', '2025-11-08')
    .order('date')
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`📊 Found ${games?.length || 0} NHL games\n`)
  
  // Group by ESPN ID to find duplicates
  const byEspnId = {}
  games?.forEach(game => {
    if (game.espnGameId) {
      if (!byEspnId[game.espnGameId]) {
        byEspnId[game.espnId] = []
      }
      byEspnId[game.espnId].push(game)
    }
  })
  
  // Find games where ID date doesn't match the actual date
  const gamesToDelete = []
  const gamesToKeep = []
  
  // First, check ALL games for ID/date mismatches
  games?.forEach(game => {
    const gameDate = new Date(game.date)
    const dateStr = gameDate.toISOString().split('T')[0]
    const idDateStr = game.id.split('_').pop() // Get date from ID (last part after _)
    
    if (dateStr !== idDateStr) {
      console.log(`⚠️  Mismatch: ${game.id} - date: ${dateStr}, ID date: ${idDateStr}`)
      gamesToDelete.push(game)
    } else {
      gamesToKeep.push(game)
    }
  })
  
  // Then, handle duplicates by ESPN ID
  Object.values(byEspnId).forEach(group => {
    if (group.length > 1) {
      // Multiple games with same ESPN ID - find the correct one
      // The correct one should have an ID that matches its date
      const correctGame = group.find(g => {
        const gameDate = new Date(g.date)
        const dateStr = gameDate.toISOString().split('T')[0]
        const idDateStr = g.id.split('_').pop()
        return dateStr === idDateStr && !gamesToDelete.find(d => d.id === g.id)
      })
      
      if (correctGame) {
        // Delete the others (if not already marked for deletion)
        group.forEach(g => {
          if (g.id !== correctGame.id && !gamesToDelete.find(d => d.id === g.id)) {
            console.log(`  🗑️  Marking duplicate ${g.id} for deletion (ESPN ID: ${g.espnGameId})`)
            gamesToDelete.push(g)
          }
        })
      } else {
        // No correct game found - keep the one with odds if any
        const withOdds = group.find(g => !gamesToDelete.find(d => d.id === g.id) && g.oddsApiEventId)
        if (withOdds) {
          group.forEach(g => {
            if (g.id !== withOdds.id && !gamesToDelete.find(d => d.id === g.id)) {
              console.log(`  🗑️  Marking duplicate ${g.id} for deletion (keeping ${withOdds.id} with odds)`)
              gamesToDelete.push(g)
            }
          })
        }
      }
    }
  })
  
  console.log(`\n📊 Summary:`)
  console.log(`  ✅ Games to keep: ${gamesToKeep.length}`)
  console.log(`  🗑️  Games to delete: ${gamesToDelete.length}\n`)
  
  if (gamesToDelete.length > 0) {
    console.log('🗑️  Deleting games with mismatched IDs...\n')
    
    for (const game of gamesToDelete) {
      console.log(`  - Deleting ${game.id} (${game.away?.abbr} @ ${game.home?.abbr})`)
      
      // First, delete any odds associated with this game
      const { error: oddsError } = await supabase
        .from('Odds')
        .delete()
        .eq('gameId', game.id)
      
      if (oddsError) {
        console.warn(`    ⚠️  Error deleting odds: ${oddsError.message}`)
      }
      
      // Then delete the game
      const { error: deleteError } = await supabase
        .from('Game')
        .delete()
        .eq('id', game.id)
      
      if (deleteError) {
        console.error(`    ❌ Error deleting game: ${deleteError.message}`)
      } else {
        console.log(`    ✅ Deleted`)
      }
    }
    
    console.log(`\n✅ Deleted ${gamesToDelete.length} games with mismatched IDs`)
    console.log(`\n💡 Now re-run: node scripts/fetch-fresh-games.js nhl 2025-11-06`)
  } else {
    console.log('✅ No games need to be deleted - all IDs match their dates!')
  }
}

fixGameIds().catch(console.error)

