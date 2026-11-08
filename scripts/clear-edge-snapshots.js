#!/usr/bin/env node
import { sanitizeLoggedValue } from '../lib/sanitize-error.js'
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
  console.error('❌ Error:', sanitizeLoggedValue(error))
} else {
  console.log('✅ All EdgeSnapshot records cleared\n')
}

