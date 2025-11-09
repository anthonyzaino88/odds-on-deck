#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const ODDS_API_KEY = process.env.ODDS_API_KEY

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function matchTeams(espnHome, espnAway, oddsHome, oddsAway) {
  const normalize = (name) => name.toLowerCase().trim().replace(/[^a-z]/g, '')
  
  const eh = normalize(espnHome)
  const ea = normalize(espnAway)
  const oh = normalize(oddsHome)
  const oa = normalize(oddsAway)
  
  return (eh === oh || oh.includes(eh) || eh.includes(oh)) &&
         (ea === oa || oa.includes(ea) || ea.includes(oa))
}

async function mapWeek11Games() {
  console.log('🔗 Mapping NFL Week 11 games to Odds API...\n')
  
  // Get Week 11 games from database
  const { data: dbGames, error: dbError } = await supabase
    .from('Game')
    .select('id, sport, date, homeId, awayId, oddsApiEventId, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)')
    .eq('sport', 'nfl')
    .gte('date', '2025-11-13T00:00:00')
    .lte('date', '2025-11-19T00:00:00')
  
  if (dbError) {
    console.error('❌ Database error:', dbError.message)
    return
  }
  
  console.log(`Found ${dbGames.length} NFL games in Week 11 (Nov 14-18)\n`)
  
  // Get games from Odds API
  const response = await fetch(
    `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&dateFormat=iso`
  )
  const oddsGames = await response.json()
  
  console.log(`Found ${oddsGames.length} games from Odds API\n`)
  
  // Match and update
  let matched = 0
  let failed = 0
  
  for (const dbGame of dbGames) {
    const homeName = dbGame.home?.name || dbGame.home?.abbr || ''
    const awayName = dbGame.away?.name || dbGame.away?.abbr || ''
    
    // Find matching odds game
    const oddsGame = oddsGames.find(og => 
      matchTeams(homeName, awayName, og.home_team, og.away_team)
    )
    
    if (oddsGame) {
      // Update the game with Odds API event ID
      const { error } = await supabase
        .from('Game')
        .update({ oddsApiEventId: oddsGame.id })
        .eq('id', dbGame.id)
      
      if (error) {
        console.log(`❌ ${awayName} @ ${homeName} - Failed to update`)
        failed++
      } else {
        console.log(`✅ ${awayName} @ ${homeName} → ${oddsGame.id}`)
        matched++
      }
    } else {
      console.log(`⚠️  ${awayName} @ ${homeName} - No match found in Odds API`)
      failed++
    }
  }
  
  console.log(`\n📊 Summary:`)
  console.log(`  ✅ Matched: ${matched}`)
  console.log(`  ❌ Failed: ${failed}`)
  console.log(`\n🎯 Now run: node scripts/fetch-live-odds.js nfl --cache-fresh`)
}

mapWeek11Games()

