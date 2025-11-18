#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Get today's date
const today = new Date().toISOString().split('T')[0]

const { data, error } = await supabase
  .from('Game')
  .select('id, homeId, awayId, sport, date, status, espnGameId, home:homeId(name, abbr), away:awayId(name, abbr)')
  .eq('sport', 'nhl')
  .gte('date', today + 'T00:00:00Z')
  .order('date')
  .limit(20)

console.log('Error:', error)
console.log('NHL Games with ESPN IDs:')
data?.forEach(g => {
  if (g.away.abbr === 'VAN' && g.home.abbr === 'CAR') {
    console.log(`🎯 VAN @ CAR - ESPN ID: ${g.espnGameId} - ${new Date(g.date).toISOString()} - ${new Date(g.date).toLocaleString('en-US', {timeZone: 'America/New_York'})} EST`)
  }
})
