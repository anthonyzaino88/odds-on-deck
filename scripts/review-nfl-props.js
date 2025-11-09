#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function main() {
  console.log('\n🏈 NFL PROPS REVIEW')
  console.log('='.repeat(80))
  
  // Check NFL props
  console.log('\n📊 Step 1: Checking NFL Props in Database...\n')
  const { data: nflProps } = await supabase
    .from('PlayerPropCache')
    .select('*')
    .eq('sport', 'nfl')
  
  console.log(`Total NFL props: ${nflProps?.length || 0}`)
  
  if (nflProps && nflProps.length > 0) {
    const fresh = nflProps.filter(p => !p.isStale && new Date(p.expiresAt) > new Date())
    const stale = nflProps.length - fresh.length
    
    console.log(`  Fresh: ${fresh.length}`)
    console.log(`  Stale: ${stale}`)
    
    console.log('\nSample props:')
    nflProps.slice(0, 5).forEach(p => {
      console.log(`  ${p.playerName} - ${p.type} ${p.pick} ${p.threshold}`)
      console.log(`    Odds: ${p.odds} | Edge: ${(p.edge*100).toFixed(1)}% | Quality: ${p.qualityScore}`)
    })
  }
  
  // Check NFL games
  console.log('\n\n🏈 Step 2: Checking Upcoming NFL Games...\n')
  const now = new Date()
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  
  const { data: nflGames } = await supabase
    .from('Game')
    .select('id, homeId, awayId, date, status, oddsApiEventId')
    .eq('sport', 'nfl')
    .gte('date', now.toISOString())
    .lte('date', weekFromNow.toISOString())
    .order('date')
  
  console.log(`NFL games in next 7 days: ${nflGames?.length || 0}`)
  
  if (nflGames && nflGames.length > 0) {
    const mapped = nflGames.filter(g => g.oddsApiEventId)
    const unmapped = nflGames.length - mapped.length
    
    console.log(`  Mapped to Odds API: ${mapped.length}`)
    console.log(`  Not mapped: ${unmapped}`)
    
    console.log('\nGames list:')
    nflGames.forEach(g => {
      const date = new Date(g.date)
      const dateStr = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      })
      console.log(`  ${dateStr} - ${g.status.padEnd(12)} - Event ID: ${g.oddsApiEventId ? '✅ Mapped' : '❌ Not mapped'}`)
    })
  }
  
  // Recommendation
  console.log('\n\n💡 RECOMMENDATION:')
  console.log('='.repeat(80))
  
  if (!nflProps || nflProps.length === 0) {
    console.log('\n⚠️  No NFL props in database')
    if (nflGames && nflGames.length > 0) {
      const mapped = nflGames.filter(g => g.oddsApiEventId)
      if (mapped.length > 0) {
        console.log('\n✅ Solution: Fetch NFL props')
        console.log('   Run: node scripts/fetch-live-odds.js nfl --cache-fresh')
      } else {
        console.log('\n❌ Problem: NFL games not mapped to Odds API')
        console.log('   First run: node scripts/fetch-live-odds.js nfl --cache-fresh')
        console.log('   This will map games AND fetch props')
      }
    } else {
      console.log('\n❌ Problem: No upcoming NFL games in database')
      console.log('   First fetch NFL games for this week')
    }
  } else {
    console.log('\n✅ NFL props found in database!')
    const fresh = nflProps.filter(p => !p.isStale && new Date(p.expiresAt) > new Date())
    if (fresh.length === 0) {
      console.log('   ⚠️  All props are stale/expired')
      console.log('   Run: node scripts/fetch-live-odds.js nfl --cache-fresh')
    } else {
      console.log(`   ${fresh.length} fresh props available`)
      console.log('   Props are ready to use!')
    }
  }
  
  console.log('\n' + '='.repeat(80) + '\n')
}

main().catch(console.error)

