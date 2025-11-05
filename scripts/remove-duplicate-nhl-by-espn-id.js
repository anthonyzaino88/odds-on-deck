#!/usr/bin/env node

/**
 * Remove duplicate NHL games by ESPN ID
 * 
 * This script finds games with the same ESPN ID and keeps only the best one
 * (the one with most data, odds mapping, etc.)
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function removeDuplicatesByEspnId() {
  console.log('🔍 Finding duplicate NHL games by ESPN ID...\n')
  
  // Get all NHL games with ESPN IDs
  const { data: games, error } = await supabase
    .from('Game')
    .select(`
      id,
      date,
      homeId,
      awayId,
      homeScore,
      awayScore,
      status,
      espnGameId,
      oddsApiEventId,
      home:Team!Game_homeId_fkey(name, abbr),
      away:Team!Game_awayId_fkey(name, abbr)
    `)
    .eq('sport', 'nhl')
    .not('espnGameId', 'is', null)
    .order('date', { ascending: true })
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`📊 Found ${games.length} NHL games with ESPN IDs\n`)
  
  // Group by ESPN ID
  const espnIdGroups = {}
  
  for (const game of games) {
    if (!game.espnGameId) continue
    
    if (!espnIdGroups[game.espnGameId]) {
      espnIdGroups[game.espnGameId] = []
    }
    espnIdGroups[game.espnGameId].push(game)
  }
  
  // Find duplicates
  const duplicates = Object.entries(espnIdGroups).filter(([_, games]) => games.length > 1)
  
  if (duplicates.length === 0) {
    console.log('✅ No duplicate games found!')
    return
  }
  
  console.log(`⚠️  Found ${duplicates.length} duplicate game groups (same ESPN ID)\n`)
  
  let totalDeleted = 0
  
  for (const [espnId, gameGroup] of duplicates) {
    const game = gameGroup[0]
    console.log(`🔍 ESPN ID ${espnId}: ${game.away.abbr} @ ${game.home.abbr} (${gameGroup.length} duplicates)`)
    
    // Score each game by data completeness
    const scoredGames = await Promise.all(gameGroup.map(async (g) => {
      let score = 0
      
      // Check for odds mapping
      if (g.oddsApiEventId) score += 10
      
      // Check for scores
      if (g.homeScore !== null && g.awayScore !== null) score += 5
      
      // Prefer ID format like "TEAM_at_TEAM_DATE" over numeric IDs
      if (g.id.includes('_at_')) score += 3
      if (/^\d+$/.test(g.id)) score -= 2
      
      // Check for odds in database
      const { count: oddsCount } = await supabase
        .from('Odds')
        .select('*', { count: 'exact', head: true })
        .eq('gameId', g.id)
      
      if (oddsCount > 0) score += oddsCount
      
      // Prefer newer date (more recent fetch)
      const dateScore = new Date(g.date).getTime()
      score += dateScore / 1000000 // Small boost for newer dates
      
      return { game: g, score }
    }))
    
    // Sort by score (highest first)
    scoredGames.sort((a, b) => b.score - a.score)
    
    const keepGame = scoredGames[0].game
    const deleteGames = scoredGames.slice(1).map(s => s.game)
    
    console.log(`   ✅ Keeping: ${keepGame.id} (score: ${scoredGames[0].score.toFixed(2)})`)
    console.log(`   🗑️  Deleting: ${deleteGames.map(g => g.id).join(', ')}\n`)
    
    // Delete duplicate games
    for (const deleteGame of deleteGames) {
      const gameId = deleteGame.id
      
      // Delete related records first
      await supabase.from('Odds').delete().eq('gameId', gameId)
      await supabase.from('EdgeSnapshot').delete().eq('gameId', gameId)
      await supabase.from('PlayerPropCache').delete().eq('gameId', gameId)
      
      // Delete the game
      const { error: deleteError } = await supabase
        .from('Game')
        .delete()
        .eq('id', gameId)
      
      if (deleteError) {
        console.error(`   ❌ Error deleting ${gameId}: ${deleteError.message}`)
      } else {
        totalDeleted++
        console.log(`   ✅ Deleted ${gameId}`)
      }
    }
  }
  
  console.log(`\n✅ Cleanup complete! Deleted ${totalDeleted} duplicate games.`)
  console.log(`\n📊 Remaining unique games: ${games.length - totalDeleted}`)
}

removeDuplicatesByEspnId().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

