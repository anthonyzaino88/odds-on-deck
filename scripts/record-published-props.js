#!/usr/bin/env node
/**
 * Record Published-eligible MLB + NFL player props into PropValidation,
 * plus the private NHL shadow-published cohort (same eligibility bar,
 * notes=cohort:shadow-published). Shadow rows never appear on public
 * surfaces.
 *
 * Reads PlayerPropCache only — does not call The Odds API.
 * Run after the morning odds pull (or any time the public board is up)
 * so validate:all can grade the same cohort the homepage showed.
 *
 * Usage:
 *   node scripts/record-published-props.js
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { persistPublishedEligibleFromCache } = await import('../lib/validation.js')
  const saved = await persistPublishedEligibleFromCache()
  console.log(`📌 Published + shadow track: recorded ${saved.length} PropValidation row(s)`)
}

main().catch((error) => {
  console.error('❌ record-published-props failed:', error)
  process.exit(1)
})
