#!/usr/bin/env node
// Clear all edge snapshots to recalculate with honest models

import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createScriptSupabaseClient()

console.log('\n🗑️  Clearing old EdgeSnapshot data...\n')

const { error } = await supabase
  .from('EdgeSnapshot')
  .delete()
  .neq('id', 'none') // Delete all records

if (error) {
  console.error('❌ Error:', error)
} else {
  console.log('✅ All EdgeSnapshot records cleared\n')
}

