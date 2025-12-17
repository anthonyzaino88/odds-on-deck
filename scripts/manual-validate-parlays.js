#!/usr/bin/env node

/**
 * MANUAL PARLAY VALIDATION
 *
 * This script lets us atomically mark specific parlay records as
 * completed in Supabase when the API/automation misses player stats
 * or the prop validation pipeline never finished.
 *
 * Usage:
 *   node scripts/manual-validate-parlays.js
 */

import { config } from 'dotenv'
import { supabaseAdmin } from '../lib/supabase-admin.js'

config({ path: '.env.local' })

const PARLAY_UPDATES = [
  {
    id: '17657354',
    sport: 'nfl',
    status: 'lost',
    outcome: 'lost',
    actualResult: 'Manual validation: 2 misses (Mariota rush yards, Singletary receiving yards)',
    legs: [
      {
        playerName: 'Marcus Mariota',
        propType: 'player_rush_yds',
        result: 'lost',
        actualResult: 'Actual: 43 rush yards (CBS Sports)',
        notes: 'CBS Sports recorded 43 rush yards – failed under 34.5'
      },
      {
        playerName: 'Terry McLaurin',
        propType: 'player_receptions',
        result: 'won',
        actualResult: 'Actual: 3 receptions (CBS Sports)',
        notes: 'CBS Sports recorded 3 receptions – hit under 3.5'
      },
      {
        playerName: 'Devin Singletary',
        propType: 'player_reception_yds',
        result: 'lost',
        actualResult: 'Actual: 1 reception, 1 yard (ESPN.com)',
        notes: 'ESPN.com recorded 1 reception/1 yard – failed over 3.5'
      }
    ]
  },
  {
    id: '17657352',
    sport: 'nfl',
    status: 'lost',
    outcome: 'lost',
    actualResult: 'Manual validation: 4 misses (Croskey-Merritt, Whyle, Gibbs, Zaccheaus)',
    legs: [
      {
        playerName: 'Jacory Croskey-Merritt',
        propType: 'player_receptions',
        result: 'lost',
        actualResult: 'Actual: 0 receptions (CBS Sports)',
        notes: 'CBS Sports recorded 0 receptions – failed over 0.5'
      },
      {
        playerName: 'Josh Whyle',
        propType: 'player_receptions',
        result: 'lost',
        actualResult: 'Actual: 0 receptions (NFL.com)',
        notes: 'NFL.com recorded 0 receptions – failed over 0.5'
      },
      {
        playerName: 'Isaiah Hodgins',
        propType: 'player_receptions',
        result: 'won',
        actualResult: 'Actual: 1 reception (CBS Sports)',
        notes: 'CBS Sports recorded 1 reception – hit under 2.5'
      },
      {
        playerName: 'Jahmyr Gibbs',
        propType: 'player_receptions',
        result: 'lost',
        actualResult: 'Actual: 4 receptions (NFL.com)',
        notes: 'NFL.com recorded 4 receptions – failed over 4.5'
      },
      {
        playerName: 'Olamide Zaccheaus',
        propType: 'player_receptions',
        result: 'lost',
        actualResult: 'Actual: 0 receptions (ESPN.com)',
        notes: 'ESPN.com recorded 0 receptions – failed over 0.5'
      }
    ]
  },
  {
    id: '17657351',
    sport: 'nfl',
    status: 'won',
    outcome: 'won',
    actualResult: 'Manual validation: 3 hits (Likely, Burden III, Moore)',
    legs: [
      {
        playerName: 'Isaiah Likely',
        propType: 'player_reception_yds',
        result: 'won',
        actualResult: 'Actual: 0 receiving yards (NFL.com)',
        notes: 'NFL.com recorded 0 yards – hit under 40.5'
      },
      {
        playerName: 'Luther Burden III',
        propType: 'player_reception_yds',
        result: 'won',
        actualResult: 'Actual: 84 receiving yards (NFL.com)',
        notes: 'NFL.com recorded 84 yards – hit over 25.5'
      },
      {
        playerName: 'DJ Moore',
        propType: 'player_reception_yds',
        result: 'won',
        actualResult: 'Actual: 69 receiving yards (NFL.com)',
        notes: 'NFL.com recorded 69 yards – hit over 25.5'
      }
    ]
  },
  {
    id: '17657351',
    sport: 'nhl',
    status: 'lost',
    outcome: 'lost',
    actualResult: 'Manual validation: 1 miss (Dahlin), 2 hits',
    legs: [
      {
        playerName: 'Rasmus Dahlin',
        propType: 'player_points',
        result: 'lost',
        actualResult: 'Actual: 0 points (ESPN.com)',
        notes: 'ESPN.com recorded 0 points – failed over 0.5'
      },
      {
        playerName: 'Bryan Rust',
        propType: 'player_points',
        result: 'won',
        actualResult: 'Actual: 1 point (ESPN.com)',
        notes: 'ESPN.com recorded 1 point – hit over 0.5'
      },
      {
        playerName: 'Ben Kindel',
        propType: 'player_shots_on_goal',
        result: 'won',
        actualResult: 'Actual: 2 shots on goal (ESPN.com)',
        notes: 'ESPN.com recorded 2 SOG – hit under 2.5'
      }
    ]
  }
]

async function main() {
  console.log('🔁 Manual parlay validation updates')

  for (const parlay of PARLAY_UPDATES) {
    console.log(`\n🧾 Updating parlay ${parlay.id}`)

    let parlayQuery = supabaseAdmin
      .from('Parlay')
      .update({
        status: parlay.status,
        outcome: parlay.outcome,
        actualResult: parlay.actualResult,
        updatedAt: new Date().toISOString()
      })
      .eq('id', parlay.id)

    if (parlay.sport) {
      parlayQuery = parlayQuery.eq('sport', parlay.sport)
    }

    const { error: parlayError } = await parlayQuery

    if (parlayError) {
      console.error(`  ❌ Failed to update parlay ${parlay.id}:`, parlayError.message)
      continue
    }

    for (const leg of parlay.legs) {
      const { error: legError, data: legData } = await supabaseAdmin
        .from('ParlayLeg')
        .update({
          outcome: leg.result,
          actualResult: leg.actualResult,
          notes: leg.notes,
          updatedAt: new Date().toISOString()
        })
        .eq('parlayId', parlay.id)
        .eq('playerName', leg.playerName)
        .eq('propType', leg.propType)

      if (legError) {
        console.error(`  ⚠️  ${leg.playerName} ${leg.propType}:`, legError.message)
        continue
      }

      if (!legData || legData.length === 0) {
        console.warn(`  ⚠️  ${leg.playerName} ${leg.propType}: no matching leg found`)
      } else {
        console.log(`  ✅ ${leg.playerName} ${leg.propType}: marked as ${leg.result}`);
      }
    }
  }
}

main()
  .then(() => {
    console.log('\n✅ Manual parlay validation complete')
    process.exit(0)
  })
  .catch(error => {
    console.error('❌ Fatal error:', error.message)
    process.exit(1)
  })

