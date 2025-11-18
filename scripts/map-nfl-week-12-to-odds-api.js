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
  // More precise NFL team matching
  const normalize = (name) => {
    return name.toLowerCase()
      .replace(/[^a-z\s]/g, '') // Remove special chars but keep spaces
      .trim()
  }

  const eh = normalize(espnHome)
  const ea = normalize(espnAway)
  const oh = normalize(oddsHome)
  const oa = normalize(oddsAway)

  // Exact match
  const exactMatch = eh === oh && ea === oa

  // Contains match (for cases like "New England Patriots" vs "New England")
  const containsMatch = (oh.includes(eh) || eh.includes(oh)) && (oa.includes(ea) || ea.includes(oa))

  // City/state matching for teams with multiple words
  const ehWords = eh.split(' ')
  const eaWords = ea.split(' ')
  const ohWords = oh.split(' ')
  const oaWords = oa.split(' ')

  const cityMatch = ehWords.some(word => oh.includes(word) && word.length > 3) &&
                   eaWords.some(word => oa.includes(word) && word.length > 3)

  return exactMatch || containsMatch || cityMatch
}

async function mapWeek12Games() {
  console.log('🔗 Mapping NFL Week 12 games to Odds API...\n')

  // Get Week 12 games from database
  const { data: dbGames, error: dbError } = await supabase
    .from('Game')
    .select('id, sport, date, homeId, awayId, oddsApiEventId, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)')
    .eq('sport', 'nfl')
    .gte('date', '2025-11-20T00:00:00')
    .lte('date', '2025-11-24T23:59:59')

  if (dbError) {
    console.error('❌ Database error:', dbError.message)
    return
  }

  console.log(`Found ${dbGames.length} NFL games in Week 12 (Nov 20-24)\n`)

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

mapWeek12Games()
