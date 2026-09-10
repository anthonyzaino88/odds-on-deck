#!/usr/bin/env node
/**
 * Snapshot today's Featured-cleared 3-leg cards onto the tracked cohort.
 *
 * Reads PlayerPropCache via the Featured generator — does not call The Odds API.
 * First write for each sport + SGP/multi + ET slate day wins. Empty slates
 * write nothing.
 *
 * Usage:
 *   node scripts/record-featured-parlays.js
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { generateSimpleParlays } = await import('../lib/simple-parlay-generator.js')
  const { persistFeaturedClearedParlays } = await import('../lib/featured-parlay-persist.js')

  let inserted = 0
  let skipped = 0
  let empty = 0

  for (const sport of ['mlb', 'nfl']) {
    for (const type of ['single_game', 'multi_game']) {
      const parlays = await generateSimpleParlays({
        sport,
        type,
        featured: true,
        maxParlays: 1,
        legCount: 3,
      })
      if (!parlays.length) {
        empty += 1
        console.log(`✅ ${sport} ${type}: no Featured-cleared card (empty > filler)`)
        continue
      }
      const results = await persistFeaturedClearedParlays(parlays)
      for (const result of results) {
        if (result.skipped) skipped += 1
        else if (result.ok) inserted += 1
        console.log(
          `📌 ${sport} ${type}: ${result.reason}${result.parlay?.id ? ` (${result.parlay.id})` : ''}`
        )
      }
    }
  }

  console.log(`📌 Featured track: inserted ${inserted}, already snapped ${skipped}, empty slots ${empty}`)
}

main().catch((error) => {
  console.error('❌ record-featured-parlays failed:', error)
  process.exit(1)
})
