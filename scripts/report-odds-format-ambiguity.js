#!/usr/bin/env node
/**
 * Dry-run: classify stored PropValidation.odds without rewriting.
 *
 * Default prints counts and the 100–199 integer band (American by the
 * current helper, but also the band where a decimal 1.xx stored as 1xx
 * would hide). Pass nothing else — this script never UPDATEs.
 *
 * Usage:
 *   node scripts/report-odds-format-ambiguity.js
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { classifyStoredOdds } from '../lib/odds-units.js'

async function main() {
  const { supabaseAdmin } = await import('../lib/supabase-admin.js')

  const { data, error } = await supabaseAdmin
    .from('PropValidation')
    .select('id, source, sport, odds, result, status')
    .not('odds', 'is', null)
    .limit(20000)

  if (error) throw new Error(`PropValidation odds lookup failed: ${error.message}`)

  const rows = data || []
  const byHint = new Map()
  const ambiguous = []

  for (const row of rows) {
    const classified = classifyStoredOdds(row.odds, { source: row.source })
    const key = `${row.source || 'unknown'}|${classified.hint || 'unknown'}`
    byHint.set(key, (byHint.get(key) || 0) + 1)
    if (classified.ambiguousBand && String(row.source || '').toLowerCase() !== 'game_line') {
      ambiguous.push({
        id: row.id,
        sport: row.sport,
        source: row.source,
        odds: row.odds,
        status: row.status,
        result: row.result,
        detected: classified.format,
        hint: classified.hint,
        wouldChange: 'none — dry-run only; no format column / rewrite in this PR',
      })
    }
  }

  console.log(`📌 PropValidation rows with odds: ${rows.length}`)
  console.log('📌 Counts by source|hint:')
  for (const [key, count] of [...byHint.entries()].sort()) {
    console.log(`   ${key}: ${count}`)
  }
  console.log(`📌 Non-game_line integers in 100–199 (ambiguous band): ${ambiguous.length}`)
  console.log('   (this script does not write)')
  for (const row of ambiguous.slice(0, 50)) {
    console.log(`  ${row.id} ${row.sport} ${row.source} odds=${row.odds} detected=${row.detected} ${row.wouldChange}`)
  }
  if (ambiguous.length > 50) {
    console.log(`  … ${ambiguous.length - 50} more`)
  }
}

main().catch((error) => {
  console.error('❌ report-odds-format-ambiguity failed:', error)
  process.exit(1)
})
