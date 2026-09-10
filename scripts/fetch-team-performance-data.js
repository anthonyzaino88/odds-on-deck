#!/usr/bin/env node
// Fetch team performance data from ESPN API and store in database
// This data powers the honest edge calculation model

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { extractEspnTeamPerformance } from '../lib/team-performance-stats.js'

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
        
        // Extract team performance data.
        // last10* columns are season aggregates — see extractEspnTeamPerformance.
        const extracted = extractEspnTeamPerformance(data, sport)
        
        if (!extracted) {
          console.log(`  ⚠️  No performance data available`)
          continue
        }

        const { meta, ...performanceData } = extracted
        
        // Update team record in database (existing columns only — do not invent schema)
        const { error: updateError } = await supabase
          .from('Team')
          .update(performanceData)
          .eq('id', team.id)
        
        if (updateError) {
          console.error(`  ❌ Error updating team:`, updateError)
          errors++
          continue
        }
        
        // Log what we got — label season stats honestly
        console.log(`  ✅ Updated (season stats, not last-10):`)
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
          console.log(`     Season pts/game (avgPointsLast10 column): ${performanceData.avgPointsLast10.toFixed(1)}`)
        }
        if (performanceData.avgPointsAllowedLast10) {
          console.log(`     Season pts allowed (avgPointsAllowedLast10 column): ${performanceData.avgPointsAllowedLast10.toFixed(1)}`)
        }
        if (meta?.gamesPlayed != null) {
          console.log(`     Games played (not persisted — schema proposal only): ${meta.gamesPlayed}`)
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

