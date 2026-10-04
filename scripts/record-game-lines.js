#!/usr/bin/env node
/**
 * Record today's public sides & totals into PropValidation (source=game_line)
 * and grade any pending game-line rows from Game scores already in the DB.
 * Unpublished sports (MLB) are skipped for new rows; already-recorded
 * pending MLB game lines still grade via persistGameLines → gradePendingGameLines.
 *
 * Reads EdgeSnapshot + Odds + Game only — does not call The Odds API.
 * Homepage / /api/picks no longer persist on render. Run after the morning
 * odds pull (and again after scores update if you want same-day grades).
 *
 * Usage:
 *   node scripts/record-game-lines.js
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const {
    GAME_LINE_MIN_EDGE,
    PUBLISHED_GAME_LINE_SPORTS,
    generatePicksFromSupabase,
    selectGameLines,
    unpublishedGameLineSports,
  } = await import('../lib/picks.js')
  const { persistGameLines } = await import('../lib/validation.js')

  const skipped = unpublishedGameLineSports()
  if (skipped.length > 0) {
    console.log(`⏭️  Skipping unpublished game-line sports: ${skipped.join(', ')} (not recorded)`)
  }

  const batches = await Promise.all(
    PUBLISHED_GAME_LINE_SPORTS.map((sport) => generatePicksFromSupabase(sport, null, GAME_LINE_MIN_EDGE)),
  )
  const lines = selectGameLines(batches.flat())
  const saved = await persistGameLines(lines)
  console.log(`📌 Game-line track: recorded ${saved.length} PropValidation row(s) from ${lines.length} public line(s)`)
}

main().catch((error) => {
  console.error('❌ record-game-lines failed:', error)
  process.exit(1)
})
