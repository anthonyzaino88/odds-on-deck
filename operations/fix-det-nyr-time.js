#!/usr/bin/env node

// Fix the Detroit @ NY Rangers game time in database
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

async function fixDetroitRangersTime() {
  console.log('🔧 Fixing Detroit @ NY Rangers game time...\n')

  // Find the Detroit @ NY Rangers game
  const { data: games, error } = await supabase
    .from('Game')
    .select(`
      id,
      date,
      espnGameId,
      status,
      home:Team!Game_homeId_fkey(name, abbr),
      away:Team!Game_awayId_fkey(name, abbr)
    `)
    .eq('sport', 'nhl')
    .eq('espnGameId', '401802650') // From ESPN API

  if (error) {
    console.error('❌ Database error:', error)
    return
  }

  if (!games || games.length === 0) {
    console.log('❌ Detroit @ NY Rangers game not found in database')
    return
  }

  const game = games[0]
  console.log(`Found game: ${game.away.abbr} @ ${game.home.abbr}`)
  console.log(`Current time: ${new Date(game.date).toISOString()}`)

  // Correct time from ESPN: 2025-11-16 at 7:00 PM EST
  // 7:00 PM EST = 12:00 AM UTC next day (2025-11-17T00:00:00Z)
  const correctTime = '2025-11-17T00:00:00Z'

  console.log(`Correct time should be: ${correctTime}`)
  console.log(`This displays as: 7:00 PM EST on 2025-11-16\n`)

  // Update the game time
  const { error: updateError } = await supabase
    .from('Game')
    .update({ date: correctTime })
    .eq('id', game.id)

  if (updateError) {
    console.error('❌ Error updating game time:', updateError)
  } else {
    console.log('✅ Successfully updated Detroit @ NY Rangers game time!')
    console.log(`New time: 7:00 PM EST on 2025-11-16`)

    // Clear any cached Odds API event ID since the date changed
    await supabase
      .from('Game')
      .update({ oddsApiEventId: null })
      .eq('id', game.id)

    console.log('📝 Cleared Odds API event ID (will need re-mapping)')
  }
}

fixDetroitRangersTime().catch(console.error)




