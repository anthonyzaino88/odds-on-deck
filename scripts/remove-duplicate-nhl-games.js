#!/usr/bin/env node

/**
 * Remove duplicate NHL games, keeping the ones with more data
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function removeDuplicates() {
  console.log('🔍 Finding duplicate NHL games...\n')
  
  // Get all NHL games
  const { data: allGames, error: gameError } = await supabase
    .from('Game')
    .select(`
      id,
      date,
      homeId,
      awayId,
      oddsApiEventId,
      homeScore,
      awayScore,
      home:Team!Game_homeId_fkey(name, abbr),
      away:Team!Game_awayId_fkey(name, abbr)
    `)
    .eq('sport', 'nhl')
  
  if (gameError) {
    console.error('❌ Error:', gameError)
    return
  }
  
  // Group games by team matchup and date
  const gameGroups = {}
  
  for (const game of allGames) {
    const key = `${game.awayId}_${game.homeId}_${new Date(game.date).toISOString().split('T')[0]}`
    
    if (!gameGroups[key]) {
      gameGroups[key] = []
    }
    gameGroups[key].push(game)
  }
  
  // Find duplicates
  const duplicates = Object.entries(gameGroups).filter(([_, games]) => games.length > 1)
  
  if (duplicates.length === 0) {
    console.log('✅ No duplicate games found!')
    return
  }
  
  console.log(`📊 Found ${duplicates.length} duplicate game groups:\n`)
  
  let totalDeleted = 0
  
  for (const [key, games] of duplicates) {
    const game = games[0]
    console.log(`🔍 ${game.away?.abbr} @ ${game.home?.abbr} (${games.length} duplicates)`)
    
    // Score each game by data completeness
    const scoredGames = games.map(g => {
      let score = 0
      
      // Check for odds
      // We'll check this below
      
      // Check for mapping
      if (g.oddsApiEventId) score += 10
      
      // Check for scores
      if (g.homeScore !== null && g.awayScore !== null) score += 5
      
      // Prefer ID format like "TEAM_at_TEAM_DATE" over numeric IDs
      if (g.id.includes('_at_')) score += 3
      if (/^\d+$/.test(g.id)) score -= 2
      
      return { game: g, score }
    })
    
    // Check odds for each game
    for (const scored of scoredGames) {
      const { count } = await supabase
        .from('Odds')
        .select('*', { count: 'exact', head: true })
        .eq('gameId', scored.game.id)
      
      if (count > 0) {
        scored.score += count // Add odds count to score
        console.log(`   📊 ${scored.game.id}: ${count} odds, mapping: ${scored.game.oddsApiEventId ? '✅' : '❌'}, score: ${scored.score}`)
      } else {
        console.log(`   📊 ${scored.game.id}: 0 odds, mapping: ${scored.game.oddsApiEventId ? '✅' : '❌'}, score: ${scored.score}`)
      }
    }
    
    // Sort by score (highest first)
    scoredGames.sort((a, b) => b.score - a.score)
    
    const keepGame = scoredGames[0].game
    const deleteGames = scoredGames.slice(1).map(s => s.game)
    
    console.log(`   ✅ Keeping: ${keepGame.id} (score: ${scoredGames[0].score})`)
    console.log(`   🗑️  Deleting: ${deleteGames.map(g => g.id).join(', ')}\n`)
    
    // Delete duplicate games
    for (const deleteGame of deleteGames) {
      // First delete related records
      const gameId = deleteGame.id
      
      // Delete odds
      await supabase
        .from('Odds')
        .delete()
        .eq('gameId', gameId)
      
      // Delete edge snapshots
      await supabase
        .from('EdgeSnapshot')
        .delete()
        .eq('gameId', gameId)
      
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
    
    console.log()
  }
  
  console.log(`\n✅ Cleanup complete! Deleted ${totalDeleted} duplicate games.`)
}

removeDuplicates().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

