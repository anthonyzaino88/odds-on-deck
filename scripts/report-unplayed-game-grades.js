#!/usr/bin/env node
/**
 * Report (and optionally repair) grades that settled on games that
 * were never truly final: postponed, cancelled, suspended, or MLB 0-0.
 *
 * Dry-run by default. Pass --apply to write repairs:
 *   - cancelled → void / manual_closed (not a loss)
 *   - postponed / suspended / MLB 0-0 → reset to pending
 *   - parent parlays that settled from those legs → pending
 *
 * Does not change Game rows. Does not call The Odds API.
 *
 * Usage:
 *   node scripts/report-unplayed-game-grades.js
 *   node scripts/report-unplayed-game-grades.js --apply
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import {
  describeLegRepairWrite,
  describeParlayRepairWrite,
  describePropRepairWrite,
  parseUnplayedGradeArgs,
  planUnplayedGameGradeRepair,
} from '../lib/unplayed-game-grades.js'

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

async function main() {
  const args = parseUnplayedGradeArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node scripts/report-unplayed-game-grades.js [--apply]

Dry-run (default): print PropValidation / ParlayLeg / Parlay rows graded
from postponed, cancelled, suspended, or MLB 0-0 Game rows.
--apply: void cancelled grades; requeue postponed / unplayed 0-0 to pending.`)
    return
  }

  const { supabaseAdmin } = await import('../lib/supabase-admin.js')

  const { data: unplayed, error: unplayedError } = await supabaseAdmin
    .from('Game')
    .select('id, sport, status, homeScore, awayScore, date')
    .in('status', ['postponed', 'cancelled', 'canceled', 'suspended', 'delayed'])
  if (unplayedError) throw new Error(`Game lookup failed: ${unplayedError.message}`)

  const { data: mlbZeroFinals, error: mlbError } = await supabaseAdmin
    .from('Game')
    .select('id, sport, status, homeScore, awayScore, date')
    .eq('sport', 'mlb')
    .eq('homeScore', 0)
    .eq('awayScore', 0)
    .in('status', ['final', 'completed'])
  if (mlbError) throw new Error(`MLB 0-0 lookup failed: ${mlbError.message}`)

  const seen = new Set()
  const games = []
  for (const game of [...(unplayed || []), ...(mlbZeroFinals || [])]) {
    if (seen.has(game.id)) continue
    seen.add(game.id)
    games.push(game)
  }

  const gameIds = (games || []).map((game) => game.id)
  let validations = []
  let parlays = []

  if (gameIds.length) {
    for (let i = 0; i < gameIds.length; i += 200) {
      const chunk = gameIds.slice(i, i + 200)
      const { data, error } = await supabaseAdmin
        .from('PropValidation')
        .select('id, propId, playerName, propType, result, status, actualValue, gameIdRef, sport')
        .in('gameIdRef', chunk)
      if (error) throw new Error(`PropValidation lookup failed: ${error.message}`)
      validations = validations.concat(data || [])
    }

    const { data: legs, error: legError } = await supabaseAdmin
      .from('ParlayLeg')
      .select('id, parlayId, playerName, selection, betType, propType, outcome, gameIdRef')
      .in('gameIdRef', gameIds)
    if (legError) throw new Error(`ParlayLeg lookup failed: ${legError.message}`)

    const parlayIds = [...new Set((legs || []).map((leg) => leg.parlayId).filter(Boolean))]
    if (parlayIds.length) {
      const { data, error } = await supabaseAdmin
        .from('Parlay')
        .select('id, status, outcome, sport, notes')
        .in('id', parlayIds)
      if (error) throw new Error(`Parlay lookup failed: ${error.message}`)
      const byId = new Map((data || []).map((row) => [row.id, { ...row, legs: [] }]))
      for (const leg of legs || []) {
        const parlay = byId.get(leg.parlayId)
        if (parlay) parlay.legs.push(leg)
      }
      parlays = [...byId.values()]
    }
  }

  const plan = planUnplayedGameGradeRepair({
    games: games || [],
    validations,
    parlays,
  })

  console.log('\n📋 UNPLAYED-GAME GRADE REPORT')
  console.log('='.repeat(60))
  printPlan(plan, args.apply)

  if (!args.apply) {
    console.log('\n💡 Dry-run. Re-run with --apply to write voids / pending resets.')
    console.log('   This script does not change Game rows.')
    return
  }

  const now = new Date()
  let wrote = 0

  for (const row of plan.props) {
    const { error } = await supabaseAdmin
      .from('PropValidation')
      .update(describePropRepairWrite(row, now))
      .eq('id', row.id)
    if (error) throw new Error(`PropValidation write failed for ${row.id}: ${error.message}`)
    wrote += 1
  }
  for (const leg of plan.legs) {
    const { error } = await supabaseAdmin
      .from('ParlayLeg')
      .update(describeLegRepairWrite(leg))
      .eq('id', leg.id)
    if (error) throw new Error(`ParlayLeg write failed for ${leg.id}: ${error.message}`)
    wrote += 1
  }
  for (const parlay of plan.parlays) {
    const { error } = await supabaseAdmin
      .from('Parlay')
      .update(describeParlayRepairWrite())
      .eq('id', parlay.id)
    if (error) throw new Error(`Parlay write failed for ${parlay.id}: ${error.message}`)
    wrote += 1
  }

  console.log(`\n✅ Wrote ${wrote} repairs`)
}

main().catch((error) => {
  console.error('❌ report-unplayed-game-grades failed:', error)
  process.exit(1)
})
