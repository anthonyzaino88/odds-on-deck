#!/usr/bin/env node

// Fix today's NHL game times by fetching from ESPN and updating database
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

// Validate environment variables are loaded
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase credentials in environment variables')
  console.error('Please ensure .env.local contains NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixTodayNHLTimes() {
  console.log('🔧 Fixing today\'s NHL game times from ESPN...\n')

  // Today's date
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  // Fetch today's games from ESPN
  console.log(`📡 Fetching NHL games from ESPN for ${todayStr}...\n`)

  const espnDate = todayStr.replace(/-/g, '')
  const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${espnDate}`

  let espnGames = []
  try {
    const response = await fetch(espnUrl, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })

    if (!response.ok) {
      console.error(`❌ ESPN API Error: ${response.status}`)
      return
    }

    const data = await response.json()
    espnGames = data.events || []
  } catch (error) {
    console.error('❌ Error fetching from ESPN:', error.message)
    return
  }

  console.log(`Found ${espnGames.length} NHL games on ESPN today\n`)

  // Get today's games from database
  const { data: dbGames, error } = await supabase
    .from('Game')
    .select(`
      id,
      date,
      espnGameId,
      oddsApiEventId,
      home:Team!Game_homeId_fkey(name, abbr),
      away:Team!Game_awayId_fkey(name, abbr)
    `)
    .eq('sport', 'nhl')
    .gte('date', `${todayStr}T00:00:00Z`)
    .lte('date', `${todayStr}T23:59:59Z`)

  if (error) {
    console.error('❌ Database error:', error)
    return
  }

  console.log(`Found ${dbGames?.length || 0} NHL games in database today\n`)

  // Match and update each database game with ESPN times
  let updated = 0
  let matched = 0

  for (const dbGame of dbGames || []) {
    // Find matching ESPN game
    const espnGame = espnGames.find(eg => eg.id === dbGame.espnGameId)

    if (espnGame) {
      matched++
      const espnTime = new Date(espnGame.date)
      const currentDbTime = new Date(dbGame.date)

      // Check if times are different
      if (Math.abs(espnTime.getTime() - currentDbTime.getTime()) > 60000) { // More than 1 minute difference
        console.log(`⏰ Updating ${dbGame.away.abbr} @ ${dbGame.home.abbr}:`)
        console.log(`   Current: ${currentDbTime.toISOString()}`)
        console.log(`   ESPN:    ${espnTime.toISOString()}`)

        // Update the database
        const { error: updateError } = await supabase
          .from('Game')
          .update({ date: espnTime.toISOString() })
          .eq('id', dbGame.id)

        if (updateError) {
          console.error(`   ❌ Error updating: ${updateError.message}`)
        } else {
          console.log(`   ✅ Updated successfully`)
          updated++
        }
        console.log('')
      } else {
        console.log(`✅ ${dbGame.away.abbr} @ ${dbGame.home.abbr} time is already correct`)
      }
    } else {
      console.log(`❌ No ESPN match found for ${dbGame.away.abbr} @ ${dbGame.home.abbr} (${dbGame.espnGameId})`)
    }
  }

  console.log(`\n📊 Summary:`)
  console.log(`   Games matched: ${matched}`)
  console.log(`   Times updated: ${updated}`)
  console.log(`   Total games: ${dbGames?.length || 0}`)

  if (updated > 0) {
    console.log(`\n🎯 Next steps:`)
    console.log(`   1. Run: node scripts/remap-nhl-event-ids.js`)
    console.log(`   2. Run: node scripts/fetch-live-odds.js nhl ${todayStr}`)
    console.log(`   3. Check if props are now available for today's games`)
  }
}

fixTodayNHLTimes().catch(console.error)




