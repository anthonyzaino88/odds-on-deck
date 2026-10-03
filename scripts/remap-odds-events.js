#!/usr/bin/env node

/**
 * Clear and remap all odds event IDs
 * 
 * This script clears all existing oddsApiEventId mappings and forces
 * a fresh remap of all games to Odds API events.
 * 
 * Usage:
 *   node scripts/remap-odds-events.js nhl
 *   node scripts/remap-odds-events.js all
 */

import dotenv from 'dotenv'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'

dotenv.config({ path: '.env.local' })

const supabase = createScriptSupabaseClient()

async function clearAndRemap(sport) {
  console.log(`🔄 Clearing and remapping odds event IDs for ${sport.toUpperCase()}...\n`)
  
  // Clear all existing mappings for this sport
  const { error: clearError } = await supabase
    .from('Game')
    .update({ oddsApiEventId: null })
    .eq('sport', sport)
    .not('oddsApiEventId', 'is', null)
  
  if (clearError) {
    console.error(`❌ Error clearing mappings: ${clearError.message}`)
    return
  }
  
  console.log(`✅ Cleared all existing ${sport.toUpperCase()} mappings`)
  console.log(`💡 Now run: node scripts/fetch-live-odds.js ${sport}\n`)
}

async function main() {
  const sport = process.argv[2]?.toLowerCase() || 'all'
  
  if (sport === 'all') {
    for (const s of ['nfl', 'nhl']) {
      await clearAndRemap(s)
      await new Promise(r => setTimeout(r, 500))
    }
  } else if (['nfl', 'nhl', 'mlb'].includes(sport)) {
    await clearAndRemap(sport)
  } else {
    console.error(`❌ Invalid sport: ${sport}. Use: nfl, nhl, mlb, or all`)
    process.exit(1)
  }
  
  console.log(`\n✅ Done! Now run the odds script to remap:`)
  console.log(`   node scripts/fetch-live-odds.js ${sport}`)
}

main().catch(console.error)

