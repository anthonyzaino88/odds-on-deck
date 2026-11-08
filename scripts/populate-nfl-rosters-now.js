#!/usr/bin/env node
import { sanitizedErrorMessage, sanitizeLoggedValue } from '../lib/sanitize-error.js'

/**
 * Populate NFL Rosters from ESPN API
 */

import { config } from 'dotenv'

// Load environment variables FIRST before importing anything that uses them
config({ path: '.env.local' })

// Now import after env vars are loaded
const { fetchAndStoreNFLRosters } = await import('../lib/nfl-roster.js')

async function main() {
  try {
    console.log('🏈 Starting NFL roster population...')
    const result = await fetchAndStoreNFLRosters('2025')
    
    if (result.success) {
      console.log('✅ Success!')
      console.log(`   Players added: ${result.playersAdded || 0}`)
      console.log(`   Roster entries: ${result.rosterEntries || 0}`)
      console.log(`   Teams processed: ${result.teamsProcessed || 0}`)
    } else {
      console.error('❌ Failed:', sanitizeLoggedValue(result.error || result))
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Error:', sanitizedErrorMessage(error))
    process.exit(1)
  }
}

main()

