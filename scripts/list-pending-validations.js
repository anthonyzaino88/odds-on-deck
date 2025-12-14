#!/usr/bin/env node
/**
 * List pending / needs_review PropValidation rows with game resolution hints.
 * Helps debug why validations are stuck.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

// Defer import until after env is loaded
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

async function findGame(gameIdRef, sport) {
  const supabase = await getSupabase()
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

  // Sport-specific fallback
  if (sport === 'nhl' || sport === 'nfl') {
    const { data } = await supabase
      .from('Game')
      .select('*')
      .eq('espnGameId', gameIdRef)
      .eq('sport', sport)
      .maybeSingle()
    if (data) return data
  }

  if (sport === 'mlb') {
    const { data } = await supabase
      .from('Game')
      .select('*')
      .eq('mlbGameId', gameIdRef)
      .eq('sport', 'mlb')
      .maybeSingle()
    if (data) return data
  }

  return null
}

async function main() {
  const supabase = await getSupabase()
  const statuses = (process.env.STATUSES || 'pending,needs_review')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const afterDate = process.env.AFTER_DATE ? new Date(process.env.AFTER_DATE) : null
  const limit = parseInt(process.env.LIMIT || '200', 10)

  console.log(`\n🔍 Listing validations (statuses=${statuses.join('/')}, limit=${limit}${afterDate ? `, after=${afterDate.toISOString().slice(0,10)}` : ''})...\n`)

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
    console.log('✅ No pending or needs_review validations.')
    return
  }

  for (const v of validations) {
    if (afterDate) {
      const ts = new Date(v.timestamp)
      if (ts < afterDate) continue
    }

    const game = await findGame(v.gameIdRef, v.sport)
    const final = isGameFinal(game)
    const status = game ? game.status || 'unknown' : 'missing'
    const gameId = game ? game.id : 'not-found'

    console.log(`- [${v.status}] ${v.sport || '?'} | ${v.playerName} ${v.propType} (${v.prediction} ${v.threshold}) @ ${v.timestamp}`)
    console.log(`    gameIdRef=${v.gameIdRef} | game.id=${gameId} | status=${status} | final=${final ? 'yes' : 'no'}`)
    if (v.notes) {
      console.log(`    notes: ${v.notes}`)
    }
  }
}

main().catch((e) => {
  console.error('❌ Unexpected error:', e)
  process.exit(1)
})

