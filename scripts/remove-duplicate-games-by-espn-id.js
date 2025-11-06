#!/usr/bin/env node

/**
 * Remove duplicate games - keep the one with odds mapped, or the one with more data
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function removeDuplicates() {
  console.log('🔍 Finding and removing duplicate games...\n')
  
  // Get all NHL games
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, sport, date, espnGameId, homeId, awayId, oddsApiEventId, homeScore, awayScore')
    .eq('sport', 'nhl')
    .not('espnGameId', 'is', null)
    .order('espnGameId', { ascending: true })
    .order('date', { ascending: true })
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  // Group by ESPN ID
  const byEspnId = {}
  games.forEach(game => {
    if (!byEspnId[game.espnGameId]) {
      byEspnId[game.espnGameId] = []
    }
    byEspnId[game.espnGameId].push(game)
  })
  
  // Find duplicates
  const duplicates = []
  Object.keys(byEspnId).forEach(espnId => {
    if (byEspnId[espnId].length > 1) {
      duplicates.push({
        espnId,
        games: byEspnId[espnId]
      })
    }
  })
  
  console.log(`📊 Found ${duplicates.length} ESPN IDs with duplicates\n`)
  
  if (duplicates.length === 0) {
    console.log('✅ No duplicates found!')
    return
  }
  
  // For each duplicate, decide which to keep
  const toDelete = []
  const toKeep = []
  
  duplicates.forEach(dup => {
    // Priority: Keep the one with odds mapped
    const withOdds = dup.games.find(g => g.oddsApiEventId)
    if (withOdds) {
      toKeep.push(withOdds)
      dup.games.forEach(g => {
        if (g.id !== withOdds.id) {
          toDelete.push(g)
        }
      })
      return
    }
    
    // If none have odds, keep the one with scores or more data
    const withScores = dup.games.find(g => g.homeScore !== null || g.awayScore !== null)
    if (withScores) {
      toKeep.push(withScores)
      dup.games.forEach(g => {
        if (g.id !== withScores.id) {
          toDelete.push(g)
        }
      })
      return
    }
    
    // Otherwise, keep the first one (earliest date)
    toKeep.push(dup.games[0])
    dup.games.slice(1).forEach(g => {
      toDelete.push(g)
    })
  })
  
  console.log(`📋 Will keep ${toKeep.length} games`)
  console.log(`🗑️  Will delete ${toDelete.length} games\n`)
  
  if (toDelete.length === 0) {
    console.log('✅ No games to delete!')
    return
  }
  
  // Show what will be deleted
  console.log('📋 Games to delete:\n')
  toDelete.forEach((g, i) => {
    const dateStr = new Date(g.date).toISOString().split('T')[0]
    console.log(`${i + 1}. ${g.id} (date: ${dateStr}, ESPN: ${g.espnGameId})`)
  })
  
  // Ask for confirmation (in a real script you'd use readline)
  console.log('\n⚠️  About to delete these games. This cannot be undone!')
  console.log('   Run with --confirm to actually delete them.')
  
  if (process.argv.includes('--confirm')) {
    console.log('\n🗑️  Deleting games...')
    
    // Delete in batches
    const batchSize = 50
    let deleted = 0
    
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize)
      const ids = batch.map(g => g.id)
      
      const { error: deleteError } = await supabase
        .from('Game')
        .delete()
        .in('id', ids)
      
      if (deleteError) {
        console.error(`❌ Error deleting batch: ${deleteError.message}`)
      } else {
        deleted += batch.length
        console.log(`   Deleted ${deleted}/${toDelete.length} games...`)
      }
    }
    
    console.log(`\n✅ Successfully deleted ${deleted} duplicate games!`)
    console.log(`✅ Kept ${toKeep.length} unique games`)
  } else {
    console.log('\n💡 To actually delete, run: node scripts/remove-duplicate-games-by-espn-id.js --confirm')
  }
}

removeDuplicates().catch(console.error)

