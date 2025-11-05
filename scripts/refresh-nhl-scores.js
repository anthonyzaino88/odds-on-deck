#!/usr/bin/env node

/**
 * Refresh NHL Live Scores
 * 
 * Fetches live scores for all active NHL games and updates the database
 * 
 * Usage:
 *   node scripts/refresh-nhl-scores.js
 */

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { fetchNHLGameDetail } from '../lib/vendors/nhl-stats.js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function refreshNHLScores() {
  console.log('🏒 Refreshing NHL Live Scores...\n')
  
  // Get all active NHL games
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, espnGameId, homeId, awayId, homeScore, awayScore, status, date, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
    .in('status', ['scheduled', 'in_progress'])
    .not('espnGameId', 'is', null)
    .order('date', { ascending: true })
  
  if (error) {
    console.error('❌ Error fetching games:', error)
    return
  }
  
  if (!games || games.length === 0) {
    console.log('ℹ️  No active NHL games found')
    return
  }
  
  console.log(`📊 Found ${games.length} active NHL games\n`)
  
  let updated = 0
  let errors = 0
  
  for (const game of games) {
    try {
      console.log(`🔄 Updating ${game.away.abbr} @ ${game.home.abbr}...`)
      
      // Fetch live data from ESPN
      const liveData = await fetchNHLGameDetail(game.espnGameId)
      
      if (!liveData) {
        console.log(`  ⚠️  No live data available`)
        continue
      }
      
      // Update game in database
      const updateData = {
        homeScore: liveData.homeScore,
        awayScore: liveData.awayScore,
        status: liveData.status,
        lastUpdate: new Date().toISOString()
      }
      
      // Add period info to lastPlay if available
      if (liveData.period) {
        const periodInfo = liveData.periodDescriptor || 
          `Period ${liveData.period}${liveData.clock ? ` - ${liveData.clock}` : ''}`
        updateData.lastPlay = periodInfo
      }
      
      const { error: updateError } = await supabase
        .from('Game')
        .update(updateData)
        .eq('id', game.id)
      
      if (updateError) {
        console.error(`  ❌ Update error: ${updateError.message}`)
        errors++
      } else {
        const scoreDisplay = `${liveData.awayScore || 0}-${liveData.homeScore || 0}`
        const periodDisplay = liveData.period ? ` (${liveData.periodDescriptor || `P${liveData.period}`})` : ''
        console.log(`  ✅ Updated: ${scoreDisplay}${periodDisplay} - Status: ${liveData.status}`)
        updated++
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300))
      
    } catch (error) {
      console.error(`  ❌ Error updating ${game.away.abbr} @ ${game.home.abbr}:`, error.message)
      errors++
    }
  }
  
  console.log(`\n📊 Summary:`)
  console.log(`  ✅ Updated: ${updated}`)
  console.log(`  ❌ Errors: ${errors}`)
  console.log(`  📋 Total: ${games.length}`)
}

refreshNHLScores().catch(console.error)

