#!/usr/bin/env node
/**
 * Record today's public sides & totals into PropValidation (source=game_line)
 * and grade any pending game-line rows from Game scores already in the DB.
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
    GAME_LINE_SPORTS,
    generatePicksFromSupabase,
    selectGameLines,
  } = await import('../lib/picks.js')
  const { persistGameLines } = await import('../lib/validation.js')

  const batches = await Promise.all(
    GAME_LINE_SPORTS.map((sport) => generatePicksFromSupabase(sport, null, GAME_LINE_MIN_EDGE)),
  )
  const lines = selectGameLines(batches.flat())
  const saved = await persistGameLines(lines)
  console.log(`📌 Game-line track: recorded ${saved.length} PropValidation row(s) from ${lines.length} public line(s)`)
}

main().catch((error) => {
  console.error('❌ record-game-lines failed:', error)
  process.exit(1)
})
