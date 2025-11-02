#!/usr/bin/env node

/**
 * MAP ESPN TEAM IDs TO OUR DATABASE
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function main() {
  console.log('🔍 Getting ESPN games and our teams...\n')
  
  // Fetch NFL games from ESPN
  const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard')
  const data = await response.json()
  const events = data.events.slice(0, 3)
  
  console.log('📺 Sample ESPN Games:')
  events.forEach(event => {
    const home = event.competitions[0].competitors[0]
    const away = event.competitions[0].competitors[1]
    console.log(`  ${away.team.abbreviation} (ID: ${away.team.id}) @ ${home.team.abbreviation} (ID: ${home.team.id})`)
  })
  
  // Get our teams
  const { data: teams } = await supabase
    .from('Team')
    .select('id, abbr, name, sport')
    .eq('sport', 'nfl')
  
  console.log('\n📊 Our NFL Team IDs:')
  teams.slice(0, 5).forEach(team => {
    console.log(`  ${team.abbr}: ID = "${team.id}"`)
  })
}

main()
