#!/usr/bin/env node

/**
 * CLEANUP TEAM IDs - Standardize format to SPORT_ID
 */

import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createScriptSupabaseClient()

async function main() {
  console.log('🔧 CLEANUP TEAM IDs')
  console.log(''.padEnd(50, '='))
  
  // Get all teams
  const { data: teams } = await supabase
    .from('Team')
    .select('id, name, abbr, sport')
  
  console.log(`📊 Found ${teams.length} teams`)
  
  let fixed = 0
  
  for (const team of teams) {
    // Check if ID needs fixing (doesn't start with sport prefix)
    const prefix = team.sport?.toUpperCase() + '_'
    
    if (!team.id.startsWith(prefix)) {
      const oldId = team.id
      const newId = `${prefix}${team.id}`
      
      console.log(`🔄 Fixing: ${oldId} → ${newId} (${team.abbr})`)
      
      // Update team ID
      const { error } = await supabase
        .from('Team')
        .update({ id: newId })
        .eq('id', oldId)
      
      if (error) {
        console.error(`  ❌ Error: ${error.message}`)
      } else {
        console.log(`  ✅ Fixed`)
        fixed++
      }
    }
  }
  
  console.log('\n' + ''.padEnd(50, '='))
  console.log(`✅ Fixed ${fixed} team IDs`)
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
