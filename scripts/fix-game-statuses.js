#!/usr/bin/env node

/**
 * Fix game statuses in database - remove "status_" prefix
 * Changes "status_in_progress" -> "in_progress"
 * Changes "status_scheduled" -> "scheduled"
 * Changes "status_final" -> "final"
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function fixStatuses() {
  console.log('🔧 Fixing game statuses in database...\n')
  
  // Get all games with status_ prefix
  const { data: games, error } = await supabase
    .from('Game')
    .select('id, status, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)')
    .like('status', 'status_%')
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  if (!games || games.length === 0) {
    console.log('✅ No games with status_ prefix found - all statuses are clean!')
    return
  }
  
  console.log(`📊 Found ${games.length} games with status_ prefix\n`)
  
  // Group by status
  const byStatus = {}
  games.forEach(g => {
    if (!byStatus[g.status]) {
      byStatus[g.status] = []
    }
    byStatus[g.status].push(g)
  })
  
  console.log('📋 Statuses to fix:\n')
  Object.keys(byStatus).forEach(status => {
    const cleanStatus = status.replace(/^status_/i, '')
    console.log(`  "${status}" → "${cleanStatus}" (${byStatus[status].length} games)`)
  })
  
  console.log('\n🔧 Updating statuses...\n')
  
  let updated = 0
  let errors = 0
  
  for (const [oldStatus, gameList] of Object.entries(byStatus)) {
    const newStatus = oldStatus.replace(/^status_/i, '')
    
    const gameIds = gameList.map(g => g.id)
    
    const { error: updateError } = await supabase
      .from('Game')
      .update({ status: newStatus })
      .in('id', gameIds)
    
    if (updateError) {
      console.error(`  ❌ Error updating ${oldStatus}: ${updateError.message}`)
      errors++
    } else {
      console.log(`  ✅ Updated ${gameList.length} games: "${oldStatus}" → "${newStatus}"`)
      updated += gameList.length
    }
  }
  
  console.log(`\n📊 Summary:`)
  console.log(`  ✅ Updated: ${updated} games`)
  if (errors > 0) {
    console.log(`  ❌ Errors: ${errors}`)
  }
  console.log(`\n✅ Status fix complete!`)
}

fixStatuses().catch(console.error)

