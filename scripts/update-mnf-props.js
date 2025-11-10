// Force update the expiresAt for MNF props to make them valid
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function updateMNFProps() {
  console.log('🔄 Updating Monday Night Football props...\n')
  
  const newExpiresAt = new Date()
  newExpiresAt.setHours(newExpiresAt.getHours() + 24) // Valid for 24 hours
  
  const newFetchedAt = new Date().toISOString()
  
  const { data, error } = await supabase
    .from('PlayerPropCache')
    .update({
      expiresAt: newExpiresAt.toISOString(),
      fetchedAt: newFetchedAt,
      isStale: false
    })
    .eq('gameId', 'PHI_at_GB_2025-11-10')
    .select()
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log(`✅ Updated ${data?.length || 0} props`)
  console.log(`   New expiresAt: ${newExpiresAt.toISOString()}`)
  console.log(`   New fetchedAt: ${newFetchedAt}`)
}

updateMNFProps()

