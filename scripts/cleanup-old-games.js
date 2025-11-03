#!/usr/bin/env node

/**
 * CLEANUP OLD GAMES FROM DATABASE
 * 
 * Removes games outside the current date ranges:
 * - NFL: Outside current week (Mon-Sun)
 * - NHL: Outside today
 * - MLB: Outside today
 * 
 * Handles foreign key constraints by deleting Odds first
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function cleanupOldGames() {
  console.log('🧹 CLEANUP OLD GAMES')
  console.log('='.repeat(50))
  
  // Calculate date ranges
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  
  // NFL: Current week (Sunday to Sunday)
  const dayOfWeek = now.getDay()
  let weekStart, weekEnd
  if (dayOfWeek === 0) {
    weekStart = new Date(today)
  } else {
    weekStart = new Date(today)
    weekStart.setDate(today.getDate() - dayOfWeek)
  }
  weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)
  weekEnd.setHours(23, 59, 59, 999)
  
  console.log(`📅 Date ranges:`)
  console.log(`   MLB/NHL: Today only (${today.toISOString()}) - ${tomorrow.toISOString()})`)
  console.log(`   NFL: Current week (${weekStart.toISOString()} - ${weekEnd.toISOString()})`)
  console.log()
  
  let totalDeleted = 0
  
  // ============================================================================
  // STEP 1: Find old games to delete
  // ============================================================================
  
  // Find old MLB games (outside today)
  const { data: oldMLBGames } = await supabase
    .from('Game')
    .select('id, date, sport')
    .eq('sport', 'mlb')
    .or(`date.lt.${today.toISOString()},date.gte.${tomorrow.toISOString()}`)
  
  // Find old NHL games (outside today)
  const { data: oldNHLGames } = await supabase
    .from('Game')
    .select('id, date, sport')
    .eq('sport', 'nhl')
    .or(`date.lt.${today.toISOString()},date.gte.${tomorrow.toISOString()}`)
  
  // Find old NFL games (outside current week)
  const { data: oldNFLGames } = await supabase
    .from('Game')
    .select('id, date, sport')
    .eq('sport', 'nfl')
    .or(`date.lt.${weekStart.toISOString()},date.gte.${weekEnd.toISOString()}`)
  
  // Debug: Show what we found
  if (oldMLBGames && oldMLBGames.length > 0) {
    console.log(`   MLB examples: ${oldMLBGames.slice(0, 3).map(g => `${g.id} (${g.date})`).join(', ')}`)
  }
  if (oldNHLGames && oldNHLGames.length > 0) {
    console.log(`   NHL examples: ${oldNHLGames.slice(0, 3).map(g => `${g.id} (${g.date})`).join(', ')}`)
  }
  if (oldNFLGames && oldNFLGames.length > 0) {
    console.log(`   NFL examples: ${oldNFLGames.slice(0, 3).map(g => `${g.id} (${g.date})`).join(', ')}`)
  }
  
  const oldGames = [
    ...(oldMLBGames || []),
    ...(oldNHLGames || []),
    ...(oldNFLGames || [])
  ]
  
  console.log(`🔍 Found ${oldGames.length} old games to delete:`)
  console.log(`   MLB: ${oldMLBGames?.length || 0}`)
  console.log(`   NFL: ${oldNFLGames?.length || 0}`)
  console.log(`   NHL: ${oldNHLGames?.length || 0}`)
  console.log()
  
  if (oldGames.length === 0) {
    console.log('✅ No old games to clean up!')
    return
  }
  
  // ============================================================================
  // STEP 2: Delete Odds records for old games (to avoid FK constraint errors)
  // ============================================================================
  
  const oldGameIds = oldGames.map(g => g.id)
  console.log(`🗑️  Deleting Odds records for ${oldGameIds.length} old games...`)
  
  const { error: oddsError, count: deletedOdds } = await supabase
    .from('Odds')
    .delete()
    .in('gameId', oldGameIds)
    .select('*', { count: 'exact', head: true })
  
  if (oddsError) {
    console.error(`⚠️  Error deleting odds: ${oddsError.message}`)
  } else {
    console.log(`✅ Deleted ${deletedOdds || 0} Odds records`)
  }
  
  // ============================================================================
  // STEP 3: Delete EdgeSnapshot records for old games
  // ============================================================================
  
  console.log(`🗑️  Deleting EdgeSnapshot records for ${oldGameIds.length} old games...`)
  
  const { error: edgeError, count: deletedEdges } = await supabase
    .from('EdgeSnapshot')
    .delete()
    .in('gameId', oldGameIds)
    .select('*', { count: 'exact', head: true })
  
  if (edgeError) {
    console.error(`⚠️  Error deleting edges: ${edgeError.message}`)
  } else {
    console.log(`✅ Deleted ${deletedEdges || 0} EdgeSnapshot records`)
  }
  
  // ============================================================================
  // STEP 3b: Delete NFLGameData records for old games
  // ============================================================================
  
  console.log(`🗑️  Deleting NFLGameData records for ${oldGameIds.length} old games...`)
  
  const { error: nflDataError, count: deletedNFLData } = await supabase
    .from('NFLGameData')
    .delete()
    .in('gameId', oldGameIds)
    .select('*', { count: 'exact', head: true })
  
  if (nflDataError) {
    console.error(`⚠️  Error deleting NFL data: ${nflDataError.message}`)
  } else {
    console.log(`✅ Deleted ${deletedNFLData || 0} NFLGameData records`)
  }
  
  // ============================================================================
  // STEP 4: Delete old Game records
  // ============================================================================
  
  console.log(`🗑️  Deleting ${oldGameIds.length} old Game records...`)
  
  // Delete in batches to avoid query size limits
  const batchSize = 50
  let deletedGames = 0
  
  for (let i = 0; i < oldGameIds.length; i += batchSize) {
    const batch = oldGameIds.slice(i, i + batchSize)
    const { data: deletedData, error: gameError } = await supabase
      .from('Game')
      .delete()
      .in('id', batch)
      .select()
    
    if (gameError) {
      console.error(`⚠️  Error deleting batch ${i / batchSize + 1}: ${gameError.message}`)
    } else {
      const batchCount = deletedData?.length || 0
      deletedGames += batchCount
      console.log(`   ✅ Deleted batch ${i / batchSize + 1}: ${batchCount} games`)
    }
  }
  
  console.log()
  console.log('='.repeat(50))
  console.log(`✅ CLEANUP COMPLETE`)
  console.log(`   Deleted ${deletedGames} old games`)
  console.log(`   Deleted ${deletedOdds || 0} odds records`)
  console.log(`   Deleted ${deletedEdges || 0} edge snapshots`)
  console.log(`   Deleted ${deletedNFLData || 0} NFL game data records`)
  console.log()
}

cleanupOldGames().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

