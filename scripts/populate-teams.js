#!/usr/bin/env node

/**
 * POPULATE TEAMS FROM GAMES DATA
 * Extracts unique teams from games to ensure ID matching
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function extractTeamsFromGames(sport) {
  try {
    console.log(`\n🔄 Fetching ${sport.toUpperCase()} games from ESPN...`)
    
    const league = sport === 'nfl' ? 'football/nfl' : 'hockey/nhl'
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard`
    
    const response = await fetch(url)
    if (!response.ok) throw new Error(`ESPN API error: ${response.status}`)
    
    const data = await response.json()
    const events = data.events || []
    
    console.log(`✅ Found ${events.length} games`)
    
    // Extract unique teams from games
    const teamsMap = new Map()
    
    events.forEach(event => {
      const competition = event.competitions?.[0]
      const home = competition?.competitors?.[0]
      const away = competition?.competitors?.[1]
      
      // Add home team
      if (home?.team) {
        const teamId = `${sport.toUpperCase()}_${home.team.id}`
        if (!teamsMap.has(teamId)) {
          teamsMap.set(teamId, {
            id: teamId,
            name: home.team.displayName,
            abbr: home.team.abbreviation,
            sport: sport.toLowerCase()
          })
        }
      }
      
      // Add away team
      if (away?.team) {
        const teamId = `${sport.toUpperCase()}_${away.team.id}`
        if (!teamsMap.has(teamId)) {
          teamsMap.set(teamId, {
            id: teamId,
            name: away.team.displayName,
            abbr: away.team.abbreviation,
            sport: sport.toLowerCase()
          })
        }
      }
    })
    
    return Array.from(teamsMap.values())
  } catch (error) {
    console.error(`❌ Error extracting ${sport} teams:`, error.message)
    return []
  }
}

async function saveTeamsToSupabase(sport, teams) {
  if (!teams.length) {
    console.log(`⚠️  No teams to save for ${sport.toUpperCase()}`)
    return 0
  }

  try {
    console.log(`💾 Saving ${teams.length} ${sport.toUpperCase()} teams...`)
    
    // Upsert teams
    const { error } = await supabase
      .from('Team')
      .upsert(teams, { onConflict: 'id' })
    
    if (error) throw error
    
    console.log(`✅ Saved ${teams.length} teams`)
    return teams.length
  } catch (error) {
    console.error(`❌ Error saving teams:`, error.message)
    return 0
  }
}

async function main() {
  console.log('🎯 POPULATE TEAMS FROM GAMES DATA')
  console.log(''.padEnd(50, '='))
  
  let totalSaved = 0
  
  for (const sport of ['nfl', 'nhl']) {
    const teams = await extractTeamsFromGames(sport)
    totalSaved += await saveTeamsToSupabase(sport, teams)
    await new Promise(r => setTimeout(r, 1000))
  }
  
  console.log('\n' + ''.padEnd(50, '='))
  console.log(`📊 TOTAL TEAMS SAVED: ${totalSaved}`)
  console.log('✅ Teams populated!')
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
