#!/usr/bin/env node

/**
 * Fetch odds for a specific game by Game.id.
 *
 * Back-compat wrapper around the budgeted pipeline:
 *   node scripts/fetch-live-odds.js --game <gameId>
 *
 * Fetches that game's lines (h2h, spreads, totals) and player props,
 * counts against the Odds API credit budget, and applies the
 * injury/roster guard. Does not refetch other games.
 * --dry-run spends 0 paid Odds API credits (delegates to fetch-live-odds).
 *
 * Usage:
 *   node scripts/fetch-odds-for-game.js VAN_at_NSH_2025-11-04
 *   node scripts/fetch-odds-for-game.js GB_at_LAR_2026-11-25 --dry-run
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const args = process.argv.slice(2)
let gameId = null
const rest = []

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--help' || arg === '-h') {
    console.log('Usage: node scripts/fetch-odds-for-game.js <gameId> [--dry-run] [--cache-fresh]')
    console.log('Same as: node scripts/fetch-live-odds.js --game <gameId>')
    process.exit(0)
  }
  if (arg === '--game' && args[i + 1] && !String(args[i + 1]).startsWith('--')) {
    gameId = args[i + 1]
    i += 1
    continue
  }
  if (!String(arg).startsWith('--') && !gameId) {
    gameId = arg
    continue
  }
  rest.push(arg)
}

if (!gameId) {
  console.error('Usage: node scripts/fetch-odds-for-game.js <gameId> [--dry-run] [--cache-fresh]')
  console.error('Example: node scripts/fetch-odds-for-game.js VAN_at_NSH_2025-11-04')
  console.error('Same as: node scripts/fetch-live-odds.js --game <gameId>')
  process.exit(1)
}

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fetch-live-odds.js')
const result = spawnSync(process.execPath, [script, '--game', gameId, ...rest], {
  stdio: 'inherit',
})
process.exit(result.status == null ? 1 : result.status)
