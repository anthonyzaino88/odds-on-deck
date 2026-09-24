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
  reconcileMlbAndEspnStatus,
  resolveMlbStatusForUpdate,
  shouldConfirmMlbFinalWithEspn,
} from '../lib/mlb-live-status.js'

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

function isLiveStatus(status) {
  const value = String(status || '').toLowerCase()
  return value.includes('progress') || value === 'halftime' || value.includes('delay')
}

function formatMatchup(game, awayScore, homeScore) {
  const away = game.away?.abbr || '?'
  const home = game.home?.abbr || '?'
  return `${away} ${awayScore ?? 0} @ ${home} ${homeScore ?? 0}`
}

function formatLiveDetail(sport, liveData, status) {
  const parts = [status]
  if (sport === 'mlb' && liveData?.inning) {
    const half = liveData.inningHalf ? `${liveData.inningHalf} ` : ''
    parts.push(`${half}${liveData.inning}`.trim())
  } else if (sport === 'nhl' && liveData?.period) {
    parts.push(liveData.periodDescriptor || `P${liveData.period}${liveData.clock ? ` ${liveData.clock}` : ''}`)
  } else if (liveData?.lastPlay) {
    parts.push(liveData.lastPlay)
  }
  return parts.filter(Boolean).join(' · ')
}

function printScoreRecap({ live, changes, totalUpdated, totalErrors, duration }) {
  console.log('\n----- SCORE RECAP -----')
  console.log(`Ran at: ${new Date().toISOString()}`)
  console.log(`Rows written: ${totalUpdated}  Errors: ${totalErrors}  Duration: ${duration}s`)

  console.log('\nLIVE GAMES:')
  if (!live.length) {
    console.log('  None in progress')
  } else {
    for (const game of live) {
      console.log(`  ${game.sport.toUpperCase()}  ${game.line}`)
    }
  }

  console.log('\nWHAT CHANGED:')
  if (!changes.length) {
    console.log('  No score or status changes this run')
  } else {
    for (const change of changes) {
      console.log(`  ${change.sport.toUpperCase()}  ${change.line}`)
    }
  }
  console.log('----- END RECAP -----\n')
}

const GAME_SELECT =
  'id, espnGameId, mlbGameId, homeId, awayId, homeScore, awayScore, status, date, lastUpdate, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)'

async function fetchGamesForSport(sport) {
  // Only look at games from the last 3 days (not ancient scheduled games)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 3)

  const { data: activeGames, error } = await supabase
    .from('Game')
    .select(GAME_SELECT)
    .eq('sport', sport)
    .in('status', ['scheduled', 'in_progress', 'in-progress'])
    .gte('date', cutoff.toISOString())
    .order('date', { ascending: true })

  if (error) {
    return { games: [], error }
  }

  if (sport !== 'mlb') {
    return { games: activeGames || [], error: null }
  }

  // Sticky-final self-heal: recently finalized MLB rows can be false finals
  // (live 9th marked final). Re-check them for a short window so ESPN/live
  // payload can flip them back to in_progress.
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

  const games = mergeActiveAndRecentFinalGames(activeGames, recentFinals || [])
  const recheckCount = games.filter(g => g.status === 'final').length
  if (recheckCount) {
    console.log(`  🔁 Re-checking ${recheckCount} recently finalized MLB game(s) for false finals`)
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
  
  let updated = 0
  let errors = 0
  const live = []
  const changes = []
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
  
  for (const game of games) {
    try {
      console.log(`🔄 Updating ${game.away?.abbr || '?'} @ ${game.home?.abbr || '?'}...`)
      
      let liveData = null
      
      if (sport === 'nhl' && game.espnGameId) {
        liveData = await fetchNHLGameDetail(game.espnGameId)
      } else if (sport === 'nfl' && game.espnGameId) {
        liveData = await fetchNFLGameDetail(game.espnGameId)
      } else if (sport === 'mlb') {
        // Prefer the one-call-per-date schedule map; per-gamePk schedule
        // still has status if the range fetch missed this row.
        if (game.mlbGameId && mlbLiveByPk) {
          liveData = mlbLiveByPk.get(String(game.mlbGameId)) || null
        }
        if (!liveData && game.mlbGameId) {
          liveData = await fetchLiveGameData(game.mlbGameId, true)
        }
        // ESPN when: no MLB data, MLB still "scheduled" after start,
        // status unknown, inning >= 9, or MLB says final.
        const gameStarted = new Date(game.date) < Date.now()
        const mlbStillScheduled = liveData && liveData.status === 'scheduled' && gameStarted
        const needsEspn = game.espnGameId && (
          !liveData || mlbStillScheduled || shouldConfirmMlbFinalWithEspn(liveData)
        )
        if (needsEspn) {
          const espnData = await fetchMLBFromESPN(game.espnGameId)
          if (!liveData) {
            if (espnData && (espnData.status === 'final' || espnData.status === 'in_progress' || espnData.homeScore > 0 || espnData.awayScore > 0)) {
              liveData = espnData
            }
          } else {
            const previousStatus = liveData.status
            liveData = reconcileMlbAndEspnStatus(liveData, espnData)
            if (previousStatus === 'final' && liveData?.status === 'in_progress') {
              console.log(`  ℹ️  MLB API said final but ESPN/live payload is in_progress — keeping in_progress`)
            } else if (previousStatus !== 'final' && liveData?.status === 'final' && liveData?.source === 'espn-upgrade') {
              console.log(`  ℹ️  ESPN STATUS_FINAL/completed — marking final`)
            } else if (mlbStillScheduled && espnData) {
              console.log(`  ℹ️  MLB API said scheduled but ESPN says ${espnData.status} — using ESPN`)
            }
          }
        } else if (liveData?.status === 'final') {
          liveData = reconcileMlbAndEspnStatus(liveData, null)
        }
        if (liveData) {
          liveData = {
            ...liveData,
            status: resolveMlbStatusForUpdate(liveData, game.status),
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
          changes.push({
            sport,
            line: `${formatMatchup(game, game.awayScore, game.homeScore)}  scheduled → final (stale, no live data)`
          })
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

        const prevAway = game.awayScore ?? 0
        const prevHome = game.homeScore ?? 0
        const prevStatus = normalizeStatus(game.status)
        const nextAway = updateData.awayScore ?? 0
        const nextHome = updateData.homeScore ?? 0
        const scoreOrStatusChanged =
          prevAway !== nextAway || prevHome !== nextHome || prevStatus !== resolvedStatus

        if (isLiveStatus(resolvedStatus)) {
          live.push({
            sport,
            line: `${formatMatchup(game, nextAway, nextHome)}  — ${formatLiveDetail(sport, liveData, resolvedStatus)}`
          })
        }

        if (scoreOrStatusChanged) {
          changes.push({
            sport,
            line: `${game.away?.abbr || '?'} @ ${game.home?.abbr || '?'}  ${prevAway}-${prevHome} ${prevStatus} → ${nextAway}-${nextHome} ${resolvedStatus}`
          })
        }
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
  
  return { updated, errors, live, changes }
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

