#!/usr/bin/env node
// Fetch team performance data from ESPN API and store in database
// This data powers the honest edge calculation model

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { extractEspnTeamPerformance, teamPerformanceWritePayload } from '../lib/team-performance-stats.js'

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

        const { meta } = extracted
        const write = teamPerformanceWritePayload(extracted)
        if (write.written.length === 0) {
          console.log(`  ⚠️  Partial ESPN payload had no usable fields — existing Team row left unchanged`)
          continue
        }
        
        // Update only present columns. Omitted fields stay as stored.
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
          console.log(`     Season pts/game (avgPointsLast10 column): ${write.payload.avgPointsLast10.toFixed(1)}`)
        }
        if (write.payload.avgPointsAllowedLast10) {
          console.log(`     Season pts allowed (avgPointsAllowedLast10 column): ${write.payload.avgPointsAllowedLast10.toFixed(1)}`)
        }
        if (write.payload.season) {
          console.log(`     Season: ${write.payload.season}`)
        }
        if (write.payload.gamesPlayed != null) {
          console.log(`     Games played: ${write.payload.gamesPlayed}`)
        }
        if (write.payload.statsKind) {
          console.log(`     statsKind: ${write.payload.statsKind}`)
        }
        if (write.payload.statsCapturedAt) {
          console.log(`     statsCapturedAt: ${write.payload.statsCapturedAt}`)
        }
        if (write.payload.statsDataThrough) {
          console.log(`     statsDataThrough: ${write.payload.statsDataThrough}`)
        } else if (write.representsFullRefresh && meta?.dataThrough == null) {
          console.log(`     statsDataThrough omitted (ESPN payload had no last completed game)`)
        } else if (!write.freshnessTimestampsWritten) {
          console.log(`     Freshness timestamps retained (partial extract, not marked fresh)`)
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

