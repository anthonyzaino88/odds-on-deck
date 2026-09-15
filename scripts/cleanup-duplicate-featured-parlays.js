#!/usr/bin/env node
/**
 * Idempotent cleanup of duplicate Featured snapshot rows.
 *
 * Does not call The Odds API. Does not touch unique snapshot slots.
 * Default is dry-run. Pass --apply to delete later copies and their legs.
 *
 * Winner per snapshot:featured:{sport}:{sgp|multi}:{YYYY-MM-DD} key is the
 * earliest createdAt, then id. Later rows are extras regardless of
 * pending/settled — they are the same slot, not a second Featured card.
 *
 * Usage:
 *   node scripts/cleanup-duplicate-featured-parlays.js
 *   node scripts/cleanup-duplicate-featured-parlays.js --apply
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import {
  FEATURED_COHORT_TAG,
  planFeaturedDuplicateCleanup,
} from '../lib/featured-parlays.js'

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node scripts/cleanup-duplicate-featured-parlays.js [--apply]

Dry-run (default): print duplicate Featured snapshot rows.
--apply: delete later copies and their ParlayLeg rows. Keeps the earliest
createdAt per snapshot key. Unique slots are not touched.`)
    return
  }

  const { supabaseAdmin } = await import('../lib/supabase-admin.js')
  const { data, error } = await supabaseAdmin
    .from('Parlay')
    .select('id, notes, status, outcome, sport, type, createdAt, generatedAt, totalOdds')
    .ilike('notes', `%${FEATURED_COHORT_TAG}%`)
    .order('createdAt', { ascending: true })

  if (error) throw new Error(`Featured duplicate lookup failed: ${error.message}`)

  const plan = planFeaturedDuplicateCleanup(data || [])
  console.log(`📌 Featured snapshot slots with a winner: ${plan.keep.length}`)
  console.log(`📌 Duplicate rows to retract: ${plan.retract.length}`)
  for (const extra of plan.retract) {
    console.log(
      `  ${args.apply ? 'DELETE' : 'would delete'} ${extra.row.id} ${extra.row.status || extra.row.outcome} ${extra.key} (keep ${extra.winnerId})`
    )
  }

  if (!args.apply) {
    console.log('💡 Dry-run. Re-run with --apply to delete later copies.')
    return
  }

  let deleted = 0
  for (const extra of plan.retract) {
    const { error: legError } = await supabaseAdmin
      .from('ParlayLeg')
      .delete()
      .eq('parlayId', extra.row.id)
    if (legError) throw new Error(`Failed to delete legs for ${extra.row.id}: ${legError.message}`)
    const { error: parlayError } = await supabaseAdmin
      .from('Parlay')
      .delete()
      .eq('id', extra.row.id)
    if (parlayError) throw new Error(`Failed to delete parlay ${extra.row.id}: ${parlayError.message}`)
    deleted += 1
  }
  console.log(`✅ Retracted ${deleted} duplicate Featured rows`)
}

main().catch((error) => {
  console.error('❌ cleanup-duplicate-featured-parlays failed:', error)
  process.exit(1)
})
