#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fetchNFLSchedule } from '../lib/vendors/nfl-stats.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fetchWeek12Games() {
  console.log('🏈 Fetching NFL Week 12 games from ESPN...\n')

  try {
    // Fetch Week 12 games from ESPN
    const games = await fetchNFLSchedule(12, 2025)

    console.log(`Found ${games.length} games for Week 12 (2025)\n`)

    if (games.length === 0) {
      console.log('❌ No games found for Week 12')
      return
    }

    // ESPN team ID to abbreviation mapping (from ESPN API)
    const espnTeamMapping = {
      '1': 'ATL', '2': 'BUF', '3': 'CHI', '4': 'CIN', '5': 'CLE', '6': 'DAL', '8': 'DET',
      '9': 'GB', '10': 'TEN', '11': 'IND', '12': 'KC', '13': 'LV', '14': 'LAR', '16': 'MIN',
      '17': 'NE', '18': 'NO', '19': 'NYG', '20': 'NYJ', '21': 'PHI', '22': 'ARI', '23': 'PIT',
      '25': 'SF', '26': 'SEA', '27': 'TB', '29': 'CAR', '30': 'JAX', '33': 'BAL', '34': 'HOU'
    }

    // Store games in database
    let stored = 0
    let skipped = 0

    for (const game of games) {
      try {
        // Convert ESPN numeric IDs to abbreviations
        const homeAbbr = espnTeamMapping[game.homeId] || game.homeId.toUpperCase()
        const awayAbbr = espnTeamMapping[game.awayId] || game.awayId.toUpperCase()

        // Find teams by abbreviation (use first result to handle duplicates)
        const homeTeamResult = await supabase
          .from('Team')
          .select('id')
          .eq('abbr', homeAbbr)
          .limit(1)

        const awayTeamResult = await supabase
          .from('Team')
          .select('id')
          .eq('abbr', awayAbbr)
          .limit(1)

        if (!homeTeamResult.data || homeTeamResult.data.length === 0 ||
            !awayTeamResult.data || awayTeamResult.data.length === 0) {
          console.log(`⚠️  Skipping ${game.id} - team not found (${awayAbbr} @ ${homeAbbr})`)
          skipped++
          continue
        }

        // Upsert the game
        const { error } = await supabase
          .from('Game')
          .upsert({
            id: game.id,
            sport: 'nfl',
            espnGameId: game.espnGameId,
            date: game.date.toISOString(),
            homeId: homeTeamResult.data[0].id,
            awayId: awayTeamResult.data[0].id,
            status: game.status || 'scheduled',
            week: game.week,
            season: game.season
          })

        if (error) {
          console.log(`❌ Error storing ${game.id}:`, error.message)
        } else {
          const dateStr = new Date(game.date).toLocaleDateString()
          console.log(`✅ Stored: ${awayAbbr} @ ${homeAbbr} - ${dateStr}`)
          stored++
        }

      } catch (error) {
        console.log(`❌ Error processing ${game.id}:`, error.message)
        skipped++
      }
    }

    console.log(`\n📊 Summary:`)
    console.log(`  ✅ Stored: ${stored}`)
    console.log(`  ⚠️  Skipped: ${skipped}`)
    console.log(`  📅 Total games: ${games.length}`)

    if (stored > 0) {
      console.log(`\n🎯 Next step: Run 'node scripts/map-nfl-week-11-to-odds-api.js' (update for Week 12)`)
      console.log(`   Then run: node scripts/fetch-live-odds.js nfl --cache-fresh`)
    }

  } catch (error) {
    console.error('❌ Error fetching Week 12 games:', error.message)
  }
}

fetchWeek12Games()
