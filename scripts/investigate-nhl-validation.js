import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function investigateNHLIssue() {
  console.log('\n🔍 INVESTIGATING NHL VALIDATION ISSUE\n')
  
  // 1. Get a sample "needs_review" validation
  const { data: needsReview } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('sport', 'nhl')
    .eq('status', 'needs_review')
    .limit(1)
    .single()
  
  if (needsReview) {
    console.log('Sample needs_review NHL validation:')
    console.log(JSON.stringify(needsReview, null, 2))
    
    console.log(`\nTrying to find game with ID: ${needsReview.gameIdRef}`)
    
    // Try different lookups
    const { data: byId } = await supabase
      .from('Game')
      .select('*')
      .eq('id', needsReview.gameIdRef)
      .maybeSingle()
    
    console.log(`\n1. Lookup by game.id = "${needsReview.gameIdRef}":`, byId ? '✅ FOUND' : '❌ NOT FOUND')
    if (byId) {
      console.log('   Game:', JSON.stringify(byId, null, 2))
    }
    
    const { data: byEspnId } = await supabase
      .from('Game')
      .select('*')
      .eq('espnGameId', needsReview.gameIdRef)
      .eq('sport', 'nhl')
      .maybeSingle()
    
    console.log(`\n2. Lookup by game.espnGameId = "${needsReview.gameIdRef}":`, byEspnId ? '✅ FOUND' : '❌ NOT FOUND')
    if (byEspnId) {
      console.log('   Game:', JSON.stringify(byEspnId, null, 2))
    }
    
    // Check if there are ANY NHL games
    const { data: anyNHL } = await supabase
      .from('Game')
      .select('id, espnGameId, home, away, date, status')
      .eq('sport', 'nhl')
      .limit(5)
    
    console.log(`\n3. Sample NHL games in database:`)
    anyNHL?.forEach(g => {
      console.log(`   ${g.id} (espnGameId: ${g.espnGameId}) - ${g.home} vs ${g.away}`)
    })
  }
  
  // 2. Check a pending validation
  const { data: pending } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('sport', 'nhl')
    .eq('status', 'pending')
    .limit(1)
    .single()
  
  if (pending) {
    console.log('\n\nSample pending NHL validation:')
    console.log(JSON.stringify(pending, null, 2))
    
    // Try to find its game
    const { data: game } = await supabase
      .from('Game')
      .select('*')
      .eq('id', pending.gameIdRef)
      .maybeSingle()
    
    console.log(`\nGame for pending validation:`, game ? '✅ FOUND' : '❌ NOT FOUND')
    if (game) {
      console.log(JSON.stringify(game, null, 2))
    }
  }
}

investigateNHLIssue().catch(console.error)
