#!/usr/bin/env node
// Fetch team performance data from ESPN API and store in database
// This data powers the honest edge calculation model

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { extractEspnTeamPerformance } from '../lib/team-performance-stats.js'

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

        const { meta, ...performanceData } = extracted
        
        // Update team record in database (existing columns only)
        const { error: updateError } = await supabase
          .from('Team')
          .update(performanceData)
          .eq('id', team.id)
        
        if (updateError) {
          console.error(`  ❌ Error updating team:`, updateError)
          errors++
          continue
        }
        
        console.log(`  ✅ Updated (season stats, not last-10):`)
        if (meta?.gamesPlayed != null) {
          console.log(`     Games played (not persisted): ${meta.gamesPlayed}`)
        }
        if (performanceData.last10Record) {
          console.log(`     Season record (last10Record column): ${performanceData.last10Record}`)
        }
        if (performanceData.homeRecord) {
          console.log(`     Home: ${performanceData.homeRecord}`)
        }
        if (performanceData.awayRecord) {
          console.log(`     Away: ${performanceData.awayRecord}`)
        }
        if (performanceData.avgPointsLast10) {
          console.log(`     Pts/Game: ${performanceData.avgPointsLast10.toFixed(1)}`)
        }
        if (performanceData.avgPointsAllowedLast10) {
          console.log(`     Pts Allowed: ${performanceData.avgPointsAllowedLast10.toFixed(1)}`)
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

