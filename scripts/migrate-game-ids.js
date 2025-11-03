#!/usr/bin/env node

/**
 * Migrate all games to consistent game ID format
 * Converts numeric ESPN IDs to descriptive format: AWAY_AT_HOME_YYYY-MM-DD
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { createGameId } from '../lib/team-mapping.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function migrateGameIds() {
  console.log('🔄 MIGRATING GAME IDs TO CONSISTENT FORMAT')
  console.log('='.repeat(50))
  console.log()
  
  // Get all games with numeric IDs (likely ESPN IDs)
  const { data: allGames, error: gamesError } = await supabase
    .from('Game')
    .select(`
      id,
      sport,
      date,
      homeId,
      awayId,
      espnGameId,
      oddsApiEventId,
      home:Team!Game_homeId_fkey(abbr, name),
      away:Team!Game_awayId_fkey(abbr, name)
    `)
  
  if (gamesError) {
    console.error('❌ Error fetching games:', gamesError)
    return
  }
  
  console.log(`📊 Found ${allGames.length} total games\n`)
  
  // Find games with numeric IDs
  const numericIdGames = allGames.filter(g => /^\d+$/.test(g.id))
  
  console.log(`🔍 Found ${numericIdGames.length} games with numeric IDs to migrate\n`)
  
  if (numericIdGames.length === 0) {
    console.log('✅ All games already use descriptive IDs!')
    return
  }
  
  let migrated = 0
  let errors = 0
  
  for (const game of numericIdGames) {
    const oldId = game.id
    const awayAbbr = game.away?.abbr || game.awayId.replace(/^(NFL|NHL|MLB)_/i, '')
    const homeAbbr = game.home?.abbr || game.homeId.replace(/^(NFL|NHL|MLB)_/i, '')
    const gameDate = new Date(game.date)
    const dateStr = gameDate.toISOString().split('T')[0]
    
    // Generate new descriptive ID
    const newId = createGameId(awayAbbr, homeAbbr, dateStr)
    
    // Check if new ID already exists (might be a duplicate)
    const { data: existing } = await supabase
      .from('Game')
      .select('id')
      .eq('id', newId)
      .single()
    
    if (existing) {
      console.log(`⚠️  ${oldId} → ${newId} (already exists, will merge data)`)
      
      // Merge: Copy odds and other data from old game to existing game
      // Then delete the old game
      await migrateGameData(oldId, newId, true)
      errors++
      continue
    }
    
    console.log(`📝 ${oldId} → ${newId} (${game.away?.abbr} @ ${game.home?.abbr})`)
    
    // Step 1: Create new game with new ID (copy all data)
    const { data: oldGameData } = await supabase
      .from('Game')
      .select('*')
      .eq('id', oldId)
      .single()
    
    if (!oldGameData) {
      console.error(`  ❌ Could not fetch game data`)
      errors++
      continue
    }
    
    // Create new game with new ID
    const { error: createError } = await supabase
      .from('Game')
      .insert({
        ...oldGameData,
        id: newId
      })
    
    if (createError) {
      console.error(`  ❌ Error creating new game: ${createError.message}`)
      errors++
      continue
    }
    
    // Step 2: Migrate related data (odds, edge snapshots, etc.)
    await migrateGameData(oldId, newId, false)
    
    // Step 3: Delete old game
    const { error: deleteError } = await supabase
      .from('Game')
      .delete()
      .eq('id', oldId)
    
    if (deleteError) {
      console.error(`  ⚠️  Error deleting old game: ${deleteError.message}`)
    } else {
      migrated++
      console.log(`  ✅ Migrated`)
    }
    
    console.log()
  }
  
  console.log('='.repeat(50))
  console.log(`✅ MIGRATION COMPLETE`)
  console.log(`   Migrated: ${migrated} games`)
  console.log(`   Conflicts: ${errors} games (merged with existing)`)
  console.log()
}

async function migrateGameData(oldGameId, newGameId, isMerge) {
  // Update Odds table (only if new game exists)
  const { error: oddsError } = await supabase
    .from('Odds')
    .update({ gameId: newGameId })
    .eq('gameId', oldGameId)
  
  if (oddsError) {
    // Check if it's a foreign key error (means new game doesn't exist yet - should be handled by order)
    if (oddsError.code === '23503') {
      console.error(`    ⚠️  Odds migration: New game ${newGameId} doesn't exist yet`)
    } else if (!oddsError.code?.includes('23505')) {
      console.error(`    ⚠️  Odds migration error: ${oddsError.message}`)
    }
  }
  
  // Update EdgeSnapshot table
  const { error: edgeError } = await supabase
    .from('EdgeSnapshot')
    .update({ gameId: newGameId })
    .eq('gameId', oldGameId)
  
  if (edgeError && edgeError.code !== '23503' && !edgeError.code?.includes('23505')) {
    console.error(`    ⚠️  EdgeSnapshot migration error: ${edgeError.message}`)
  }
  
  // Update NFLGameData table
  const { error: nflError } = await supabase
    .from('NFLGameData')
    .update({ gameId: newGameId })
    .eq('gameId', oldGameId)
  
  if (nflError && nflError.code !== '23503' && !nflError.code?.includes('23505')) {
    console.error(`    ⚠️  NFLGameData migration error: ${nflError.message}`)
  }
  
  // Update LineupEntry table (if it exists - MLB only)
  try {
    const { error: lineupError } = await supabase
      .from('LineupEntry')
      .update({ gameId: newGameId })
      .eq('gameId', oldGameId)
    
    if (lineupError && lineupError.code !== '42P01' && lineupError.code !== '23503' && !lineupError.code?.includes('23505')) {
      console.error(`    ⚠️  LineupEntry migration error: ${lineupError.message}`)
    }
  } catch (err) {
    // Table doesn't exist, that's fine
  }
  
  // If merging, delete the old game after migrating data
  if (isMerge) {
    await supabase
      .from('Game')
      .delete()
      .eq('id', oldGameId)
  }
}

migrateGameIds().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

