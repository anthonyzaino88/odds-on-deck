#!/usr/bin/env node

/**
 * Fix NHL game dates by re-fetching from ESPN and updating dates
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixDates() {
  console.log('🔧 Fixing NHL game dates from ESPN...\n')
  
  // Get all NHL games with ESPN IDs
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, date, espnGameId, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
    .not('espnGameId', 'is', null)
    .order('date', { ascending: true })
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`📊 Found ${games.length} NHL games to check\n`)
  
  let updated = 0
  let errors = 0
  
  // Fetch current games from ESPN for past 2 days and next 7 days
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const espnGames = new Map()
  
  console.log('🔄 Fetching current dates from ESPN...\n')
  
  // Check past 2 days and next 7 days (total 9 days)
  for (let i = -2; i < 7; i++) {
    const targetDate = new Date(today)
    targetDate.setDate(today.getDate() + i)
    const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '')
    
    const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${dateStr}`
    
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'OddsOnDeck/1.0' }
      })
      
      if (response.ok) {
        const data = await response.json()
        const events = data.events || []
        
        for (const event of events) {
          // Normalize date to UTC
          const gameDate = new Date(event.date)
          const utcDate = new Date(Date.UTC(
            gameDate.getUTCFullYear(),
            gameDate.getUTCMonth(),
            gameDate.getUTCDate()
          ))
          
          espnGames.set(event.id, utcDate.toISOString().split('T')[0])
        }
      }
      
      await new Promise(r => setTimeout(r, 200))
    } catch (error) {
      console.warn(`  ⚠️  Error fetching ${targetDate.toLocaleDateString()}: ${error.message}`)
    }
  }
  
  console.log(`📊 Found ${espnGames.size} games from ESPN\n`)
  
  // Update games with correct dates
  for (const game of games) {
    const correctDate = espnGames.get(game.espnGameId)
    
    if (!correctDate) {
      console.log(`⚠️  No ESPN date found for ${game.away.abbr} @ ${game.home.abbr} (ESPN: ${game.espnGameId})`)
      continue
    }
    
    const currentDate = new Date(game.date).toISOString().split('T')[0]
    
    if (currentDate !== correctDate) {
      console.log(`🔄 ${game.away.abbr} @ ${game.home.abbr}: ${currentDate} → ${correctDate}`)
      
      const { error: updateError } = await supabase
        .from('Game')
        .update({ date: correctDate })
        .eq('id', game.id)
      
      if (updateError) {
        console.error(`  ❌ Error: ${updateError.message}`)
        errors++
      } else {
        updated++
      }
    }
  }
  
  console.log(`\n✅ Fixed ${updated} game dates`)
  if (errors > 0) {
    console.log(`❌ ${errors} errors`)
  }
}

fixDates().catch(console.error)

