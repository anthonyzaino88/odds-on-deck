#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

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



