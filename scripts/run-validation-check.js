#!/usr/bin/env node
/**
 * RUN VALIDATION CHECK (via API)
 * 
 * Triggers the /api/validation/check endpoint in batches.
 * Requires the dev server to be running on localhost:3000.
 * 
 * For standalone validation (no dev server), use:
 *   node scripts/validate-pending-props.js
 */

import { config } from 'dotenv'

config({ path: '.env.local' })

async function runValidationCheck() {
  console.log('\n🔍 Running Validation Check (batched via API)...\n')
  
  let batch = 0
  let totalUpdated = 0
  let totalErrors = 0
  const MAX_BATCHES = 100
  let consecutiveEmptyBatches = 0

  try {
    while (batch < MAX_BATCHES) {
      const response = await fetch('http://localhost:3000/api/validation/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch })
      })
      
      const data = await response.json()

      if (!data.success) {
        console.error('❌ Validation check failed:', data.error)
        break
      }

      console.log(`✅ Batch ${batch + 1}: ${data.message}`)
      console.log(`   Updated: ${data.updated} | Errors: ${data.errors} | Skipped: ${data.skipped}`)

      totalUpdated += data.updated || 0
      totalErrors += data.errors || 0

      if ((data.updated || 0) === 0 && (data.errors || 0) === 0) {
        consecutiveEmptyBatches++
      } else {
        consecutiveEmptyBatches = 0
      }

      if (!data.hasMoreBatches || consecutiveEmptyBatches >= 3) {
        break
      }

      batch++
      // Small delay between batches to avoid hammering the dev server
      await new Promise(r => setTimeout(r, 500))
    }

    console.log('\n✅ Validation Check Complete!')
    console.log('='.repeat(60))
    console.log(`📊 Batches run: ${batch + 1}`)
    console.log(`✅ Updated: ${totalUpdated}`)
    console.log(`❌ Errors: ${totalErrors}`)
    console.log('='.repeat(60))
    
    if (totalUpdated > 0) {
      console.log('\n💡 Visit /validation dashboard to see updated stats!\n')
    } else {
      console.log('\n✨ All validations are up to date!\n')
    }

  } catch (error) {
    console.error('❌ Error running validation check:', error.message)
    console.log('\n💡 Make sure your dev server is running on http://localhost:3000')
    console.log('   Or use the standalone script: node scripts/validate-pending-props.js\n')
  }
}

runValidationCheck().catch(console.error)
