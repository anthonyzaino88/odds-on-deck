#!/usr/bin/env node
/**
 * Record MLB Published props (and Featured, if a 3-leg card clears)
 * only inside the 90-minute pre-first-pitch window, after the player
 * is in a confirmed batting order or is the confirmed probable /
 * starting pitcher. Never after first pitch.
 *
 * Does not call The Odds API. Uses MLB Stats API + ESPN (free).
 *
 * Schedule on the ops laptop at :16 and :46 ET, hours 11–22 ET
 * (regular season) or 12–22 ET (postseason, pass --postseason).
 * The :09 ET job must not write during :05–:15 — this script no-ops
 * in that window and exits 0.
 *
 *   node scripts/record-mlb-window-props.js
 *   node scripts/record-mlb-window-props.js --postseason
 *   npm run record:mlb-window
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { isPublishedEligibleProp } from '../lib/published-picks.js'
import {
  MLB_RECORD_HOUR_END,
  MLB_RECORD_HOUR_START,
  MLB_RECORD_HOUR_START_POSTSEASON,
  MLB_RECORD_WINDOW_MINUTES,
  buildMlbFeaturedRequests,
  findMlbDoubleheaderIds,
  hasMlbGameStarted,
  isInMlbRecordWindow,
  isMlbRecordingClockHour,
  isOpsWriteQuietPeriod,
  mlbPublishedRecordDecision,
} from '../lib/mlb-recording-window.js'
import { fetchMlbConfirmedLineup, isMlbStatsDoubleheader } from '../lib/mlb-confirmed-lineup.js'

config({ path: '.env.local' })

const GAME_SELECT = 'id, sport, date, status, mlbGameId, espnGameId, homeId, awayId'

export function parseRecordMlbWindowArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : []
  return {
    help: args.includes('--help') || args.includes('-h'),
    postseason: args.includes('--postseason'),
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
  const hourStart = args.postseason ? MLB_RECORD_HOUR_START_POSTSEASON : MLB_RECORD_HOUR_START
  if (args.help) {
    log.log(`Usage: node scripts/record-mlb-window-props.js [--postseason]

Record lineup-confirmed MLB Published props in the ${MLB_RECORD_WINDOW_MINUTES}-minute
window before first pitch. Featured: one single-game card per in-window
gameId; multi-game legs stay inside those games.
Does not call The Odds API. No-ops during :05–:15 ET (exit 0).
Schedule at :16 and :46 ET, hours ${MLB_RECORD_HOUR_START}–${MLB_RECORD_HOUR_END} ET
(regular) or ${MLB_RECORD_HOUR_START_POSTSEASON}–${MLB_RECORD_HOUR_END} ET (--postseason).`)
    return { exitCode: 0, saved: [], featured: [], skippedQuiet: false }
  }

  if (isOpsWriteQuietPeriod(now)) {
    log.log('⏸️  Ops quiet period (:05–:15 ET) — no MLB recording writes.')
    log.log('   Re-run at :16 or :46 ET.')
    return { exitCode: 0, saved: [], featured: [], skippedQuiet: true }
  }

  if (!isMlbRecordingClockHour(now, { postseason: args.postseason })) {
    log.log(
      `⏸️  Outside MLB recording hours (${hourStart}–${MLB_RECORD_HOUR_END} ET`
      + `${args.postseason ? ', postseason' : ''}) — no writes.`,
    )
    return { exitCode: 0, saved: [], featured: [], skippedHours: true }
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

  const doubleheaderIds = findMlbDoubleheaderIds(games || [])
  const skippedDoubleheaders = (games || []).filter((game) => doubleheaderIds.has(game.id))
  if (skippedDoubleheaders.length) {
    log.log(
      `⚠️ Skipping same-day doubleheader(s) (shared away_at_home_date id / lineup): `
      + skippedDoubleheaders.map((game) => `${game.id} pk=${game.mlbGameId || '—'}`).join(', '),
    )
  }

  const windowGames = (games || []).filter((game) => (
    !doubleheaderIds.has(game.id)
    && !hasMlbGameStarted(game, now)
    && isInMlbRecordWindow(game, now)
  ))

  log.log('\n🧢 MLB LINEUP-WINDOW RECORD')
  log.log('='.repeat(60))
  log.log(`Now: ${now.toISOString()}`)
  log.log(`Window: ${MLB_RECORD_WINDOW_MINUTES} minutes before first pitch`)
  log.log(`Hours: ${hourStart}–${MLB_RECORD_HOUR_END} ET at :16 and :46`)
  log.log(`MLB games not started: ${(games || []).length}`)
  log.log(`Skipped doubleheaders: ${skippedDoubleheaders.length}`)
  log.log(`In recording window: ${windowGames.length}`)

  if (windowGames.length === 0) {
    log.log('✅ No MLB games in the recording window.')
    return {
      exitCode: 0,
      saved: [],
      featured: [],
      skippedQuiet: false,
      windowGames: [],
      skippedDoubleheaders,
    }
  }

  const gamesById = new Map()
  const lineupsByGameId = new Map()

  for (const game of windowGames) {
    const lineup = await fetchLineup(game.mlbGameId, { espnGameId: game.espnGameId })
    if (lineup.scheduleUnavailable) {
      log.log(`⚠️ Skipping ${game.id} StatsAPI schedule unavailable (fail closed)`)
      continue
    }
    if (isMlbStatsDoubleheader(lineup)) {
      skippedDoubleheaders.push(game)
      log.log(
        `⚠️ Skipping ${game.id} StatsAPI doubleHeader=${lineup.doubleHeader} `
        + `gameNumber=${lineup.gameNumber ?? '—'} (collapsed DH row)`,
      )
      continue
    }
    gamesById.set(game.id, game)
    lineupsByGameId.set(game.id, lineup)
    log.log(
      `  ${game.id}  pk=${game.mlbGameId || '—'}  batters=${lineup.batters?.length || 0}  `
      + `pitchers=${[
        ...(lineup.pitchers || []),
        lineup.probableHome,
        lineup.probableAway,
      ].filter(Boolean).length}`,
    )
  }

  const recordableGames = [...gamesById.values()]
  log.log(`Skipped doubleheaders: ${skippedDoubleheaders.length}`)
  if (recordableGames.length === 0) {
    log.log('✅ No MLB games in the recording window after doubleheader skip.')
    return {
      exitCode: 0,
      saved: [],
      featured: [],
      skippedQuiet: false,
      windowGames: [],
      skippedDoubleheaders,
    }
  }

  const gameIds = recordableGames.map((game) => game.id)
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

  const mlbGate = { now, gamesById, lineupsByGameId, postseason: args.postseason }
  const eligible = (cacheProps || []).filter((prop) => isPublishedEligibleProp(prop))
  const recordable = eligible.filter((prop) => mlbPublishedRecordDecision(prop, mlbGate).record)

  log.log(`Cache Published-eligible: ${eligible.length}`)
  log.log(`Lineup-confirmed in window: ${recordable.length}`)

  const saved = await persistPublishedEligibleProps(recordable, { mlbGate })
  log.log(`📌 Published MLB: recorded ${saved.length}`)

  const featured = []
  for (const request of buildMlbFeaturedRequests(recordableGames)) {
    const parlays = await generateSimpleParlays({
      sport: 'mlb',
      type: request.type,
      featured: true,
      maxParlays: 1,
      legCount: 3,
      gameId: request.gameId,
      gameIds: request.gameIds,
    })
    if (!parlays.length) {
      log.log(`✅ Featured MLB ${request.type}${request.gameId ? ` ${request.gameId}` : ''}: empty`)
      continue
    }
    const results = await persistFeaturedClearedParlays(parlays, { now, mlbGate })
    for (const result of results) {
      featured.push(result)
      log.log(
        `📌 Featured MLB ${request.type}${request.gameId ? ` ${request.gameId}` : ''}: `
        + `${result.reason}${result.parlay?.id ? ` (${result.parlay.id})` : ''}`,
      )
    }
  }

  return {
    exitCode: 0,
    saved,
    featured,
    skippedQuiet: false,
    windowGames: recordableGames,
    recordable,
    skippedDoubleheaders,
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
