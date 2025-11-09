#!/usr/bin/env node
/**
 * RUN VALIDATION CHECK
 * 
 * Simple script to trigger the validation check endpoint
 */

import { config } from 'dotenv'

config({ path: '.env.local' })

async function runValidationCheck() {
  console.log('\n🔍 Running Validation Check...\n')
  
  try {
    const response = await fetch('http://localhost:3000/api/validation/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    })
    
    const data = await response.json()
    
    if (data.success) {
      console.log('✅ Validation Check Complete!')
      console.log('='.repeat(60))
      console.log(`📊 Checked: ${data.message}`)
      console.log(`✅ Updated: ${data.updated}`)
      console.log(`❌ Errors: ${data.errors}`)
      console.log(`⏳ Remaining: ${data.remaining}`)
      console.log('='.repeat(60))
      
      if (data.updated > 0) {
        console.log('\n💡 Visit /validation dashboard to see updated stats!\n')
      } else if (data.remaining > 0) {
        console.log('\n⏳ Remaining validations are for games not yet finished.\n')
      } else {
        console.log('\n✨ All validations are up to date!\n')
      }
    } else {
      console.error('❌ Validation check failed:', data.error)
    }
  } catch (error) {
    console.error('❌ Error running validation check:', error.message)
    console.log('\n💡 Make sure your dev server is running on http://localhost:3000\n')
  }
}

runValidationCheck().catch(console.error)



