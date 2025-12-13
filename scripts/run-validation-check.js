#!/usr/bin/env node
/**
 * RUN VALIDATION CHECK
 * 
 * Simple script to trigger the validation check endpoint
 */

import { config } from 'dotenv'

config({ path: '.env.local' })

async function runValidationCheck() {
  console.log('\n🔍 Running Validation Check (batched)...\n')
  
  let batch = 0
  let totalChecked = 0
  let totalUpdated = 0
  let totalErrors = 0
  let remaining = 0
  const MAX_BATCHES = 50 // safety stop

  try {
    while (batch < MAX_BATCHES) {
      const response = await fetch('http://localhost:3000/api/validation/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ batch })
      })
      
      const data = await response.json()

      if (!data.success) {
        console.error('❌ Validation check failed:', data.error)
        break
      }

      // Batch summary
      console.log(`✅ Batch ${batch + 1}: ${data.message}`)
      console.log(`   Updated: ${data.updated} | Errors: ${data.errors} | Skipped: ${data.skipped}`)

      totalChecked += (data.batchSize || 0)
      totalUpdated += data.updated || 0
      totalErrors += data.errors || 0
      remaining = data.remaining ?? 0

      if (!data.hasMoreBatches) {
        break
      }

      batch += 1
    }

    console.log('\n✅ Validation Check Complete!')
    console.log('='.repeat(60))
    console.log(`📊 Batches run: ${batch + 1}`)
    console.log(`✅ Updated: ${totalUpdated}`)
    console.log(`❌ Errors: ${totalErrors}`)
    console.log(`⏳ Remaining: ${remaining}`)
    console.log('='.repeat(60))
    
    if (totalUpdated > 0) {
      console.log('\n💡 Visit /validation dashboard to see updated stats!\n')
    } else if (remaining > 0) {
      console.log('\n⏳ Remaining validations are for games not yet finished.\n')
    } else {
      console.log('\n✨ All validations are up to date!\n')
    }

  } catch (error) {
    console.error('❌ Error running validation check:', error.message)
    console.log('\n💡 Make sure your dev server is running on http://localhost:3000\n')
  }
}

runValidationCheck().catch(console.error)



