#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function listGames() {
  const { data: games } = await supabase
    .from('Game')
    .select('id, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .eq('sport', 'nhl')
  
  console.log('NHL Games in database:')
  games.forEach(g => {
    console.log(`  ${g.id} - ${g.away?.abbr} @ ${g.home?.abbr}`)
  })
}

listGames().catch(console.error)

