#!/usr/bin/env node
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createScriptSupabaseClient()

const { data } = await supabase
  .from('Game')
  .select('id, homeTeam, awayTeam, date, status')
  .eq('sport', 'nhl')
  .gte('date', '2025-11-08')
  .order('date')

console.log('\nNHL Games in DB (Nov 8+):\n')
data?.forEach(g => console.log(`${g.id} - ${g.awayTeam} @ ${g.homeTeam} (${g.status})`))
console.log(`\nTotal: ${data?.length || 0}\n`)



