#!/usr/bin/env node
/**
 * Capture the last available Published-pick price before first pitch.
 *
 * Quota-aware: one Odds API event-odds call per game that still has
 * Published picks without closeOdds, markets restricted to those picks.
 * Never re-runs morning fetch-live-odds.
 *
 *   node scripts/capture-published-closes.js            # dry-run (default)
 *   node scripts/capture-published-closes.js --dry-run
 *   node scripts/capture-published-closes.js --apply
 *
 * Schedule at :16 and :46 ET after record-mlb-window-props.
 * No-ops during :05–:15 ET. CLOSING_CAPTURE=0 disables.
 * Uses createScriptSupabaseClient. Do not run --apply from CI.
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { paginateSupabaseSelect } from '../lib/unplayed-game-grades.js'
import {
  PUBLISHED_STATS_PREFILTER,
  isPublishedEligibleProp,
  isPublishedTrackSource,
} from '../lib/published-picks.js'
import { isMissingColumnError } from '../lib/grade-audit.js'
import {
  CLOSE_CAPTURE_WINDOW_MINUTES,
  buildEventOddsUrl,
  closeCapturePayload,
  CLOSE_CAPTURE_DEFAULT_MIN_REMAINING,
  estimateCloseCaptureCost,
  flattenEventOddsQuotes,
  gameIsInCloseWindow,
  hasCloseAlready,
  isOpsWriteQuietPeriod,
  marketsForPublishedPicks,
  matchClosingQuote,
  oddsApiSportKey,
  parseOddsApiQuota,
  updateWithOptionalCloseOdds,
} from '../lib/closing-line.js'

config({ path: '.env.local' })

const GAME_SELECT = 'id, sport, date, status, oddsApiEventId'
export const PICK_SELECT_BASE = [
  'id', 'propId', 'gameIdRef', 'playerName', 'propType', 'threshold',
  'prediction', 'odds', 'edge', 'qualityScore', 'sport', 'source',
  'status',
].join(', ')
export const PICK_SELECT = `${PICK_SELECT_BASE}, closeOdds, closeCapturedAt`

function takeIntFlag(args, flag) {
  const i = args.indexOf(flag)
  if (i < 0 || !args[i + 1] || String(args[i + 1]).startsWith('--')) return null
  const n = Number(args[i + 1])
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function isClosingCaptureDisabled(env = process.env) {
  const raw = String(env.CLOSING_CAPTURE ?? '').trim().toLowerCase()
  return raw === '0' || raw === 'false' || raw === 'off'
}

export function parseCaptureClosesArgs(argv = [], env = process.env) {
  const args = Array.isArray(argv) ? argv : []
  const dryRunFlag = args.includes('--dry-run')
  const applyFlag = args.includes('--apply')
  const maxCalls = takeIntFlag(args, '--max-calls')
  const minRemaining = takeIntFlag(args, '--min-remaining')
    ?? Number(env.CLOSING_CAPTURE_MIN_REMAINING)
  return {
    apply: applyFlag && !dryRunFlag,
    dryRun: !applyFlag || dryRunFlag,
    help: args.includes('--help') || args.includes('-h'),
    maxCalls,
    minRemaining: Number.isFinite(minRemaining) && minRemaining >= 0
      ? minRemaining
      : CLOSE_CAPTURE_DEFAULT_MIN_REMAINING,
    disabled: isClosingCaptureDisabled(env),
  }
}

async function defaultFetchEventOdds({ url, fetchImpl = fetch }) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'OddsOnDeck/1.0' },
  })
  const quota = parseOddsApiQuota(response.headers)
  if (!response.ok) {
    const text = await response.text()
    const error = new Error(`Odds API ${response.status}: ${text}`)
    error.quota = quota
    throw error
  }
  return { data: await response.json(), quota }
}

export async function runCapturePublishedCloses({
  argv = process.argv.slice(2),
  createClient = createScriptSupabaseClient,
  now = new Date(),
  fetchEventOdds = defaultFetchEventOdds,
  apiKey = process.env.ODDS_API_KEY,
  env = process.env,
  log = console,
} = {}) {
  const args = parseCaptureClosesArgs(argv, env)
  if (args.help) {
    log.log(`Usage: node scripts/capture-published-closes.js [--dry-run|--apply] [--max-calls N] [--min-remaining N]

Dry-run (default): list in-window Published picks missing a close.
--apply: one Odds API call per game, write closeOdds. Requires
         ODDS_API_KEY + SUPABASE_SECRET_KEY. Do not run from CI.
CLOSING_CAPTURE=0 disables the job. --max-calls caps HTTP calls.
--min-remaining (default ${CLOSE_CAPTURE_DEFAULT_MIN_REMAINING}) stops when
Odds API remaining credits fall below the floor.
No-ops during :05–:15 ET. Schedule at :16 and :46 ET, after
record-mlb-window-props. London NFL 9:30 AM ET games are missed
if this job only runs in the 11–22 ET MLB window.`)
    return { exitCode: 0, updates: [], calls: 0 }
  }

  if (args.disabled) {
    log.log('⏸️  CLOSING_CAPTURE=0 — close capture disabled.')
    return { exitCode: 0, updates: [], calls: 0, skippedDisabled: true }
  }

  if (isOpsWriteQuietPeriod(now)) {
    log.log('⏸️  Ops quiet period (:05–:15 ET) — no close capture writes or Odds API calls.')
    return { exitCode: 0, updates: [], calls: 0, skippedQuiet: true }
  }

  const supabase = createClient()
  const horizon = new Date(now.getTime() + CLOSE_CAPTURE_WINDOW_MINUTES * 60 * 1000)

  const { data: games, error: gameError } = await supabase
    .from('Game')
    .select(GAME_SELECT)
    .in('sport', PUBLISHED_STATS_PREFILTER.sports)
    .gte('date', now.toISOString())
    .lte('date', horizon.toISOString())

  if (gameError) {
    log.error(`❌ Game query failed: ${gameError.message}`)
    return { exitCode: 1, updates: [], calls: 0 }
  }

  const windowGames = (games || []).filter((game) => gameIsInCloseWindow(game, now))
  const gamesById = new Map(windowGames.map((game) => [game.id, game]))

  async function loadPicks(select) {
    return paginateSupabaseSelect(() => supabase
      .from('PropValidation')
      .select(select)
      .eq('source', PUBLISHED_STATS_PREFILTER.source)
      .in('sport', PUBLISHED_STATS_PREFILTER.sports)
      .in('gameIdRef', windowGames.map((game) => game.id).concat(['__none__']))
      .gt('edge', PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
      .gte('qualityScore', PUBLISHED_STATS_PREFILTER.minQuality)
      .order('id', { ascending: true }))
  }

  let pickPage = await loadPicks(PICK_SELECT)
  let closeColumnsMissing = false
  if (pickPage.error && isMissingColumnError(pickPage.error)) {
    closeColumnsMissing = true
    log.log('⚠️ closeOdds columns not applied yet (run 007 SQL).')
    pickPage = await loadPicks(PICK_SELECT_BASE)
  }

  if (pickPage.error) {
    log.error(`❌ Pick query failed: ${pickPage.error.message}`)
    return { exitCode: 1, updates: [], calls: 0, closeColumnsMissing }
  }

  if (closeColumnsMissing && args.apply) {
    log.error('❌ --apply needs 007 SQL (closeOdds columns). Dry-run still works.')
    return { exitCode: 1, updates: [], calls: 0, closeColumnsMissing }
  }

  const openPicks = (pickPage.rows || []).filter((row) => (
    isPublishedTrackSource(row)
    && isPublishedEligibleProp(row)
    && !hasCloseAlready(row)
    && gamesById.has(row.gameIdRef)
  ))

  const byGame = new Map()
  for (const pick of openPicks) {
    const list = byGame.get(pick.gameIdRef) || []
    list.push(pick)
    byGame.set(pick.gameIdRef, list)
  }

  const marketCounts = [...byGame.values()].map((picks) => marketsForPublishedPicks(picks).length)
  const cost = estimateCloseCaptureCost({ gameCount: byGame.size, marketCounts })

  log.log('\n📸 PUBLISHED CLOSE CAPTURE')
  log.log('='.repeat(60))
  log.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN (default)'}`)
  log.log(`Window: ${CLOSE_CAPTURE_WINDOW_MINUTES} minutes before first pitch`)
  log.log(`Games in window: ${windowGames.length}`)
  log.log(`Published picks missing close: ${openPicks.length}`)
  log.log(`Odds API HTTP calls this run: ${cost.httpCalls}`)
  log.log(`Odds API credits this run: ${cost.credits} (markets × regions=${cost.regions})`)
  log.log(cost.note)

  if (byGame.size === 0) {
    log.log('✅ Nothing to capture.')
    return { exitCode: 0, updates: [], calls: 0, openPicks }
  }

  if (args.dryRun) {
    for (const [gameId, picks] of byGame) {
      const game = gamesById.get(gameId)
      log.log(
        `  would fetch ${gameId}  event=${game?.oddsApiEventId || 'UNMAPPED'}  `
        + `markets=${marketsForPublishedPicks(picks).join(',') || '—'}  `
        + `picks=${picks.length}`,
      )
    }
    log.log('\n💡 Dry-run only. Pass --apply after 007 SQL to write closes.')
    return { exitCode: 0, updates: [], calls: 0, openPicks, byGame }
  }

  if (!apiKey) {
    log.error('❌ ODDS_API_KEY missing. Dry-run does not need it; --apply does.')
    return { exitCode: 1, updates: [], calls: 0 }
  }

  const updates = []
  let calls = 0
  let lastQuota = { remaining: null, used: null }

  for (const [gameId, picks] of byGame) {
    const game = gamesById.get(gameId)
    const sportKey = oddsApiSportKey(game?.sport)
    if (!game?.oddsApiEventId || !sportKey) {
      log.log(`  skip ${gameId}: no Odds API event id`)
      continue
    }
    const markets = marketsForPublishedPicks(picks)
    if (markets.length === 0) {
      log.log(`  skip ${gameId}: no mapped markets`)
      continue
    }
    if (args.maxCalls != null && calls >= args.maxCalls) {
      log.log(`⏸️  --max-calls ${args.maxCalls} reached. Stopping.`)
      break
    }
    if (lastQuota.remaining != null && lastQuota.remaining < args.minRemaining) {
      log.log(
        `⏸️  Odds API remaining ${lastQuota.remaining} < min-remaining ${args.minRemaining}. Stopping.`,
      )
      break
    }

    const url = buildEventOddsUrl({
      sportKey,
      eventId: game.oddsApiEventId,
      markets,
      apiKey,
    })
    calls += 1
    let payload
    try {
      payload = await fetchEventOdds({ url })
      if (payload.quota) lastQuota = payload.quota
    } catch (error) {
      log.error(`  ❌ ${gameId}: ${error.message}`)
      continue
    }

    const quotes = flattenEventOddsQuotes(payload.data)
    for (const pick of picks) {
      const quote = matchClosingQuote(pick, quotes)
      if (!quote) {
        log.log(`  no quote ${pick.id} ${pick.playerName} ${pick.propType}`)
        continue
      }
      const patch = closeCapturePayload(quote, now)
      const write = await updateWithOptionalCloseOdds(
        (body) => supabase.from('PropValidation').update(body).eq('id', pick.id),
        patch,
      )
      if (write?.error) {
        log.error(`  ❌ write ${pick.id}: ${write.error.message}`)
        continue
      }
      updates.push({ id: pick.id, ...patch })
      log.log(
        `  ✅ ${pick.id} ${pick.playerName} ${pick.propType} `
        + `recorded ${pick.odds} → close ${patch.closeOdds} (${quote.book})`,
      )
    }
  }

  if (lastQuota.remaining != null) {
    log.log(`📊 Odds API remaining: ${lastQuota.remaining} (used ${lastQuota.used ?? '?'})`)
  }
  log.log(`Captured ${updates.length} close(s) with ${calls} HTTP call(s).`)
  return { exitCode: 0, updates, calls, lastQuota }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runCapturePublishedCloses().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error)
    process.exit(1)
  })
}
