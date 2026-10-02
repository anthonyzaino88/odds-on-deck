#!/usr/bin/env node

/**
 * Master script to refresh all game data daily
 * Runs in the correct order to prevent duplicates and mapping issues
 * 
 * Usage:
 *   node scripts/refresh-all-data.js [sport]
 *   node scripts/refresh-all-data.js nhl
 *   node scripts/refresh-all-data.js all
 */

import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { config } from 'dotenv'
import { exec } from 'child_process'
import { promisify } from 'util'

config({ path: '.env.local' })

const execAsync = promisify(exec)

const supabase = createScriptSupabaseClient()

async function cleanupOldDuplicates(sport) {
  console.log(`\n🧹 Step 1: Cleaning up old duplicates for ${sport.toUpperCase()}...`)
  
  try {
    // Find duplicates by ESPN ID
    const { data: games, error } = await supabase
      .from('Game')
      .select('id, espnGameId, oddsApiEventId')
      .eq('sport', sport)
      .not('espnGameId', 'is', null)
      .order('espnGameId', { ascending: true })
    
    if (error) {
      console.warn(`  ⚠️  Could not query games: ${error.message}`)
      return
    }
    
    // Group by ESPN ID
    const byEspnId = {}
    games.forEach(g => {
      if (!byEspnId[g.espnGameId]) {
        byEspnId[g.espnGameId] = []
      }
      byEspnId[g.espnGameId].push(g)
    })
    
    // Find duplicates
    const duplicates = Object.keys(byEspnId).filter(id => byEspnId[id].length > 1)
    
    if (duplicates.length === 0) {
      console.log(`  ✅ No duplicates found`)
      return
    }
    
    console.log(`  📊 Found ${duplicates.length} ESPN IDs with duplicates`)
    
    const gamesToDelete = []
    
    duplicates.forEach(espnId => {
      const gameGroup = byEspnId[espnId]
      
      // Prioritize keeping the game that has odds mapped
      const withOdds = gameGroup.find(g => g.oddsApiEventId)
      const others = gameGroup.filter(g => g !== withOdds)
      
      if (withOdds) {
        // Keep the one with odds, delete others
        gamesToDelete.push(...others.map(g => g.id))
      } else {
        // If none have odds, keep the first one, delete rest
        gamesToDelete.push(...gameGroup.slice(1).map(g => g.id))
      }
    })
    
    if (gamesToDelete.length > 0) {
      console.log(`  🗑️  Deleting ${gamesToDelete.length} duplicate games...`)
      
      // First, check if any have odds - if so, we need to handle them differently
      const { data: gamesWithOdds } = await supabase
        .from('Game')
        .select('id')
        .in('id', gamesToDelete)
        .not('oddsApiEventId', 'is', null)
      
      if (gamesWithOdds && gamesWithOdds.length > 0) {
        console.log(`  ⚠️  ${gamesWithOdds.length} games have odds - skipping deletion (will be handled by fetch-fresh-games.js)`)
        // These will be handled by fetch-fresh-games.js which moves odds before deleting
        return
      }
      
      // Also check for games that might have Odds records (foreign key constraint)
      const { data: gamesWithOddsRecords } = await supabase
        .from('Odds')
        .select('gameId')
        .in('gameId', gamesToDelete)
        .limit(1)
      
      if (gamesWithOddsRecords && gamesWithOddsRecords.length > 0) {
        console.log(`  ⚠️  Some games have odds records - skipping deletion (will be handled by fetch-fresh-games.js)`)
        return
      }
      
      // Delete duplicates that don't have odds
      const { error: deleteError } = await supabase
        .from('Game')
        .delete()
        .in('id', gamesToDelete)
      
      if (deleteError) {
        console.warn(`  ⚠️  Error deleting duplicates: ${deleteError.message}`)
      } else {
        console.log(`  ✅ Deleted ${gamesToDelete.length} duplicate games`)
      }
    }
  } catch (error) {
    console.error(`  ❌ Error cleaning duplicates: ${error.message}`)
  }
}

async function runScript(scriptPath, args = []) {
  const command = `node ${scriptPath} ${args.join(' ')}`
  console.log(`\n📡 Running: ${command}`)
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      env: process.env
    })
    
    if (stdout) {
      console.log(stdout)
    }
    if (stderr) {
      console.error(stderr)
    }
    
    return { success: true }
  } catch (error) {
    console.error(`  ❌ Error running script: ${error.message}`)
    if (error.stdout) console.log(error.stdout)
    if (error.stderr) console.error(error.stderr)
    return { success: false, error }
  }
}

async function refreshSport(sport) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🔄 REFRESHING ${sport.toUpperCase()} DATA`)
  console.log(`${'='.repeat(60)}`)
  
  // Step 1: Clean up old duplicates
  await cleanupOldDuplicates(sport)
  
  // Step 2: Fetch fresh games from ESPN (with duplicate prevention)
  console.log(`\n📥 Step 2: Fetching fresh games from ESPN...`)
  const fetchResult = await runScript('scripts/fetch-fresh-games.js', [sport])
  
  if (!fetchResult.success) {
    console.error(`\n❌ Failed to fetch fresh games for ${sport}`)
    return false
  }
  
  // Step 3: Map and save odds
  console.log(`\n💰 Step 3: Fetching and mapping odds...`)
  const oddsResult = await runScript('scripts/fetch-live-odds.js', [sport, '--cache-fresh'])
  
  if (!oddsResult.success) {
    console.warn(`\n⚠️  Failed to fetch odds for ${sport} (continuing anyway)`)
  }
  
  // Step 4: Verify results
  console.log(`\n✅ Step 4: Verifying results...`)
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, espnGameId, oddsApiEventId')
    .eq('sport', sport)
    .gte('date', new Date().toISOString().split('T')[0])
  
  if (!error && games) {
    const totalGames = games.length
    const withOdds = games.filter(g => g.oddsApiEventId).length
    const duplicates = games.filter((g, i, arr) => 
      arr.findIndex(gg => gg.espnGameId === g.espnGameId) !== i
    ).length
    
    console.log(`  📊 Total games: ${totalGames}`)
    console.log(`  💰 Games with odds: ${withOdds} (${Math.round(withOdds / totalGames * 100)}%)`)
    console.log(`  🔄 Potential duplicates: ${duplicates}`)
    
    if (duplicates > 0) {
      console.warn(`  ⚠️  Warning: ${duplicates} potential duplicates detected`)
    }
  }
  
  return true
}

async function main() {
  const sport = process.argv[2]?.toLowerCase() || 'all'
  
  console.log('🎯 DAILY DATA REFRESH')
  console.log('='.repeat(60))
  console.log(`📅 Date: ${new Date().toLocaleDateString()}`)
  console.log(`🏀 Sports: ${sport === 'all' ? 'NHL, NFL' : sport.toUpperCase()}`)
  console.log('='.repeat(60))
  
  const startTime = Date.now()
  
  if (sport === 'all') {
    // Refresh NHL
    await refreshSport('nhl')
    
    // Refresh NFL
    await refreshSport('nfl')
  } else {
    await refreshSport(sport)
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n${'='.repeat(60)}`)
  console.log(`✅ Refresh complete! (${duration}s)`)
  console.log(`${'='.repeat(60)}\n`)
}

main().catch(console.error)

