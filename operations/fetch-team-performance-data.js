#!/usr/bin/env node
// Fetch team performance data from ESPN API and store in database
// This data powers the honest edge calculation model

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { extractEspnTeamPerformance, teamPerformanceWritePayload } from '../lib/team-performance-stats.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

console.log('\n📊 Fetching Team Performance Data from ESPN...\n')

async function fetchTeamPerformanceData() {
  try {
    // Get all NFL and NHL teams from database
    const { data: teams, error: teamsError } = await supabase
      .from('Team')
      .select('*')
      .in('sport', ['nfl', 'nhl'])
      .order('sport')
      .order('abbr')
    
    if (teamsError) {
      console.error('❌ Error fetching teams:', teamsError)
      return
    }
    
    console.log(`Found ${teams.length} teams to update\n`)
    
    let updated = 0
    let errors = 0
    
    for (const team of teams) {
      try {
        const sport = team.sport
        const espnId = team.espnId || team.id.replace(`${sport.toUpperCase()}_`, '')
        
        console.log(`\n🏈 ${team.abbr} (${sport.toUpperCase()}) - ID: ${espnId}`)
        
        // Fetch team data from ESPN
        const baseUrl = sport === 'nfl' 
          ? 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'
          : 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl'
        
        const url = `${baseUrl}/teams/${espnId}?enable=record,stats`
        
        const response = await fetch(url, {
          headers: { 'User-Agent': 'OddsOnDeck/1.0' }
        })
        
        if (!response.ok) {
          console.error(`  ❌ ESPN API error: ${response.status}`)
          errors++
          continue
        }
        
        const data = await response.json()
        
        const extracted = extractEspnTeamPerformance(data, sport)
        
        if (!extracted) {
          console.log(`  ⚠️  No performance data available`)
          continue
        }

        const { meta } = extracted
        const write = teamPerformanceWritePayload(extracted)
        if (write.written.length === 0) {
          console.log(`  ⚠️  Partial ESPN payload had no usable fields — existing Team row left unchanged`)
          continue
        }
        
        const { error: updateError } = await supabase
          .from('Team')
          .update(write.payload)
          .eq('id', team.id)
        
        if (updateError) {
          console.error(`  ❌ Error updating team:`, updateError)
          errors++
          continue
        }
        
        console.log(`  ✅ Wrote present season fields only: ${write.written.join(', ')}`)
        if (write.retained.length) {
          console.log(`     Retained prior values (not marked fresh): ${write.retained.join(', ')}`)
        }
        if (meta?.gamesPlayed != null) {
          console.log(`     Games played (not persisted): ${meta.gamesPlayed}`)
        }
        if (write.payload.last10Record) {
          console.log(`     Season record (last10Record column): ${write.payload.last10Record}`)
        }
        if (write.payload.homeRecord) {
          console.log(`     Home: ${write.payload.homeRecord}`)
        }
        if (write.payload.awayRecord) {
          console.log(`     Away: ${write.payload.awayRecord}`)
        }
        if (write.payload.avgPointsLast10) {
          console.log(`     Pts/Game: ${write.payload.avgPointsLast10.toFixed(1)}`)
        }
        if (write.payload.avgPointsAllowedLast10) {
          console.log(`     Pts Allowed: ${write.payload.avgPointsAllowedLast10.toFixed(1)}`)
        }
        
        updated++
        
        // Small delay to be nice to ESPN API
        await new Promise(resolve => setTimeout(resolve, 100))
        
      } catch (error) {
        console.error(`  ❌ Error processing ${team.abbr}:`, error.message)
        errors++
      }
    }
    
    console.log(`\n📊 Summary:`)
    console.log(`   ✅ Updated: ${updated} teams`)
    console.log(`   ❌ Errors: ${errors}`)
    console.log(`\n✅ Team performance data fetch complete!\n`)
    
  } catch (error) {
    console.error('❌ Fatal error:', error)
  }
}

// Run the fetch
fetchTeamPerformanceData()

