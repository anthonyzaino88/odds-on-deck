const dotenv = require('dotenv')
const fetch = require('node-fetch')

// Load environment variables
dotenv.config({ path: '.env.local' })

async function validatePendingParlays() {
  console.log('🔍 Validating pending parlays...\n')
  
  try {
    // Call the validation API endpoint
    // Note: This requires the app to be running or use the full URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const url = `${baseUrl}/api/parlays/validate`
    
    console.log(`📡 Calling validation API: ${url}\n`)
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    })
    
    const data = await response.json()
    
    if (data.success) {
      console.log('✅ Validation Complete!\n')
      console.log(`📊 Results:`)
      console.log(`   ✅ Validated: ${data.validated || 0}`)
      console.log(`   🏆 Won: ${data.won || 0}`)
      console.log(`   ❌ Lost: ${data.lost || 0}`)
      console.log(`   ⏳ Still Pending: ${data.pending || 0}`)
      console.log(`\n💬 ${data.message || 'Validation complete'}`)
    } else {
      console.error('❌ Validation failed:', data.error || data.message)
    }
    
  } catch (error) {
    console.error('❌ Error calling validation API:', error.message)
    console.log('\n💡 Make sure your Next.js app is running, or use the web interface:')
    console.log('   - Visit /validation page (auto-validates on load)')
    console.log('   - Visit /parlays page (auto-validates on load)')
  }
}

validatePendingParlays()

