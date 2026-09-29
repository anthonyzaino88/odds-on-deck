#!/usr/bin/env node
/**
 * Read-only: Featured cards whose stored grade used a PropValidation
 * from a different game (same player + market, other gameIdRef).
 *
 * Does not write. Does not call The Odds API.
 *
 * Usage:
 *   node scripts/report-featured-game-mismatch.js
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import {
  FEATURED_COHORT_TAG,
  filterFeaturedCohortRows,
  reportFeaturedGameMismatchGrades,
} from '../lib/featured-parlays.js'

async function main() {
  const { supabaseAdmin } = await import('../lib/supabase-admin.js')

  const { data: rows, error } = await supabaseAdmin
    .from('Parlay')
    .select('id, notes, status, outcome, sport, type, createdAt, totalOdds, legs:ParlayLeg(*)')
    .ilike('notes', `%${FEATURED_COHORT_TAG}%`)
    .order('createdAt', { ascending: true })

  if (error) throw new Error(`Featured lookup failed: ${error.message}`)

  const parlays = filterFeaturedCohortRows(rows || [])
  const playerNames = [...new Set(parlays.flatMap((parlay) =>
    (parlay.legs || []).map((leg) => leg.playerName).filter(Boolean)
  ))]

  let validations = []
  if (playerNames.length > 0) {
    const { data, error: pvError } = await supabaseAdmin
      .from('PropValidation')
      .select('playerName, propType, prediction, threshold, actualValue, result, status, gameIdRef, parlayId')
      .in('playerName', playerNames)
    if (pvError) throw new Error(`PropValidation lookup failed: ${pvError.message}`)
    validations = data || []
  }

  const changed = reportFeaturedGameMismatchGrades(parlays, validations)
  console.log(`📌 Featured cards scanned: ${parlays.length}`)
  console.log(`📌 Cards whose rematch grade differs: ${changed.length}`)
  console.log(`📌 Stored settled totals that would change if rewritten: ${changed.filter((row) => row.wouldChangeStored).length}`)
  console.log('   (this script does not write)')

  for (const row of changed) {
    console.log(
      `  ${row.parlayId} ${row.sport} stored=${row.storedOutcome} legacy=${row.legacyOutcome} next=${row.nextOutcome} rewriteStored=${row.wouldChangeStored}`
    )
    for (const leg of row.legs) {
      if (leg.legacyOutcome === leg.nextOutcome && leg.legacyGameIdRef === leg.nextGameIdRef) continue
      console.log(
        `    ${leg.playerName} ${leg.propType} legGame=${leg.gameIdRef} legacyPV=${leg.legacyGameIdRef}→${leg.legacyOutcome}/${leg.legacyActual} nextPV=${leg.nextGameIdRef}→${leg.nextOutcome}/${leg.nextActual}`
      )
    }
  }
}

main().catch((error) => {
  console.error('❌ report-featured-game-mismatch failed:', error)
  process.exit(1)
})
