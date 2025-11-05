#!/usr/bin/env node

/**
 * Fix duplicate NHL games on Vercel/Production
 * 
 * This script can be run locally but connects to the same Supabase database
 * that Vercel uses, so it will fix duplicates in production.
 * 
 * Usage:
 *   node scripts/fix-vercel-nhl-duplicates.js
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixDuplicates() {
  console.log('🔍 Finding and fixing duplicate NHL games...\n')
  
  // Get today's date range - check both today and tomorrow
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const tomorrow = new Date(today)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const yesterday = new Date(today)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  
  const todayStr = today.toISOString().split('T')[0]
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
  const yesterdayStr = yesterday.toISOString().split('T')[0]
  
  console.log(`📅 Current date (UTC): ${todayStr}`)
  console.log(`📅 Checking games for: ${yesterdayStr}, ${todayStr}, and ${tomorrowStr}\n`)
  
  // Get all NHL games for today, yesterday, and tomorrow to see what we have
  const { data: allGames, error: allError } = await supabase
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
    .gte('date', yesterdayStr)
    .lt('date', tomorrowStr)
    .order('date', { ascending: true })
  
  if (allError) {
    console.error('❌ Error:', allError)
    return
  }
  
  console.log(`📊 Total games found (yesterday + today + tomorrow): ${allGames.length}\n`)
  
  // Group by date
  const gamesByDate = {}
  allGames.forEach(g => {
    const dateKey = new Date(g.date).toISOString().split('T')[0]
    if (!gamesByDate[dateKey]) {
      gamesByDate[dateKey] = []
    }
    gamesByDate[dateKey].push(g)
  })
  
  console.log('📅 Games by date:')
  Object.keys(gamesByDate).sort().forEach(date => {
    console.log(`  ${date}: ${gamesByDate[date].length} games`)
  })
  console.log()
  
  // Filter to just today's games
  const games = gamesByDate[todayStr] || []
  
  console.log(`📊 Found ${games.length} NHL games for today (${todayStr})\n`)
  
  // Also check if we have games from tomorrow that might be showing
  const tomorrowGames = gamesByDate[tomorrowStr] || []
  if (tomorrowGames.length > 0) {
    console.log(`📊 Found ${tomorrowGames.length} NHL games for tomorrow (${tomorrowStr})\n`)
  }
  
  // Group by matchup (awayId + homeId + date)
  const matchupGroups = {}
  // Also group by ESPN ID to catch duplicates
  const espnIdGroups = {}
  
  for (const game of games) {
    const dateKey = new Date(game.date).toISOString().split('T')[0]
    const matchupKey = `${game.awayId}_${game.homeId}_${dateKey}`
    
    if (!matchupGroups[matchupKey]) {
      matchupGroups[matchupKey] = []
    }
    matchupGroups[matchupKey].push(game)
    
    // Also group by ESPN ID
    if (game.espnGameId) {
      if (!espnIdGroups[game.espnGameId]) {
        espnIdGroups[game.espnGameId] = []
      }
      espnIdGroups[game.espnGameId].push(game)
    }
  }
  
  // Find duplicates by matchup
  const duplicatesByMatchup = Object.entries(matchupGroups).filter(([_, games]) => games.length > 1)
  // Find duplicates by ESPN ID
  const duplicatesByEspnId = Object.entries(espnIdGroups).filter(([_, games]) => games.length > 1)
  
  console.log(`🔍 Duplicate check:`)
  console.log(`  By matchup: ${duplicatesByMatchup.length} groups`)
  console.log(`  By ESPN ID: ${duplicatesByEspnId.length} groups\n`)
  
  // Use ESPN ID duplicates if found, otherwise use matchup duplicates
  const duplicates = duplicatesByEspnId.length > 0 
    ? duplicatesByEspnId.map(([espnId, games]) => [`espn_${espnId}`, games])
    : duplicatesByMatchup
  
  if (duplicates.length === 0) {
    console.log('✅ No duplicate games found!')
    console.log('\n📋 All games found:')
    games.forEach(g => {
      const score = g.homeScore !== null && g.awayScore !== null 
        ? `${g.awayScore}-${g.homeScore}` 
        : 'No score'
      console.log(`  ${g.away.abbr} @ ${g.home.abbr} - ${score} (${g.status}) - ID: ${g.id}`)
      console.log(`    Date: ${g.date}`)
      console.log(`    ESPN ID: ${g.espnGameId || 'None'}`)
    })
    return
  }
  
  console.log(`⚠️  Found ${duplicates.length} duplicate game groups:\n`)
  
  let totalDeleted = 0
  
  for (const [key, gameGroup] of duplicates) {
    const game = gameGroup[0]
    console.log(`🔍 ${game.away.abbr} @ ${game.home.abbr} (${gameGroup.length} duplicates)`)
    
    // Score each game by data completeness
    const scoredGames = await Promise.all(gameGroup.map(async (g) => {
      let score = 0
      
      // Check for ESPN ID
      if (g.espnGameId) score += 10
      
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
      
      return { game: g, score }
    }))
    
    // Sort by score (highest first)
    scoredGames.sort((a, b) => b.score - a.score)
    
    const keepGame = scoredGames[0].game
    const deleteGames = scoredGames.slice(1).map(s => s.game)
    
    console.log(`   ✅ Keeping: ${keepGame.id} (score: ${scoredGames[0].score})`)
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
  console.log(`\n📊 Remaining games: ${games.length - totalDeleted}`)
}

fixDuplicates().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

