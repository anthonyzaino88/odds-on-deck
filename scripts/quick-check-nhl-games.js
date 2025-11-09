#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const { data } = await supabase
  .from('Game')
  .select('id, homeTeam, awayTeam, date, status')
  .eq('sport', 'nhl')
  .gte('date', '2025-11-08')
  .order('date')

console.log('\nNHL Games in DB (Nov 8+):\n')
data?.forEach(g => console.log(`${g.id} - ${g.awayTeam} @ ${g.homeTeam} (${g.status})`))
console.log(`\nTotal: ${data?.length || 0}\n`)



