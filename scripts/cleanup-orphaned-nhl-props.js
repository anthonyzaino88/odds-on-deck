#!/usr/bin/env node
/**
 * CLEAN UP ORPHANED NHL PROPS
 * 
 * Delete NHL props that reference non-existent games
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function cleanupOrphanedProps() {
  console.log('\n🧹 CLEANING UP ORPHANED NHL PROPS\n')
  console.log('='.repeat(80))
  
  // Get all NHL props
  const { data: nhlProps } = await supabase
    .from('PropValidation')
    .select('id, gameIdRef, playerName, propType')
    .eq('sport', 'nhl')
  
  console.log(`\n📊 Found ${nhlProps?.length || 0} NHL props\n`)
  
  if (!nhlProps || nhlProps.length === 0) {
    console.log('✅ No NHL props to clean up\n')
    return
  }
  
  // Check which props have valid games
  let orphaned = []
  let valid = []
  
  console.log('🔍 Checking for orphaned props...\n')
  
  for (const prop of nhlProps) {
    const { data: game } = await supabase
      .from('Game')
      .select('id')
      .eq('id', prop.gameIdRef)
      .maybeSingle()
    
    if (!game) {
      orphaned.push(prop)
    } else {
      valid.push(prop)
    }
  }
  
  console.log(`Results:`)
  console.log(`  ✅ Valid props (game exists): ${valid.length}`)
  console.log(`  ❌ Orphaned props (no game): ${orphaned.length}`)
  
  if (orphaned.length === 0) {
    console.log('\n✅ No orphaned props found!\n')
    return
  }
  
  console.log(`\n⚠️  WARNING: About to delete ${orphaned.length} orphaned props`)
  console.log('   These props reference games that no longer exist in the database.')
  console.log('   This is safe to do - they cannot be validated anyway.\n')
  
  // Delete orphaned props
  console.log('🗑️  Deleting orphaned props...\n')
  
  const orphanedIds = orphaned.map(p => p.id)
  
  const { error } = await supabase
    .from('PropValidation')
    .delete()
    .in('id', orphanedIds)
  
  if (error) {
    console.error('❌ Error deleting props:', error)
    return
  }
  
  console.log('='.repeat(80))
  console.log(`✅ CLEANUP COMPLETE!`)
  console.log(`   Deleted: ${orphaned.length} orphaned props`)
  console.log(`   Remaining: ${valid.length} valid props`)
  console.log('\n💡 Your validation system is now clean!')
  console.log('   Start fresh by saving new NHL props for tonight\'s games.\n')
}

cleanupOrphanedProps().catch(console.error)


