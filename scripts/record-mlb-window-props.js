#!/usr/bin/env node
/**
 * Record MLB Published props (and Featured, if a 3-leg card clears)
 * only inside the 90-minute pre-first-pitch window, after the player
 * is in a confirmed batting order or is the confirmed probable /
 * starting pitcher. Never after first pitch.
 *
 * Does not call The Odds API. Uses MLB Stats API + ESPN (free).
 *
 * Schedule this on the ops laptop at about :16 ET (or later), hourly.
 * The :09 ET job must not write during :05–:15 — this script no-ops
 * in that window and exits 0.
 *
 *   node scripts/record-mlb-window-props.js
 *   npm run record:mlb-window
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { isPublishedEligibleProp } from '../lib/published-picks.js'
import {
  MLB_RECORD_WINDOW_MINUTES,
  hasMlbGameStarted,
  isInMlbRecordWindow,
  isOpsWriteQuietPeriod,
  mlbPublishedRecordDecision,
} from '../lib/mlb-recording-window.js'
import { fetchMlbConfirmedLineup } from '../lib/mlb-confirmed-lineup.js'

config({ path: '.env.local' })

const GAME_SELECT = 'id, sport, date, status, mlbGameId, espnGameId'

export function parseRecordMlbWindowArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : []
  return {
    help: args.includes('--help') || args.includes('-h'),
    allowQuietPeriod: args.includes('--allow-quiet-period'),
  }
}

export async function runRecordMlbWindowProps({
  argv = process.argv.slice(2),
  createClient = createScriptSupabaseClient,
  now = new Date(),
  fetchLineup = fetchMlbConfirmedLineup,
  persistPublished,
  generateFeatured,
  persistFeatured,
  log = console,
} = {}) {
  const args = parseRecordMlbWindowArgs(argv)
  if (args.help) {
    log.log(`Usage: node scripts/record-mlb-window-props.js

Record lineup-confirmed MLB Published props in the ${MLB_RECORD_WINDOW_MINUTES}-minute
window before first pitch. Also tries Featured MLB if a 3-leg card clears.
Does not call The Odds API. No-ops during :05–:15 ET (exit 0).
Schedule hourly at :16 ET or later.`)
    return { exitCode: 0, saved: [], featured: [], skippedQuiet: false }
  }

  if (isOpsWriteQuietPeriod(now) && !args.allowQuietPeriod) {
    log.log('⏸️  Ops quiet period (:05–:15 ET) — no MLB recording writes.')
    log.log('   Re-run at :16 ET or later (or pass --allow-quiet-period in tests).')
    return { exitCode: 0, saved: [], featured: [], skippedQuiet: true }
  }

  const persistPublishedEligibleProps = persistPublished
    || (await import('../lib/validation.js')).persistPublishedEligibleProps
  const generateSimpleParlays = generateFeatured
    || (await import('../lib/simple-parlay-generator.js')).generateSimpleParlays
  const persistFeaturedClearedParlays = persistFeatured
    || (await import('../lib/featured-parlay-persist.js')).persistFeaturedClearedParlays

  const supabase = createClient()
  const { data: games, error: gameError } = await supabase
    .from('Game')
    .select(GAME_SELECT)
    .eq('sport', 'mlb')
    .gte('date', now.toISOString())

  if (gameError) {
    log.error(`❌ Game query failed: ${gameError.message}`)
    return { exitCode: 1, saved: [], featured: [], skippedQuiet: false }
  }

  const windowGames = (games || []).filter((game) => (
    !hasMlbGameStarted(game, now) && isInMlbRecordWindow(game, now)
  ))

  log.log('\n🧢 MLB LINEUP-WINDOW RECORD')
  log.log('='.repeat(60))
  log.log(`Now: ${now.toISOString()}`)
  log.log(`Window: ${MLB_RECORD_WINDOW_MINUTES} minutes before first pitch`)
  log.log(`MLB games not started: ${(games || []).length}`)
  log.log(`In recording window: ${windowGames.length}`)

  if (windowGames.length === 0) {
    log.log('✅ No MLB games in the recording window.')
    return { exitCode: 0, saved: [], featured: [], skippedQuiet: false, windowGames: [] }
  }

  const gamesById = new Map(windowGames.map((game) => [game.id, game]))
  const lineupsByGameId = new Map()

  for (const game of windowGames) {
    const lineup = await fetchLineup(game.mlbGameId, { espnGameId: game.espnGameId })
    lineupsByGameId.set(game.id, lineup)
    log.log(
      `  ${game.id}  batters=${lineup.batters?.length || 0}  `
      + `pitchers=${[
        ...(lineup.pitchers || []),
        lineup.probableHome,
        lineup.probableAway,
      ].filter(Boolean).length}`,
    )
  }

  const gameIds = windowGames.map((game) => game.id)
  const { data: cacheProps, error: cacheError } = await supabase
    .from('PlayerPropCache')
    .select('*')
    .eq('sport', 'mlb')
    .in('gameId', gameIds)
    .eq('isStale', false)
    .gt('edge', 0)
    .gte('qualityScore', 40)

  if (cacheError) {
    log.error(`❌ Cache query failed: ${cacheError.message}`)
    return { exitCode: 1, saved: [], featured: [], skippedQuiet: false, windowGames }
  }

  const mlbGate = { now, gamesById, lineupsByGameId }
  const eligible = (cacheProps || []).filter((prop) => isPublishedEligibleProp(prop))
  const recordable = eligible.filter((prop) => mlbPublishedRecordDecision(prop, mlbGate).record)

  log.log(`Cache Published-eligible: ${eligible.length}`)
  log.log(`Lineup-confirmed in window: ${recordable.length}`)

  const saved = await persistPublishedEligibleProps(recordable, { mlbGate })
  log.log(`📌 Published MLB: recorded ${saved.length}`)

  const featured = []
  for (const type of ['single_game', 'multi_game']) {
    const parlays = await generateSimpleParlays({
      sport: 'mlb',
      type,
      featured: true,
      maxParlays: 1,
      legCount: 3,
    })
    if (!parlays.length) {
      log.log(`✅ Featured MLB ${type}: empty (no 3 confirmed legs)`)
      continue
    }
    const results = await persistFeaturedClearedParlays(parlays, { now, mlbGate })
    for (const result of results) {
      featured.push(result)
      log.log(
        `📌 Featured MLB ${type}: ${result.reason}${result.parlay?.id ? ` (${result.parlay.id})` : ''}`,
      )
    }
  }

  return {
    exitCode: 0,
    saved,
    featured,
    skippedQuiet: false,
    windowGames,
    recordable,
  }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runRecordMlbWindowProps().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('❌ record-mlb-window-props failed:', error)
    process.exit(1)
  })
}
