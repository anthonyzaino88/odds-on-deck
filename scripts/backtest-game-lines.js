#!/usr/bin/env node
/**
 * Walk-forward game-line backtest. Read-only. Zero Odds API credits.
 *
 *   node scripts/backtest-game-lines.js --summary
 *   node scripts/backtest-game-lines.js --dry-run
 *   node scripts/backtest-game-lines.js --verbose --sport nfl --market moneyline
 *
 * Never writes. Never calls The Odds API. Prints SAMPLE_TOO_SMALL when
 * the holdout is under 200 games.
 */

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { paginateSupabaseSelect } from '../lib/unplayed-game-grades.js'
import { isMissingColumnError } from '../lib/grade-audit.js'
import { isMissingInjuryTableError } from '../lib/injury-availability.js'
import {
  formatBacktestReport,
  parseBacktestArgs,
  walkForwardBacktest,
} from '../lib/game-line-backtest.js'

config({ path: '.env.local' })

export const BACKTEST_USAGE = `Usage:
  node scripts/backtest-game-lines.js [--summary|--dry-run|--verbose]
                                      [--sport nfl|nhl|mlb|all]
                                      [--market moneyline|spreads|totals|all]
                                      [--model nfl-selection-v1.1.0]

Read-only. Zero Odds API credits. Default output is --summary.
`

function missingTable(error, names) {
  if (!error) return false
  if (isMissingColumnError(error) || isMissingInjuryTableError(error)) return true
  const code = String(error.code || '')
  if (code === '42P01' || code === 'PGRST205') return true
  const message = String(error.message || error.details || '')
  return names.some((name) => message.includes(name))
}

async function loadTable(supabase, table, select = '*', { optional = false, names = [table] } = {}) {
  try {
    const page = await paginateSupabaseSelect(() => (
      supabase.from(table).select(select).order('id', { ascending: true })
    ))
    if (page.error) {
      if (optional && missingTable(page.error, names)) return { rows: [], missing: true, error: page.error }
      return { rows: [], missing: false, error: page.error }
    }
    return { rows: page.rows || [], missing: false, error: null }
  } catch (error) {
    if (optional && missingTable(error, names)) return { rows: [], missing: true, error }
    return { rows: [], missing: false, error }
  }
}

function normalizeArchivedGame(row) {
  if (!row) return null
  return {
    id: row.id,
    sport: row.sport,
    date: row.date,
    status: row.status || 'final',
    homeId: row.home_team || row.homeTeam,
    awayId: row.away_team || row.awayTeam,
    home_team: row.home_team || row.homeTeam,
    away_team: row.away_team || row.awayTeam,
    homeScore: row.home_score ?? row.homeScore,
    awayScore: row.away_score ?? row.awayScore,
    homeStartingQB: row.home_qb || row.homeQb,
    awayStartingQB: row.away_qb || row.awayQb,
    archivedAt: row.archived_at || row.archivedAt,
    resultAvailableAt: row.archived_at || row.archivedAt,
    season: row.season || null,
    week: row.week ?? null,
  }
}

function mergeGames(live, archived) {
  const byId = new Map()
  for (const row of archived || []) {
    const game = normalizeArchivedGame(row)
    if (game?.id) byId.set(String(game.id), game)
  }
  for (const row of live || []) {
    byId.set(String(row.id), {
      ...row,
      resultAvailableAt: row.lastUpdate || row.resultAvailableAt,
    })
  }
  return [...byId.values()]
}

export async function loadBacktestDataset(supabase, { log = console } = {}) {
  const games = await loadTable(supabase, 'Game')
  if (games.error) return { error: games.error, dataset: emptyDataset() }
  const archived = await loadTable(supabase, 'ArchivedGame', '*', { optional: true, names: ['ArchivedGame'] })
  const odds = await loadTable(supabase, 'Odds')
  if (odds.error) return { error: odds.error, dataset: emptyDataset() }
  const closing = await loadTable(supabase, 'ClosingOdds', '*', { optional: true, names: ['ClosingOdds'] })
  const snapshots = await loadTable(supabase, 'OddsSnapshot', '*', { optional: true, names: ['OddsSnapshot'] })
  const edges = await loadTable(supabase, 'EdgeSnapshot', '*', { optional: true, names: ['EdgeSnapshot'] })
  const injuries = await loadTable(supabase, 'InjuryReport', '*', { optional: true, names: ['InjuryReport'] })
  const goalies = await loadTable(supabase, 'NhlStartingGoalie', '*', { optional: true, names: ['NhlStartingGoalie'] })

  if (archived.missing) log.log?.('ℹ️ ArchivedGame missing — using live Game rows only')
  if (closing.missing) log.log?.('ℹ️ ClosingOdds missing — closes can only come from Odds ids clvclose:*')
  if (snapshots.missing) log.log?.('ℹ️ OddsSnapshot missing (SQL 011 not applied) — skipped')
  if (injuries.missing) log.log?.('ℹ️ InjuryReport missing (SQL 009 not applied) — skipped')

  return {
    error: null,
    dataset: {
      games: mergeGames(games.rows, archived.rows),
      odds: [
        ...(odds.rows || []),
        ...closingOddsAsOdds(closing.rows),
      ],
      closingOdds: closing.rows || [],
      oddsSnapshots: snapshots.rows || [],
      edgeSnapshots: edges.rows || [],
      injuries: injuries.rows || [],
      goalies: goalies.rows || [],
    },
  }
}

function closingOddsAsOdds(rows) {
  return (rows || []).map((row) => ({
    ...row,
    gameId: row.gameId || row.game_id,
    ts: row.ts || row.snapshotAt || row.snapshot_at,
    quotedAt: row.quotedAt || row.quoted_at,
  }))
}

function emptyDataset() {
  return {
    games: [],
    odds: [],
    closingOdds: [],
    oddsSnapshots: [],
    edgeSnapshots: [],
    injuries: [],
    goalies: [],
  }
}

export async function runBacktestGameLines({
  argv = process.argv.slice(2),
  createClient = createScriptSupabaseClient,
  log = console,
  dataset = null,
} = {}) {
  const args = parseBacktestArgs(argv)
  if (args.help) {
    log.log?.(BACKTEST_USAGE)
    return { exitCode: 0, args, result: null }
  }

  let loaded = dataset
  if (!loaded) {
    let supabase
    try {
      supabase = createClient()
    } catch (error) {
      log.log?.(`⚠️ No database (${error.message}). SAMPLE_TOO_SMALL.`)
      const result = walkForwardBacktest(emptyDataset(), args)
      log.log?.(formatBacktestReport(result, { verbose: args.verbose }))
      return { exitCode: 0, args, result, db: false }
    }
    const page = await loadBacktestDataset(supabase, { log })
    if (page.error) {
      log.error?.(`❌ Query error: ${page.error.message}`)
      const result = walkForwardBacktest(emptyDataset(), args)
      log.log?.(formatBacktestReport(result, { verbose: false }))
      log.log?.('SAMPLE_TOO_SMALL')
      return { exitCode: 1, args, result, error: page.error }
    }
    loaded = page.dataset
  }

  const result = walkForwardBacktest(loaded, args)
  log.log?.(formatBacktestReport(result, { verbose: args.verbose }))
  const tooSmall = !result.summaries.length
    || result.summaries.every((summary) => !summary.sample.ok)
  if (tooSmall) log.log?.('SAMPLE_TOO_SMALL')
  return { exitCode: 0, args, result, db: true }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  runBacktestGameLines().then((result) => {
    process.exit(result.exitCode || 0)
  }).catch((error) => {
    console.error('⚠️ backtest-game-lines failed:', error.message)
    console.log('SAMPLE_TOO_SMALL')
    process.exit(0)
  })
}
