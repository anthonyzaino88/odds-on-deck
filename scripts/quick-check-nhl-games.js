#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Get today's date in YYYY-MM-DD format
const today = new Date().toISOString().split('T')[0]

const { data } = await supabase
  .from('Game')
  .select('id, homeTeam, awayTeam, date, status, sport')
  .order('date')
  .limit(20)

console.log(`\nAll Games in DB (showing first 20):\n`)
data?.forEach(g => console.log(`${g.id} - ${g.awayTeam} @ ${g.homeTeam} (${g.sport}, ${g.status})`))
console.log(`\nTotal: ${data?.length || 0}\n`)







