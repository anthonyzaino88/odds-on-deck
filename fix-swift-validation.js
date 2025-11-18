import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixValidation() {
  try {
    // Manually complete the D'Andre Swift validation
    const { data, error } = await supabase
      .from('PropValidation')
      .update({
        status: 'completed',
        result: 'correct',
        actualValue: 25.5,
        completedAt: new Date().toISOString()
      })
      .eq('playerName', "D'Andre Swift")
      .eq('propType', 'player_reception_yds')
      .eq('status', 'needs_review')

    if (error) throw error
    console.log('✅ Manually completed D\'Andre Swift validation')
  } catch (e) {
    console.log('Error:', e.message)
  }
}

fixValidation()
