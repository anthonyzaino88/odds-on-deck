#!/usr/bin/env node
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createScriptSupabaseClient()

const { data: nhlProps } = await supabase
  .from('PropValidation')
  .select('sport, status')
  .eq('sport', 'nhl')

const byStatus = nhlProps.reduce((acc, prop) => {
  acc[prop.status] = (acc[prop.status] || 0) + 1
  return acc
}, {})

console.log('\n🏒 NHL Props by Status:\n')
Object.entries(byStatus).forEach(([status, count]) => {
  console.log(`  ${status}: ${count}`)
})
console.log(`\n  Total: ${nhlProps.length}\n`)



