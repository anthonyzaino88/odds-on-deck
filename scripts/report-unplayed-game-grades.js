#!/usr/bin/env node
/**
 * Report (and optionally repair) grades that settled on games that
 * were never truly final: postponed, cancelled, suspended, or MLB 0-0.
 *
 * Dry-run by default. Pass --apply to write repairs:
 *   - cancelled → void / manual_closed (not a loss)
 *   - postponed / suspended / MLB 0-0 → reset to pending
 *   - parent parlays whose stored status/odds no longer matches the
 *     remaining-leg aggregate, or that still have a flagged settled
 *     leg to repair → pending
 *
 * --apply requires SUPABASE_SECRET_KEY (no anon fallback).
 * Does not change Game rows. Does not call The Odds API.
 *
 * Usage:
 *   node scripts/report-unplayed-game-grades.js
 *   node scripts/report-unplayed-game-grades.js --sport mlb --from 2026-09-27 --to 2026-09-28
 *   node scripts/report-unplayed-game-grades.js --apply
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import {
  UNPLAYED_IN_CHUNK,
  applyGameDateScope,
  applyUnplayedGradeRepairs,
  chunkIds,
  paginateSupabaseSelect,
  parseUnplayedGradeArgs,
  planUnplayedGameGradeRepair,
  requireUnplayedGradeApplyKey,
} from '../lib/unplayed-game-grades.js'

const GAME_SELECT = 'id, sport, status, homeScore, awayScore, date'

function printPlan(plan, apply) {
  console.log(`📌 Unplayed / non-final Game rows: ${plan.games.length}`)
  console.log(`📌 PropValidation grades to repair: ${plan.props.length}`)
  console.log(`📌 ParlayLeg grades to repair: ${plan.legs.length}`)
  console.log(`📌 Settled parlays that would reset: ${plan.parlays.length}`)

  for (const game of plan.games) {
    console.log(
      `  game ${game.id} ${game.sport || '?'} ${game.status} ${game.awayScore ?? '?'}-${game.homeScore ?? '?'} → ${game.action} (${game.reason})`
    )
  }
  for (const row of plan.props) {
    console.log(
      `  ${apply ? 'WRITE' : 'would write'} prop ${row.id} ${row.playerName} ${row.propType} ${row.result}/${row.status} actual=${row.actualValue} game=${row.gameIdRef} → ${row.action}`
    )
  }
  for (const leg of plan.legs) {
    console.log(
      `  ${apply ? 'WRITE' : 'would write'} leg ${leg.id} parlay=${leg.parlayId} ${leg.playerName || leg.selection} ${leg.outcome} game=${leg.gameIdRef} → ${leg.action}`
    )
  }
  for (const parlay of plan.parlays) {
    console.log(
      `  ${apply ? 'WRITE' : 'would write'} parlay ${parlay.id} ${parlay.status || parlay.outcome} (${parlay.repairedLegCount} legs)`
    )
  }
}

async function loadSupabase(apply) {
  if (!apply) {
    const { supabaseAdmin } = await import('../lib/supabase-admin.js')
    return supabaseAdmin
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required')
  const key = requireUnplayedGradeApplyKey(process.env)
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function loadGames(supabase, scope) {
  const unplayed = await paginateSupabaseSelect(() => {
    let query = supabase
      .from('Game')
      .select(GAME_SELECT)
      .in('status', ['postponed', 'cancelled', 'canceled', 'suspended'])
      .order('id', { ascending: true })
    if (scope.sport) query = query.eq('sport', scope.sport)
    if (scope.game) query = query.eq('id', scope.game)
    return applyGameDateScope(query, scope)
  })
  if (unplayed.error) throw new Error(`Game lookup failed: ${unplayed.error.message}`)

  let mlbZeroRows = []
  if (!scope.sport || scope.sport === 'mlb') {
    const mlbZero = await paginateSupabaseSelect(() => {
      let query = supabase
        .from('Game')
        .select(GAME_SELECT)
        .eq('sport', 'mlb')
        .eq('homeScore', 0)
        .eq('awayScore', 0)
        .in('status', ['final', 'completed'])
        .order('id', { ascending: true })
      if (scope.game) query = query.eq('id', scope.game)
      return applyGameDateScope(query, scope)
    })
    if (mlbZero.error) throw new Error(`MLB 0-0 lookup failed: ${mlbZero.error.message}`)
    mlbZeroRows = mlbZero.rows
  }

  const seen = new Set()
  const games = []
  for (const game of [...unplayed.rows, ...mlbZeroRows]) {
    if (seen.has(game.id)) continue
    seen.add(game.id)
    games.push(game)
  }
  return games
}

async function loadValidations(supabase, gameIds) {
  let validations = []
  for (const chunk of chunkIds(gameIds, UNPLAYED_IN_CHUNK)) {
    const page = await paginateSupabaseSelect(() => supabase
      .from('PropValidation')
      .select('id, propId, playerName, propType, result, status, actualValue, gameIdRef, sport')
      .in('gameIdRef', chunk)
      .order('id', { ascending: true }))
    if (page.error) throw new Error(`PropValidation lookup failed: ${page.error.message}`)
    validations = validations.concat(page.rows)
  }
  return validations
}

const PARLAY_LEG_SELECT = 'id, parlayId, playerName, selection, betType, propType, outcome, odds, gameIdRef'

async function loadParlays(supabase, gameIds) {
  let flaggedLegs = []
  for (const chunk of chunkIds(gameIds, UNPLAYED_IN_CHUNK)) {
    const page = await paginateSupabaseSelect(() => supabase
      .from('ParlayLeg')
      .select(PARLAY_LEG_SELECT)
      .in('gameIdRef', chunk)
      .order('id', { ascending: true }))
    if (page.error) throw new Error(`ParlayLeg lookup failed: ${page.error.message}`)
    flaggedLegs = flaggedLegs.concat(page.rows)
  }

  const parlayIds = [...new Set(flaggedLegs.map((leg) => leg.parlayId).filter(Boolean))]
  if (parlayIds.length === 0) return []

  let rows = []
  for (const chunk of chunkIds(parlayIds, UNPLAYED_IN_CHUNK)) {
    const page = await paginateSupabaseSelect(() => supabase
      .from('Parlay')
      .select('id, status, outcome, sport, notes, totalOdds')
      .in('id', chunk)
      .order('id', { ascending: true }))
    if (page.error) throw new Error(`Parlay lookup failed: ${page.error.message}`)
    rows = rows.concat(page.rows)
  }

  let legs = []
  for (const chunk of chunkIds(parlayIds, UNPLAYED_IN_CHUNK)) {
    const page = await paginateSupabaseSelect(() => supabase
      .from('ParlayLeg')
      .select(PARLAY_LEG_SELECT)
      .in('parlayId', chunk)
      .order('id', { ascending: true }))
    if (page.error) throw new Error(`ParlayLeg lookup failed: ${page.error.message}`)
    legs = legs.concat(page.rows)
  }

  const byId = new Map(rows.map((row) => [row.id, { ...row, legs: [] }]))
  for (const leg of legs) {
    const parlay = byId.get(leg.parlayId)
    if (parlay) parlay.legs.push(leg)
  }
  return [...byId.values()]
}

function writeClient(supabase, table) {
  return async (id, payload) => {
    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq('id', id)
      .select('id')
    return { data, error, count: data?.length || 0 }
  }
}

async function main() {
  const args = parseUnplayedGradeArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node scripts/report-unplayed-game-grades.js [--apply] [--game ID] [--sport mlb] [--from YYYY-MM-DD] [--to YYYY-MM-DD]

Dry-run (default): print PropValidation / ParlayLeg / Parlay rows graded
from postponed, cancelled, suspended, or MLB 0-0 Game rows.
--apply: void cancelled grades; requeue postponed / unplayed 0-0 to pending.
         Requires SUPABASE_SECRET_KEY.`)
    return
  }

  const supabase = await loadSupabase(args.apply)
  const games = await loadGames(supabase, args)
  const gameIds = games.map((game) => game.id)
  const validations = gameIds.length ? await loadValidations(supabase, gameIds) : []
  const parlays = gameIds.length ? await loadParlays(supabase, gameIds) : []

  const plan = planUnplayedGameGradeRepair({
    games,
    validations,
    parlays,
    scope: args,
  })

  console.log('\n📋 UNPLAYED-GAME GRADE REPORT')
  console.log('='.repeat(60))
  printPlan(plan, args.apply)

  if (!args.apply) {
    console.log('\n💡 Dry-run. Re-run with --apply to write voids / pending resets.')
    console.log('   This script does not change Game rows.')
    return
  }

  requireUnplayedGradeApplyKey(process.env)
  const result = await applyUnplayedGradeRepairs(plan, {
    writeProp: writeClient(supabase, 'PropValidation'),
    writeLeg: writeClient(supabase, 'ParlayLeg'),
    writeParlay: writeClient(supabase, 'Parlay'),
  })
  console.log(`\n✅ Wrote ${result.wrote} repairs`)
}

main().catch((error) => {
  console.error('❌ report-unplayed-game-grades failed:', error)
  process.exit(1)
})
