#!/usr/bin/env node
// Populate NFL rosters from ESPN API

import { config } from 'dotenv'
config({ path: '.env.local' })

const { fetchAndStoreNFLRosters } = await import('../lib/nfl-roster.js')

async function populateRosters() {
  try {
    console.log('🏈 Populating NFL rosters...\n')
    
    const result = await fetchAndStoreNFLRosters('2025')
    
    if (result.success) {
      console.log(`\n✅ Successfully populated NFL rosters!`)
      console.log(`   - Players added: ${result.playersAdded || 0}`)
      console.log(`   - Roster entries: ${result.rosterEntries || 0}`)
      console.log(`   - Teams processed: ${result.teamsProcessed || 0}`)
    } else {
      console.error(`\n❌ Failed to populate rosters: ${result.error || result.message}`)
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

populateRosters()

