#!/usr/bin/env node
// Fetch team performance data from ESPN API and store in database
// This data powers the honest edge calculation model

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// DB team IDs don't match ESPN's API IDs for MLB — map them explicitly
const MLB_ESPN_IDS = {
  'MLB_109': '29',   // ARI
  'MLB_133': '11',   // ATH/OAK
  'MLB_144': '15',   // ATL
  'MLB_110': '1',    // BAL
  'MLB_111': '2',    // BOS
  'MLB_112': '16',   // CHC
  'MLB_4':   '4',    // CHW
  'MLB_113': '17',   // CIN
  'MLB_114': '5',    // CLE
  'MLB_115': '27',   // COL
  'MLB_145': '4',    // CWS (same as CHW)
  'MLB_116': '6',    // DET
  'MLB_117': '18',   // HOU
  'MLB_118': '7',    // KC
  'MLB_108': '3',    // LAA
  'MLB_119': '19',   // LAD
  'MLB_146': '28',   // MIA
  'MLB_158': '8',    // MIL
  'MLB_142': '9',    // MIN
  'MLB_121': '21',   // NYM
  'MLB_147': '10',   // NYY
  'MLB_143': '22',   // PHI
  'MLB_134': '23',   // PIT
  'MLB_135': '25',   // SD
  'MLB_136': '12',   // SEA
  'MLB_137': '26',   // SF
  'MLB_138': '24',   // STL
  'MLB_139': '30',   // TB
  'MLB_140': '13',   // TEX
  'MLB_141': '14',   // TOR
  'MLB_120': '20',   // WSH
}

console.log('\n📊 Fetching Team Performance Data from ESPN...\n')

async function fetchTeamPerformanceData() {
  try {
    // Get all NFL, NHL, and MLB teams from database
    const { data: teams, error: teamsError } = await supabase
      .from('Team')
      .select('*')
      .in('sport', ['nfl', 'nhl', 'mlb'])
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
        const espnId = (sport === 'mlb' && MLB_ESPN_IDS[team.id])
          ? MLB_ESPN_IDS[team.id]
          : team.id.replace(`${sport.toUpperCase()}_`, '')
        
        const sportEmoji = sport === 'mlb' ? '⚾' : sport === 'nhl' ? '🏒' : '🏈'
        console.log(`\n${sportEmoji} ${team.abbr} (${sport.toUpperCase()}) - ID: ${espnId}`)
        
        // Fetch team data from ESPN
        const baseUrl = sport === 'mlb'
          ? 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb'
          : sport === 'nfl' 
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
      // ESPN provides both avgPointsFor (per-game) and pointsFor (season total).
      // Always prefer the per-game average; only fall back to total if avg is missing.
      if (overallRecord && overallRecord.stats) {
        let totalFor = null, totalAgainst = null, gamesPlayed = null

        for (const stat of overallRecord.stats) {
          const name = stat.name || ''
          const value = parseFloat(stat.value)
          
          if (name === 'avgPointsFor') performanceData.avgPointsLast10 = value
          else if (name === 'pointsFor') totalFor = value

          if (name === 'avgPointsAgainst') performanceData.avgPointsAllowedLast10 = value
          else if (name === 'pointsAgainst') totalAgainst = value

          if (name === 'gamesPlayed') gamesPlayed = value
        }

        // Fall back to computing avg from totals if ESPN didn't provide avg fields
        if (!performanceData.avgPointsLast10 && totalFor && gamesPlayed) {
          performanceData.avgPointsLast10 = totalFor / gamesPlayed
        }
        if (!performanceData.avgPointsAllowedLast10 && totalAgainst && gamesPlayed) {
          performanceData.avgPointsAllowedLast10 = totalAgainst / gamesPlayed
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

