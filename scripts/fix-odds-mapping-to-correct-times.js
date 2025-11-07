#!/usr/bin/env node

/**
 * Move odds mapping from games with wrong times (7pm/12:00 AM) to games with correct times
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixOddsMapping() {
  console.log('🔍 Fixing odds mapping to games with correct times...\n')
  
  // Get all NHL games with their times and odds status
  const { data: games, error } = await supabase
    .from('Game')
    .select(`
      id,
      date,
      espnGameId,
      oddsApiEventId,
      home:Team!Game_homeId_fkey(abbr),
      away:Team!Game_awayId_fkey(abbr)
    `)
    .eq('sport', 'nhl')
    .gte('date', '2025-11-05')
    .lt('date', '2025-11-08')
    .order('espnGameId', { ascending: true })
    .order('date', { ascending: true })
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  // Group by ESPN ID
  const byEspnId = {}
  games.forEach(g => {
    if (!byEspnId[g.espnGameId]) {
      byEspnId[g.espnGameId] = []
    }
    byEspnId[g.espnGameId].push(g)
  })
  
  // Find games where odds are mapped to wrong time
  const toFix = []
  
  Object.keys(byEspnId).forEach(espnId => {
    const games = byEspnId[espnId]
    if (games.length === 1) return // No duplicates
    
    // Find which one has odds
    const withOdds = games.find(g => g.oddsApiEventId)
    const withoutOdds = games.filter(g => !g.oddsApiEventId)
    
    if (withOdds && withoutOdds.length > 0) {
      // Check times - the one with odds should be the one with correct time
      const oddsTime = new Date(withOdds.date).getTime()
      const oddsTimeStr = new Date(withOdds.date).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
      
      // Check times - find games without odds that have non-midnight times
      withoutOdds.forEach(g => {
        const timeStr = new Date(g.date).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })
        const oddsTimeStr = new Date(withOdds.date).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })
        
        // If the game without odds has a different time than the one with odds, it might be better
        if (timeStr !== oddsTimeStr) {
          toFix.push({
            espnId,
            fromGame: withOdds,
            toGame: g,
            oddsEventId: withOdds.oddsApiEventId,
            fromTime: oddsTimeStr,
            toTime: timeStr
          })
        }
      })
    }
  })
  
  if (toFix.length === 0) {
    console.log('✅ No odds mappings need to be fixed!')
    return
  }
  
  console.log(`📊 Found ${toFix.length} odds mappings to fix:\n`)
  
  for (const fix of toFix) {
    const fromTime = new Date(fix.fromGame.date).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
    const toTime = new Date(fix.toGame.date).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
    
    console.log(`${fix.fromGame.away.abbr} @ ${fix.fromGame.home.abbr}:`)
    console.log(`  From: ${fix.fromGame.id} (${fromTime}) → To: ${fix.toGame.id} (${toTime})`)
    
    // Move odds mapping
    const { error: updateError } = await supabase
      .from('Game')
      .update({ oddsApiEventId: fix.oddsEventId })
      .eq('id', fix.toGame.id)
    
    if (updateError) {
      console.error(`  ❌ Error: ${updateError.message}`)
    } else {
      // Clear odds from old game
      await supabase
        .from('Game')
        .update({ oddsApiEventId: null })
        .eq('id', fix.fromGame.id)
      
      console.log(`  ✅ Moved odds mapping`)
    }
  }
  
  console.log(`\n✅ Fixed ${toFix.length} odds mappings!`)
}

fixOddsMapping().catch(console.error)

