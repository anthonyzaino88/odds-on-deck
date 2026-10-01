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
 * - MLB: one schedule?hydrate=linescore call per date range (status + linescore)
 * - MLB: never treat a live 9th as final; missing status is unknown
 * - MLB: confirm finals / 9th+ / unknown with ESPN; ESPN may upgrade to
 *   final only when STATUS_FINAL and completed=true
 * - MLB: re-check games marked final in the last 4 hours so sticky false
 *   finals can self-heal back to in_progress (real Final/F must stay final)
 * - MLB: re-check postponed / suspended rows that have a gamePk for ~7
 *   days so a makeup under the same gamePk can flip to final
 * - MLB: keep selecting pre_game / warmup / delayed (and aliases) so a
 *   hydrate-status write cannot freeze the row at 0-0
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
import { fetchLiveGameData, fetchLiveGamesByDateRange, mlbScheduleDateWindow } from '../lib/vendors/stats.js'
import {
  RECENT_MLB_FINAL_RECHECK_MS,
  mergeActiveAndRecentFinalGames,
  parseEspnMlbSummary,
} from '../lib/mlb-live-status.js'
import {
  GAME_SELECT,
  fetchActiveGamesForSport,
  fetchMlbResumeGames,
  mergeGameLists,
  printScoreRecap,
  refreshGameScores,
} from '../lib/score-updater.js'

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
    return parseEspnMlbSummary(data)
  } catch (err) {
    console.error(`  ❌ ESPN fallback error: ${err.message}`)
    return null
  }
}

async function fetchGamesForSport(sport) {
  const { games: activeGames, error } = await fetchActiveGamesForSport(supabase, sport)

  if (error) {
    return { games: [], error }
  }

  if (sport !== 'mlb') {
    return { games: activeGames || [], error: null }
  }

  // Sticky-final self-heal: recently finalized MLB rows can be false finals
  // (live 9th marked final). Re-check them for a short window so ESPN/live
  // payload can flip them back to in_progress.
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 3)
  const recheckAfter = new Date(Date.now() - RECENT_MLB_FINAL_RECHECK_MS).toISOString()
  const { data: recentFinals, error: finalsError } = await supabase
    .from('Game')
    .select(GAME_SELECT)
    .eq('sport', 'mlb')
    .eq('status', 'final')
    .gte('date', cutoff.toISOString())
    .gte('lastUpdate', recheckAfter)

  if (finalsError) {
    console.warn(`  ⚠️  Recent-final recheck query failed: ${finalsError.message}`)
  }

  const { games: resumeGames, error: resumeError } = await fetchMlbResumeGames(supabase)
  if (resumeError) {
    console.warn(`  ⚠️  Postponed/suspended recheck query failed: ${resumeError.message}`)
  }

  const games = mergeGameLists(
    mergeActiveAndRecentFinalGames(activeGames, recentFinals || []),
    resumeGames || [],
  )
  const recheckCount = games.filter(g => g.status === 'final').length
  const resumeCount = games.filter(g => g.status === 'postponed' || g.status === 'suspended').length
  if (recheckCount) {
    console.log(`  🔁 Re-checking ${recheckCount} recently finalized MLB game(s) for false finals`)
  }
  if (resumeCount) {
    console.log(`  🔁 Re-checking ${resumeCount} postponed/suspended MLB game(s) for makeup finals`)
  }

  return { games, error: null }
}

async function updateScoresForSport(sport) {
  console.log(`\n🔄 Updating ${sport.toUpperCase()} scores...\n`)
  
  const { games, error } = await fetchGamesForSport(sport)
  
  if (error) {
    console.error(`❌ Error fetching ${sport} games:`, error.message)
    return { updated: 0, errors: 1, live: [], changes: [] }
  }
  
  if (!games || games.length === 0) {
    console.log(`ℹ️  No active ${sport.toUpperCase()} games found (last 3 days)`)
    return { updated: 0, errors: 0, live: [], changes: [] }
  }
  
  console.log(`📊 Found ${games.length} ${sport.toUpperCase()} game(s) to refresh\n`)
  
  let mlbLiveByPk = null

  if (sport === 'mlb') {
    const window = mlbScheduleDateWindow(games)
    if (window) {
      try {
        mlbLiveByPk = await fetchLiveGamesByDateRange(window.startDate, window.endDate, true)
        console.log(`📡 MLB schedule hydrate ${window.startDate}..${window.endDate}: ${mlbLiveByPk.size} game(s)\n`)
      } catch (err) {
        console.warn(`  ⚠️  Hydrated schedule fetch failed (${err.message}); falling back to per-gamePk schedule`)
      }
    }
  }

  const result = await refreshGameScores({
    sport,
    games,
    supabase,
    apply: true,
    mlbLiveByPk,
    fetchLiveGameData,
    fetchNHLGameDetail,
    fetchNFLGameDetail,
    fetchEspnMlb: fetchMLBFromESPN,
  })
  
  console.log(`\n📊 ${sport.toUpperCase()} Summary:`)
  console.log(`  ✅ Updated: ${result.updated}`)
  console.log(`  ❌ Errors: ${result.errors}`)
  console.log(`  📋 Total: ${games.length}`)
  
  return result
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
  const live = []
  const changes = []

  const sports = sport === 'all' ? ['nhl', 'nfl', 'mlb'] : [sport]
  for (const nextSport of sports) {
    const result = await updateScoresForSport(nextSport)
    totalUpdated += result.updated
    totalErrors += result.errors
    live.push(...result.live)
    changes.push(...result.changes)
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`✅ Score update complete! (${duration}s)`)
  console.log(`  📊 Total updated: ${totalUpdated}`)
  console.log(`  ❌ Total errors: ${totalErrors}`)
  console.log(`${'='.repeat(60)}\n`)

  printScoreRecap({ live, changes, totalUpdated, totalErrors, duration })
}

main().catch(console.error)
