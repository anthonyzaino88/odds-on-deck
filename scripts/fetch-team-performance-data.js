#!/usr/bin/env node
// Fetch team performance data from ESPN API and store in database
// This data powers the honest edge calculation model

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

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
        
        // Extract team performance data
        const performanceData = extractPerformanceData(data, sport)
        
        if (!performanceData) {
          console.log(`  ⚠️  No performance data available`)
          continue
        }
        
        // Update team record in database
        const { error: updateError } = await supabase
          .from('Team')
          .update(performanceData)
          .eq('id', team.id)
        
        if (updateError) {
          console.error(`  ❌ Error updating team:`, updateError)
          errors++
          continue
        }
        
        // Log what we got
        console.log(`  ✅ Updated:`)
        if (performanceData.last10Record) {
          console.log(`     Record: ${performanceData.last10Record}`)
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

/**
 * Extract performance data from ESPN team response
 */
function extractPerformanceData(data, sport) {
  try {
    const team = data.team
    if (!team) return null
    
    const performanceData = {}
    
    // Get overall record
    if (team.record && team.record.items) {
      const overallRecord = team.record.items.find(item => item.type === 'total' || item.type === 'overall')
      const homeRecord = team.record.items.find(item => item.type === 'home')
      const awayRecord = team.record.items.find(item => item.type === 'road' || item.type === 'away')
      
      if (overallRecord && overallRecord.summary) {
        performanceData.last10Record = overallRecord.summary // e.g., "7-2"
      }
      
      if (homeRecord && homeRecord.summary) {
        performanceData.homeRecord = homeRecord.summary
      }
      
      if (awayRecord && awayRecord.summary) {
        performanceData.awayRecord = awayRecord.summary
      }
      
      // Extract stats from the overall record
      if (overallRecord && overallRecord.stats) {
        for (const stat of overallRecord.stats) {
          const name = stat.name || ''
          const value = parseFloat(stat.value)
          
          // Points/Goals per game
          if (name === 'avgPointsFor' || name === 'pointsFor') {
            performanceData.avgPointsLast10 = value
          }
          
          // Points/Goals against per game
          if (name === 'avgPointsAgainst' || name === 'pointsAgainst') {
            performanceData.avgPointsAllowedLast10 = value
          }
          
          // Skip gamesPlayed - column doesn't exist in Team table
        }
      }
    }
    
    // If we didn't get avgPoints, try team.statistics
    if (!performanceData.avgPointsLast10 && team.statistics) {
      for (const stat of team.statistics) {
        if (stat.name === 'avgPointsFor' || stat.name === 'pointsPerGame') {
          performanceData.avgPointsLast10 = parseFloat(stat.value)
        }
        if (stat.name === 'avgPointsAgainst' || stat.name === 'pointsAllowedPerGame') {
          performanceData.avgPointsAllowedLast10 = parseFloat(stat.value)
        }
      }
    }
    
    // Return null if we got no useful data
    if (!performanceData.last10Record && !performanceData.avgPointsLast10 && !performanceData.homeRecord) {
      return null
    }
    
    return performanceData
    
  } catch (error) {
    console.error('Error extracting performance data:', error.message)
    return null
  }
}

// Run the fetch
fetchTeamPerformanceData()

