#!/usr/bin/env node
// Clear all edge snapshots to recalculate with honest models

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

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

