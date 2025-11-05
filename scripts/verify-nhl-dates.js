#!/usr/bin/env node

/**
 * Verify NHL game dates match what ESPN says
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function verifyDates() {
  console.log('🔍 Verifying NHL game dates...\n')
  
  // Get today's date range
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const yesterday = new Date(today)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const tomorrow = new Date(today)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  
  const todayStr = today.toISOString().split('T')[0]
  const yesterdayStr = yesterday.toISOString().split('T')[0]
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
  
  console.log(`📅 Current date (UTC): ${todayStr}`)
  console.log(`📅 Checking: ${yesterdayStr}, ${todayStr}, ${tomorrowStr}\n`)
  
  // Get all NHL games for these dates
  const { data: games, error } = await supabase
    .from('Game')
    .select(`
      id,
      date,
      espnGameId,
      home:Team!Game_homeId_fkey(abbr),
      away:Team!Game_awayId_fkey(abbr)
    `)
    .eq('sport', 'nhl')
    .gte('date', yesterdayStr)
    .lt('date', tomorrowStr)
    .order('date', { ascending: true })
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  // Group by date
  const gamesByDate = {}
  games.forEach(g => {
    const dateKey = new Date(g.date).toISOString().split('T')[0]
    if (!gamesByDate[dateKey]) {
      gamesByDate[dateKey] = []
    }
    gamesByDate[dateKey].push(g)
  })
  
  console.log('📊 Games by date in database:')
  Object.keys(gamesByDate).sort().forEach(date => {
    console.log(`  ${date}: ${gamesByDate[date].length} games`)
    gamesByDate[date].forEach(g => {
      console.log(`    - ${g.away.abbr} @ ${g.home.abbr} (ESPN: ${g.espnGameId})`)
    })
  })
  
  // Check what ESPN says for Nov 5
  console.log(`\n🔍 Checking ESPN for ${yesterdayStr} (expected 5 games)...`)
  const dateStr = yesterdayStr.replace(/-/g, '')
  const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${dateStr}`
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    
    if (response.ok) {
      const data = await response.json()
      const events = data.events || []
      console.log(`📊 ESPN says ${yesterdayStr}: ${events.length} games`)
      
      if (events.length !== gamesByDate[yesterdayStr]?.length) {
        console.log(`\n⚠️  MISMATCH! Database has ${gamesByDate[yesterdayStr]?.length || 0} games, ESPN has ${events.length}`)
        console.log(`\nESPN games:`)
        events.forEach(e => {
          const comp = e.competitions?.[0]
          const away = comp?.competitors?.[1]
          const home = comp?.competitors?.[0]
          console.log(`  - ${away?.team?.abbreviation} @ ${home?.team?.abbreviation} (ESPN ID: ${e.id})`)
        })
      }
    }
  } catch (error) {
    console.error(`  ⚠️  Error fetching ESPN: ${error.message}`)
  }
}

verifyDates().catch(console.error)

