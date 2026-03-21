import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
)

async function run() {
  const today = new Date()
  const start = new Date(today); start.setHours(0,0,0,0)
  const end = new Date(today); end.setHours(23,59,59,999)

  const { data: nhl } = await s.from('Game')
    .select('id, date, status, homeScore, awayScore, espnGameId, oddsApiEventId, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)')
    .eq('sport', 'nhl')
    .gte('date', start.toISOString())
    .lte('date', end.toISOString())
    .order('date', { ascending: true })

  const { data: mlb } = await s.from('Game')
    .select('id, date, status, homeScore, awayScore, espnGameId, oddsApiEventId, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)')
    .eq('sport', 'mlb')
    .gte('date', start.toISOString())
    .lte('date', end.toISOString())
    .order('date', { ascending: true })

  console.log("=== TODAY'S SLATE (March 21, 2026) ===\n")

  console.log(`--- NHL (${nhl?.length || 0} games) ---`)
  for (const g of nhl || []) {
    const time = new Date(g.date + 'Z').toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
    const odds = g.oddsApiEventId ? 'ODDS' : 'no odds'
    const score = g.homeScore != null ? `${g.homeScore}-${g.awayScore}` : ''
    console.log(`  ${time.padEnd(10)} ${(g.away.abbr + ' @ ' + g.home.abbr).padEnd(14)} ${g.status.padEnd(12)} ${odds.padEnd(8)} ${score}`)
  }

  console.log(`\n--- MLB Spring Training (${mlb?.length || 0} games) ---`)
  for (const g of mlb || []) {
    const time = new Date(g.date + 'Z').toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
    const odds = g.oddsApiEventId ? 'ODDS' : 'no odds'
    const score = g.homeScore != null ? `${g.homeScore}-${g.awayScore}` : ''
    console.log(`  ${time.padEnd(10)} ${(g.away.abbr + ' @ ' + g.home.abbr).padEnd(14)} ${g.status.padEnd(12)} ${odds.padEnd(8)} ${score}`)
  }

  // Detailed MLB game view
  console.log("\n\n=== MLB GAME DETAILS ===")
  for (const g of mlb || []) {
    console.log(`\n--- ${g.away.name} @ ${g.home.name} ---`)
    console.log(`  Game ID:    ${g.id}`)
    console.log(`  ESPN ID:    ${g.espnGameId || 'none'}`)
    console.log(`  Odds API:   ${g.oddsApiEventId || 'none (spring training - not covered)'}`)
    console.log(`  Date:       ${g.date}`)
    console.log(`  Status:     ${g.status}`)
    console.log(`  Score:      ${g.homeScore != null ? g.home.abbr + ' ' + g.homeScore + ' - ' + g.awayScore + ' ' + g.away.abbr : 'not started'}`)

    // Check for odds
    const { data: odds } = await s.from('Odds')
      .select('book, market, priceHome, priceAway, total, spread')
      .eq('gameId', g.id)
      .limit(10)
    if (odds?.length > 0) {
      console.log(`  Odds:       ${odds.length} records`)
      for (const o of odds) {
        console.log(`    ${o.book.padEnd(16)} ${o.market.padEnd(10)} H:${String(o.priceHome || '').padEnd(6)} A:${String(o.priceAway || '').padEnd(6)} ${o.total ? 'T:' + o.total : ''} ${o.spread ? 'S:' + o.spread : ''}`)
      }
    } else {
      console.log(`  Odds:       none`)
    }

    // Check for props
    const { data: props } = await s.from('PlayerPropCache')
      .select('playerName, type, pick, threshold, odds, probability, edge, confidence, qualityScore')
      .eq('gameId', g.id)
      .order('qualityScore', { ascending: false })
      .limit(5)
    if (props?.length > 0) {
      console.log(`  Top Props:  ${props.length} shown`)
      for (const p of props) {
        console.log(`    ${p.playerName.padEnd(22)} ${p.type.padEnd(18)} ${p.pick.padEnd(6)} ${p.threshold} (Q:${p.qualityScore?.toFixed(1) || '?'}, E:${p.edge?.toFixed(2) || '?'})`)
      }
    } else {
      console.log(`  Props:      none`)
    }
  }

  // NHL sample game detail
  console.log("\n\n=== NHL GAME DETAIL (sample: first 3) ===")
  for (const g of (nhl || []).slice(0, 3)) {
    console.log(`\n--- ${g.away.name} @ ${g.home.name} ---`)
    console.log(`  Status: ${g.status}`)

    const { data: odds } = await s.from('Odds')
      .select('book, market, priceHome, priceAway, total, spread')
      .eq('gameId', g.id)
      .limit(10)
    console.log(`  Odds: ${odds?.length || 0} records`)
    for (const o of (odds || []).slice(0, 5)) {
      console.log(`    ${o.book.padEnd(16)} ${o.market.padEnd(10)} H:${String(o.priceHome || '').padEnd(6)} A:${String(o.priceAway || '').padEnd(6)} ${o.total ? 'T:' + o.total : ''} ${o.spread ? 'S:' + o.spread : ''}`)
    }

    const { data: props } = await s.from('PlayerPropCache')
      .select('playerName, type, pick, threshold, odds, probability, edge, confidence, qualityScore')
      .eq('gameId', g.id)
      .order('qualityScore', { ascending: false })
      .limit(5)
    console.log(`  Top Props: ${props?.length || 0}`)
    for (const p of (props || [])) {
      console.log(`    ${p.playerName.padEnd(22)} ${p.type.padEnd(18)} ${p.pick.padEnd(6)} ${p.threshold} (Q:${p.qualityScore?.toFixed(1)}, edge:${p.edge?.toFixed(2)})`)
    }
  }
}

run().catch(e => console.error(e))
