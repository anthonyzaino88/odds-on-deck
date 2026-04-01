#!/usr/bin/env node

/**
 * Safe Score Update Script
 * 
 * Updates scores for all active games without breaking existing functionality
 * 
 * Features:
 * - Uses ESPN ID to find correct game (handles duplicates)
 * - Only updates scores/status, preserves all other data
 * - Safe error handling (won't break if API fails)
 * - Supports all sports: NHL, NFL, MLB
 * 
 * Usage:
 *   node scripts/update-scores-safely.js [sport]
 *   node scripts/update-scores-safely.js nhl
 *   node scripts/update-scores-safely.js all
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fetchNHLGameDetail } from '../lib/vendors/nhl-stats.js'
import { fetchNFLGameDetail } from '../lib/vendors/nfl-stats.js'
import { fetchLiveGameData } from '../lib/vendors/stats.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

/**
 * Fetch MLB game status from ESPN as fallback when mlbGameId is missing
 */
async function fetchMLBFromESPN(espnGameId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${espnGameId}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    
    const competition = data.header?.competitions?.[0]
    if (!competition) return null
    
    const competitors = competition.competitors || []
    const home = competitors.find(c => c.homeAway === 'home')
    const away = competitors.find(c => c.homeAway === 'away')
    
    const statusType = competition.status?.type?.name || ''
    let status = 'scheduled'
    if (statusType === 'STATUS_FINAL' || competition.status?.type?.completed) status = 'final'
    else if (statusType === 'STATUS_IN_PROGRESS' || statusType === 'STATUS_RAIN_DELAY') status = 'in_progress'
    
    return {
      homeScore: parseInt(home?.score) || 0,
      awayScore: parseInt(away?.score) || 0,
      status,
      inning: competition.status?.period || null,
      inningHalf: competition.status?.type?.shortDetail?.includes('Top') ? 'Top' : 
                  competition.status?.type?.shortDetail?.includes('Bot') ? 'Bottom' : null
    }
  } catch (err) {
    console.error(`  ❌ ESPN fallback error: ${err.message}`)
    return null
  }
}

/**
 * Map ESPN status to our clean format (removes status_ prefix)
 */
function normalizeStatus(status) {
  if (!status) return 'scheduled'
  
  // If it's already clean, return as-is
  if (typeof status === 'string' && !status.toLowerCase().startsWith('status_')) {
    return status
  }
  
  // Remove status_ prefix and normalize
  let cleanStatus = status.toLowerCase().replace(/^status_/i, '')
  
  // Map common variations
  const statusMap = {
    'in_progress': 'in_progress',
    'in-progress': 'in_progress',
    'scheduled': 'scheduled',
    'final': 'final',
    'halftime': 'halftime',
    'postponed': 'postponed',
    'delayed': 'delayed'
  }
  
  return statusMap[cleanStatus] || cleanStatus
}

async function updateScoresForSport(sport) {
  console.log(`\n🔄 Updating ${sport.toUpperCase()} scores...\n`)
  
  // Only look at games from the last 3 days (not ancient scheduled games)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 3)
  
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, espnGameId, mlbGameId, homeId, awayId, homeScore, awayScore, status, date, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', sport)
    .in('status', ['scheduled', 'in_progress', 'in-progress'])
    .gte('date', cutoff.toISOString())
    .order('date', { ascending: true })
  
  if (error) {
    console.error(`❌ Error fetching ${sport} games:`, error.message)
    return { updated: 0, errors: 1 }
  }
  
  if (!games || games.length === 0) {
    console.log(`ℹ️  No active ${sport.toUpperCase()} games found (last 3 days)`)
    return { updated: 0, errors: 0 }
  }
  
  console.log(`📊 Found ${games.length} active ${sport.toUpperCase()} games\n`)
  
  let updated = 0
  let errors = 0
  
  for (const game of games) {
    try {
      console.log(`🔄 Updating ${game.away?.abbr || '?'} @ ${game.home?.abbr || '?'}...`)
      
      let liveData = null
      
      if (sport === 'nhl' && game.espnGameId) {
        liveData = await fetchNHLGameDetail(game.espnGameId)
      } else if (sport === 'nfl' && game.espnGameId) {
        liveData = await fetchNFLGameDetail(game.espnGameId)
      } else if (sport === 'mlb') {
        // Try MLB Stats API first, fall back to ESPN
        if (game.mlbGameId) {
          liveData = await fetchLiveGameData(game.mlbGameId, true)
        }
        // Fall back to ESPN if MLB API returned no data, or if it says
        // "scheduled" but the game should have already started (wrong gamePk)
        const gameStarted = new Date(game.date) < Date.now()
        const mlbStillScheduled = liveData && liveData.status === 'scheduled' && gameStarted
        if ((!liveData || mlbStillScheduled) && game.espnGameId) {
          const espnData = await fetchMLBFromESPN(game.espnGameId)
          if (espnData && (espnData.status === 'final' || espnData.homeScore > 0 || espnData.awayScore > 0)) {
            liveData = espnData
            if (mlbStillScheduled) {
              console.log(`  ℹ️  MLB API said scheduled but ESPN says ${espnData.status} — using ESPN`)
            }
          }
        }
      }
      
      if (!liveData) {
        // If game is >24h old and still scheduled, mark as final (game likely happened)
        const gameAge = (Date.now() - new Date(game.date).getTime()) / (1000 * 60 * 60)
        if (gameAge > 24 && game.status === 'scheduled') {
          console.log(`  ⏰ Game is ${Math.round(gameAge)}h old with no data — marking as final`)
          await supabase.from('Game').update({ status: 'final', lastUpdate: new Date().toISOString() }).eq('id', game.id)
          updated++
        } else {
          console.log(`  ⚠️  No live data available`)
        }
        continue
      }
      
      // Guard: don't mark future games as in_progress if score is still 0-0
      let resolvedStatus = normalizeStatus(liveData.status)
      const gameStart = new Date(game.date)
      const minutesUntilStart = (gameStart - Date.now()) / (1000 * 60)
      
      if (resolvedStatus === 'in_progress' && minutesUntilStart > 10 &&
          (liveData.homeScore || 0) === 0 && (liveData.awayScore || 0) === 0) {
        console.log(`  ⏳ Game hasn't started yet (starts in ${Math.round(minutesUntilStart)} min) — keeping scheduled`)
        resolvedStatus = 'scheduled'
      }
      
      const updateData = {
        homeScore: liveData.homeScore ?? game.homeScore,
        awayScore: liveData.awayScore ?? game.awayScore,
        status: resolvedStatus,
        lastUpdate: new Date().toISOString()
      }
      
      // Add sport-specific fields
      if (sport === 'nhl' && liveData.period) {
        updateData.lastPlay = liveData.periodDescriptor || 
          `Period ${liveData.period}${liveData.clock ? ` - ${liveData.clock}` : ''}`
      } else if (sport === 'mlb' && liveData.inning) {
        updateData.inning = liveData.inning
        updateData.inningHalf = liveData.inningHalf
        updateData.outs = liveData.outs
        updateData.balls = liveData.balls
        updateData.strikes = liveData.strikes
        updateData.lastPlay = liveData.lastPlay
      }
      
      // Find the correct game to update (handles duplicates)
      // Use ESPN ID to find the game, prioritizing the one with odds
      let targetGameId = game.id
      
      if (game.espnGameId) {
        const { data: duplicates } = await supabase
          .from('Game')
          .select('id, oddsApiEventId')
          .eq('espnGameId', game.espnGameId)
          .eq('sport', sport)
        
        if (duplicates && duplicates.length > 1) {
          // If duplicates exist, update the one with odds
          const withOdds = duplicates.find(g => g.oddsApiEventId)
          if (withOdds) {
            targetGameId = withOdds.id
            console.log(`  ℹ️  Multiple games with same ESPN ID, updating game with odds: ${targetGameId}`)
          }
        }
      }
      
      // Update the game - only update specific fields, preserve everything else
      const { error: updateError } = await supabase
        .from('Game')
        .update(updateData)
        .eq('id', targetGameId)
      
      if (updateError) {
        console.error(`  ❌ Update error: ${updateError.message}`)
        errors++
      } else {
        const scoreDisplay = `${updateData.awayScore ?? 0}-${updateData.homeScore ?? 0}`
        const statusDisplay = updateData.status
        console.log(`  ✅ Updated: ${scoreDisplay} - Status: ${statusDisplay}`)
        updated++
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300))
      
    } catch (error) {
      console.error(`  ❌ Error updating ${game.away.abbr} @ ${game.home.abbr}:`, error.message)
      errors++
    }
  }
  
  console.log(`\n📊 ${sport.toUpperCase()} Summary:`)
  console.log(`  ✅ Updated: ${updated}`)
  console.log(`  ❌ Errors: ${errors}`)
  console.log(`  📋 Total: ${games.length}`)
  
  return { updated, errors }
}

async function main() {
  const sport = process.argv[2]?.toLowerCase() || 'all'
  
  console.log('📊 SAFE SCORE UPDATE')
  console.log('='.repeat(60))
  console.log(`📅 Date: ${new Date().toLocaleDateString()}`)
  console.log(`🏀 Sports: ${sport === 'all' ? 'NHL, NFL, MLB' : sport.toUpperCase()}`)
  console.log('='.repeat(60))
  
  const startTime = Date.now()
  
  let totalUpdated = 0
  let totalErrors = 0
  
  if (sport === 'all') {
    // Update NHL
    const nhlResult = await updateScoresForSport('nhl')
    totalUpdated += nhlResult.updated
    totalErrors += nhlResult.errors
    
    // Update NFL
    const nflResult = await updateScoresForSport('nfl')
    totalUpdated += nflResult.updated
    totalErrors += nflResult.errors
    
    // Update MLB
    const mlbResult = await updateScoresForSport('mlb')
    totalUpdated += mlbResult.updated
    totalErrors += mlbResult.errors
  } else {
    const result = await updateScoresForSport(sport)
    totalUpdated += result.updated
    totalErrors += result.errors
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`✅ Score update complete! (${duration}s)`)
  console.log(`  📊 Total updated: ${totalUpdated}`)
  console.log(`  ❌ Total errors: ${totalErrors}`)
  console.log(`${'='.repeat(60)}\n`)
}

main().catch(console.error)

