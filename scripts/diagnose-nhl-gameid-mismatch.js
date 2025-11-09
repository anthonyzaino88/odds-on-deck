#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function diagnoseGameIdMismatch() {
  console.log('\n🔍 DIAGNOSING NHL GAME ID MISMATCH\n')
  console.log('='.repeat(80))
  
  // Get one NHL prop
  const { data: props } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('sport', 'nhl')
    .limit(1)
    .single()
  
  console.log('\n📊 Sample NHL Prop:')
  console.log(`   gameIdRef: ${props.gameIdRef}`)
  console.log(`   playerName: ${props.playerName}`)
  console.log(`   saved: ${new Date(props.timestamp).toLocaleString()}`)
  
  // Try to find this game
  console.log('\n🔍 Looking for game in database...\n')
  
  // Try exact match
  const { data: exactMatch } = await supabase
    .from('Game')
    .select('*')
    .eq('id', props.gameIdRef)
    .maybeSingle()
  
  if (exactMatch) {
    console.log('✅ Found by exact ID match')
    console.log(JSON.stringify(exactMatch, null, 2))
  } else {
    console.log('❌ No exact ID match')
    
    // Try to parse the gameIdRef
    const parts = props.gameIdRef.split('_')
    console.log(`   Parsed: away=${parts[0]}, at=${parts[1]}, home=${parts[2]}, date=${parts.slice(4).join('-')}`)
    
    // Look for NHL games around that date
    const targetDate = props.gameIdRef.split('_').slice(-1)[0] // Get date part
    console.log(`\n🔍 Looking for NHL games on ${targetDate}...\n`)
    
    const { data: gamesOnDate } = await supabase
      .from('Game')
      .select('id, homeTeam, awayTeam, sport, date, espnGameId')
      .eq('sport', 'nhl')
      .gte('date', `${targetDate}T00:00:00Z`)
      .lte('date', `${targetDate}T23:59:59Z`)
    
    if (gamesOnDate && gamesOnDate.length > 0) {
      console.log(`✅ Found ${gamesOnDate.length} NHL games on that date:\n`)
      gamesOnDate.forEach((game, i) => {
        console.log(`${i+1}. ID: ${game.id}`)
        console.log(`   ${game.awayTeam} @ ${game.homeTeam}`)
        console.log(`   ESPN ID: ${game.espnGameId || 'N/A'}`)
        console.log()
      })
      
      console.log('❌ ISSUE IDENTIFIED:')
      console.log('   PropValidation.gameIdRef uses format: AWAY_at_HOME_YYYY-MM-DD')
      console.log(`   But actual Game.id is different (see above)`)
      console.log('\n💡 SOLUTION:')
      console.log('   When saving props, use the actual Game.id from the database')
      console.log('   NOT a custom formatted string\n')
    } else {
      console.log('❌ No NHL games found on that date')
      console.log('   Games may have been deleted or date format is wrong\n')
    }
  }
}

diagnoseGameIdMismatch().catch(console.error)



