#!/usr/bin/env node

/**
 * SNAPSHOT CLOSING LINES
 *
 * Captures the last known odds for every game starting within the next 2 hours.
 * Run this 30–60 min before first pitch / puck drop to get closing lines.
 * These are critical for calculating CLV (Closing Line Value) in future models.
 *
 * Usage:
 *   node scripts/snapshot-closing-lines.js          # all sports
 *   node scripts/snapshot-closing-lines.js mlb      # MLB only
 *   node scripts/snapshot-closing-lines.js --hours 4 # 4-hour window
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function main() {
  const args = process.argv.slice(2)
  const sportFilter = args.find(a => ['mlb', 'nhl', 'nfl'].includes(a.toLowerCase()))
  const hoursIdx = args.indexOf('--hours')
  const windowHours = hoursIdx >= 0 ? parseFloat(args[hoursIdx + 1]) || 2 : 2

  const now = new Date()
  const cutoff = new Date(now.getTime() + windowHours * 60 * 60 * 1000)

  console.log('\n📸 SNAPSHOT CLOSING LINES')
  console.log('='.repeat(60))
  console.log(`Window: games starting between now and ${windowHours}h from now`)
  console.log(`Cutoff: ${cutoff.toISOString()}`)
  if (sportFilter) console.log(`Sport:  ${sportFilter}`)
  console.log('='.repeat(60))

  // Find games in the window
  let gameQuery = supabase
    .from('Game')
    .select('id, sport, date, homeId, awayId')
    .gte('date', now.toISOString())
    .lte('date', cutoff.toISOString())

  if (sportFilter) gameQuery = gameQuery.eq('sport', sportFilter)

  const { data: games, error: gErr } = await gameQuery
  if (gErr) { console.error('Query error:', gErr.message); process.exit(1) }

  if (!games || games.length === 0) {
    console.log('\n✅ No games starting in this window.')
    process.exit(0)
  }

  console.log(`\n🎯 Found ${games.length} games approaching start time\n`)
  const gameIds = games.map(g => g.id)
  const gameSportMap = Object.fromEntries(games.map(g => [g.id, g.sport]))

  // Fetch all current odds for these games
  let allOdds = []
  for (let i = 0; i < gameIds.length; i += 50) {
    const chunk = gameIds.slice(i, i + 50)
    const { data } = await supabase
      .from('Odds')
      .select('*')
      .in('gameId', chunk)
      .order('ts', { ascending: false })
    if (data) allOdds = allOdds.concat(data)
  }

  if (allOdds.length === 0) {
    console.log('⚠️  No odds found for these games.')
    process.exit(0)
  }

  // Dedupe: keep latest per gameId + book + market
  const latest = new Map()
  for (const o of allOdds) {
    const key = `${o.gameId}|${o.book}|${o.market}`
    const existing = latest.get(key)
    if (!existing || new Date(o.ts) > new Date(existing.ts)) {
      latest.set(key, o)
    }
  }

  const closingRows = [...latest.values()].map(o => ({
    game_id: o.gameId,
    sport: gameSportMap[o.gameId] || 'unknown',
    book: o.book,
    market: o.market,
    price_home: o.priceHome,
    price_away: o.priceAway,
    total: o.total,
    spread: o.spread,
  }))

  console.log(`📦 Saving ${closingRows.length} closing odds lines...`)

  // Insert in batches
  let saved = 0
  for (let i = 0; i < closingRows.length; i += 200) {
    const batch = closingRows.slice(i, i + 200)
    const { error } = await supabase.from('ClosingOdds').insert(batch)
    if (error) {
      console.error(`  ⚠️  Batch insert error: ${error.message}`)
    } else {
      saved += batch.length
    }
  }

  // Also snapshot prop lines about to go live
  let propQuery = supabase
    .from('PlayerPropCache')
    .select('*')
    .in('gameId', gameIds)

  const { data: props } = await propQuery
  let propsArchived = 0
  if (props && props.length > 0) {
    const propRows = props.map(p => ({
      prop_id: p.propId,
      game_id: p.gameId,
      sport: p.sport,
      player_name: p.playerName,
      team: p.team,
      prop_type: p.type,
      pick: p.pick,
      threshold: p.threshold,
      odds: p.odds,
      probability: p.probability,
      edge: p.edge,
      confidence: p.confidence,
      quality_score: p.qualityScore,
      bookmaker: p.bookmaker,
      projection: p.projection,
      game_time: p.gameTime,
    }))

    for (let i = 0; i < propRows.length; i += 200) {
      const batch = propRows.slice(i, i + 200)
      const { error } = await supabase
        .from('ArchivedPropLine')
        .insert(batch)
      if (!error) propsArchived += batch.length
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('📸 SNAPSHOT COMPLETE')
  console.log(`  ✅ Closing odds:    ${saved} lines across ${games.length} games`)
  console.log(`  ✅ Prop snapshots:  ${propsArchived} props`)
  console.log('='.repeat(60) + '\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
