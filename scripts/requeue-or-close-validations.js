#!/usr/bin/env node
/**
 * Requeue or close stuck PropValidation rows.
 *
 * Modes (env ACTION):
 *   - requeue (default): send needs_review rows back to pending if their game is final.
 *   - close_missing: close rows whose game record is missing.
 *   - close_final_no_stats: close rows whose game is final but stats were unavailable.
 *
 * Filters (env):
 *   - STATUSES: comma list of statuses to target (default: needs_review)
 *   - SPORT: optional sport filter (e.g., nfl, nhl, mlb)
 *   - AFTER_DATE / BEFORE_DATE: ISO date filters on validation.timestamp
 *   - LIMIT: max rows to process (default 200)
 */
import { config } from 'dotenv'

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

function parseDate(input) {
  if (!input) return null
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? null : d
}

async function main() {
  const supabase = await getSupabase()

  const action = (process.env.ACTION || 'requeue').toLowerCase()
  const statuses = (process.env.STATUSES || 'needs_review')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const sport = process.env.SPORT || null
  const afterDate = parseDate(process.env.AFTER_DATE)
  const beforeDate = parseDate(process.env.BEFORE_DATE)
  const limit = parseInt(process.env.LIMIT || '200', 10)

  console.log(`\n🚦 Action: ${action}`)
  console.log(`🎯 Statuses: ${statuses.join(', ')} | Sport: ${sport || 'any'} | Limit: ${limit}`)
  if (afterDate) console.log(`⏩ After: ${afterDate.toISOString()}`)
  if (beforeDate) console.log(`⏪ Before: ${beforeDate.toISOString()}`)
  console.log('')

  const { data: validations, error } = await supabase
    .from('PropValidation')
    .select('*')
    .in('status', statuses)
    .order('timestamp', { ascending: true })
    .limit(limit)

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

  for (const v of validations) {
    processed++
    if (sport && v.sport !== sport) {
      skipped++
      continue
    }
    if (afterDate && new Date(v.timestamp) < afterDate) {
      skipped++
      continue
    }
    if (beforeDate && new Date(v.timestamp) > beforeDate) {
      skipped++
      continue
    }

    const game = await findGame(supabase, v.gameIdRef, v.sport)

    if (action === 'requeue') {
      if (!game) {
        missingGame++
        continue
      }
      if (!isGameFinal(game)) {
        notFinal++
        continue
      }

      const notes = `${v.notes ? `${v.notes} | ` : ''}requeued ${new Date().toISOString()}`
      const { error: updErr } = await supabase
        .from('PropValidation')
        .update({ status: 'pending', notes })
        .eq('id', v.id)
      if (updErr) {
        console.error(`❌ Update failed for ${v.id}:`, updErr.message)
        continue
      }
      updated++
      continue
    }

    if (action === 'close_missing') {
      if (game) {
        skipped++
        continue
      }
      const notes = `${v.notes ? `${v.notes} | ` : ''}closed_missing ${new Date().toISOString()}`
      const { error: updErr } = await supabase
        .from('PropValidation')
        .update({ status: 'manual_closed', notes })
        .eq('id', v.id)
      if (updErr) {
        console.error(`❌ Update failed for ${v.id}:`, updErr.message)
        continue
      }
      updated++
      continue
    }

    if (action === 'close_final_no_stats') {
      if (!game) {
        missingGame++
        continue
      }
      if (!isGameFinal(game)) {
        notFinal++
        continue
      }
      const notes = `${v.notes ? `${v.notes} | ` : ''}manual_closed_final_no_stats ${new Date().toISOString()}`
      const { error: updErr } = await supabase
        .from('PropValidation')
        .update({ status: 'manual_closed', notes })
        .eq('id', v.id)
      if (updErr) {
        console.error(`❌ Update failed for ${v.id}:`, updErr.message)
        continue
      }
      updated++
      continue
    }

    console.warn(`⚠️ Unknown action "${action}", skipping.`)
    skipped++
  }

  console.log('\n📊 Summary')
  console.log(`Processed: ${processed}`)
  console.log(`Updated:   ${updated}`)
  console.log(`Skipped:   ${skipped}`)
  console.log(`Missing game: ${missingGame}`)
  console.log(`Game not final: ${notFinal}`)
}

main().catch((e) => {
  console.error('❌ Unexpected error:', e)
  process.exit(1)
})

