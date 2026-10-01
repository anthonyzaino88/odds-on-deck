#!/usr/bin/env node
/**
 * Requeue or close stuck PropValidation rows.
 *
 * Modes (--action or env ACTION):
 *   - requeue (default): send needs_review rows back to pending if their game is final.
 *   - close_missing: close rows whose game record is missing.
 *   - close_final_no_stats: close rows whose game is final but stats were unavailable.
 *
 * --source (or SOURCE=) is required so a bare run cannot requeue every
 * needs_review row. Sport/source filters are applied on the query before
 * .limit() so later matching rows are not starved.
 *
 * --dry-run prints the write plan and writes nothing.
 *
 * Filters (env or flags):
 *   - STATUSES / --statuses: comma list (default: needs_review)
 *   - SPORT / --sport: optional sport filter (e.g., nfl, nhl, mlb)
 *   - SOURCE / --source: required PropValidation.source (e.g. game_line)
 *   - AFTER_DATE / BEFORE_DATE: ISO date filters on validation.timestamp
 *   - LIMIT / --limit: max rows (default 200)
 *
 * Example:
 *   node scripts/requeue-or-close-validations.js --source game_line --sport mlb --dry-run
 *   SOURCE=game_line SPORT=mlb node scripts/requeue-or-close-validations.js --dry-run
 */
import { config } from 'dotenv'
import {
  applyRequeueQueryFilters,
  describeRequeueWrite,
  parseRequeueArgs,
  requireRequeueSource,
} from '../lib/requeue-validations.js'

config({ path: '.env.local' })

let supabase
async function getSupabase() {
  if (!supabase) {
    const { supabaseAdmin } = await import('../lib/supabase-admin.js')
    supabase = supabaseAdmin
  }
  return supabase
}

const FINAL_STATUSES = ['final', 'completed', 'f', 'closed', 'post', 'ended']

function isGameFinal(game) {
  if (!game) return false
  const status = (game.status || '').toLowerCase()
  if (FINAL_STATUSES.includes(status)) return true

  const gameDate = new Date(game.date || game.ts || game.commence_time)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(23, 59, 59, 999)
  return gameDate < yesterday
}

async function findGame(supabase, gameIdRef, sport) {
  if (!gameIdRef) return null
  const lookups = [
    { field: 'id', value: gameIdRef },
    { field: 'mlbGameId', value: gameIdRef },
    { field: 'espnGameId', value: gameIdRef },
    { field: 'oddsApiEventId', value: gameIdRef },
  ]

  for (const { field, value } of lookups) {
    const { data } = await supabase
      .from('Game')
      .select('*')
      .eq(field, value)
      .maybeSingle()
    if (data) return data
  }

  if (sport) {
    const { data } = await supabase
      .from('Game')
      .select('*')
      .eq('espnGameId', gameIdRef)
      .eq('sport', sport)
      .maybeSingle()
    if (data) return data
  }

  return null
}

async function main() {
  const argv = process.argv.slice(2)
  const args = parseRequeueArgs(argv, process.env)
  if (args.help) {
    console.log(`Usage: node scripts/requeue-or-close-validations.js --source game_line [--sport mlb] [--dry-run]

--source (or SOURCE=) is required.
--dry-run prints the plan and writes nothing.`)
    return
  }

  let source
  try {
    source = requireRequeueSource(args.source)
  } catch (err) {
    console.error(`❌ ${err.message}`)
    process.exit(1)
  }

  const supabase = await getSupabase()

  console.log(`\n🚦 Action: ${args.action}${args.dryRun ? ' (DRY-RUN)' : ''}`)
  console.log(`🎯 Statuses: ${args.statuses.join(', ')} | Sport: ${args.sport || 'any'} | Source: ${source} | Limit: ${args.limit}`)
  if (args.afterDate) console.log(`⏩ After: ${args.afterDate.toISOString()}`)
  if (args.beforeDate) console.log(`⏪ Before: ${args.beforeDate.toISOString()}`)
  console.log('')

  const { data: validations, error } = await applyRequeueQueryFilters(
    supabase.from('PropValidation').select('*'),
    { ...args, source },
  )

  if (error) {
    console.error('❌ Error fetching validations:', error.message)
    process.exit(1)
  }

  if (!validations || validations.length === 0) {
    console.log('✅ Nothing to process.')
    return
  }

  let processed = 0
  let updated = 0
  let skipped = 0
  let missingGame = 0
  let notFinal = 0
  let errors = 0

  for (const v of validations) {
    processed++
    if (args.afterDate && new Date(v.timestamp) < args.afterDate) {
      skipped++
      continue
    }
    if (args.beforeDate && new Date(v.timestamp) > args.beforeDate) {
      skipped++
      continue
    }

    const game = await findGame(supabase, v.gameIdRef, v.sport)

    if (args.action === 'requeue') {
      if (!game) {
        missingGame++
        continue
      }
      if (!isGameFinal(game)) {
        notFinal++
        continue
      }

      const payload = describeRequeueWrite('requeue', v)
      if (args.dryRun) {
        console.log(`💡 Dry-run: would requeue ${v.id} ${v.sport || ''} ${v.propType || ''} → pending`)
        updated++
        continue
      }
      const { error: updErr } = await supabase
        .from('PropValidation')
        .update(payload)
        .eq('id', v.id)
      if (updErr) {
        console.error(`❌ Update failed for ${v.id}:`, updErr.message)
        errors++
        continue
      }
      updated++
      continue
    }

    if (args.action === 'close_missing') {
      if (game) {
        skipped++
        continue
      }
      const payload = describeRequeueWrite('close_missing', v)
      if (args.dryRun) {
        console.log(`💡 Dry-run: would close_missing ${v.id}`)
        updated++
        continue
      }
      const { error: updErr } = await supabase
        .from('PropValidation')
        .update(payload)
        .eq('id', v.id)
      if (updErr) {
        console.error(`❌ Update failed for ${v.id}:`, updErr.message)
        errors++
        continue
      }
      updated++
      continue
    }

    if (args.action === 'close_final_no_stats') {
      if (!game) {
        missingGame++
        continue
      }
      if (!isGameFinal(game)) {
        notFinal++
        continue
      }
      const payload = describeRequeueWrite('close_final_no_stats', v)
      if (args.dryRun) {
        console.log(`💡 Dry-run: would close_final_no_stats ${v.id}`)
        updated++
        continue
      }
      const { error: updErr } = await supabase
        .from('PropValidation')
        .update(payload)
        .eq('id', v.id)
      if (updErr) {
        console.error(`❌ Update failed for ${v.id}:`, updErr.message)
        errors++
        continue
      }
      updated++
      continue
    }

    console.warn(`⚠️ Unknown action "${args.action}", skipping.`)
    skipped++
  }

  console.log('\n📊 Summary')
  console.log(`Processed: ${processed}`)
  console.log(`${args.dryRun ? 'Would update' : 'Updated'}:   ${updated}`)
  console.log(`Skipped:   ${skipped}`)
  console.log(`Missing game: ${missingGame}`)
  console.log(`Game not final: ${notFinal}`)
  if (errors) console.log(`Errors:    ${errors}`)
  if (args.dryRun) console.log('💡 Dry-run. Re-run without --dry-run to write.')
  if (errors > 0) process.exit(1)
}

main().catch((e) => {
  console.error('❌ Unexpected error:', e)
  process.exit(1)
})
