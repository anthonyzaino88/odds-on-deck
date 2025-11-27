import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// ESPN Team ID to correct team mapping by sport
// This fixes the issue where ESPN uses same IDs for different teams in different sports
const ESPN_TEAM_CORRECTIONS = {
  // NFL games that currently have wrong teams
  'NYJ_at_BAL_2025-11-23': {
    homeId: 'NFL_33', // Baltimore Ravens (not Orioles)
    awayId: 'NFL_20'  // New York Jets
  },
  'MIN_at_GB_2025-11-23': {
    homeId: 'NFL_9',  // Green Bay Packers
    awayId: 'NFL_16'  // Minnesota Vikings (not Twins)
  },
  'BUF_at_HOU_2025-11-21': {
    homeId: 'NFL_34', // Houston Texans (not Astros)
    awayId: 'NFL_2'   // Buffalo Bills (not Sabres)
  },
  'IND_at_KC_2025-11-23': {
    homeId: 'NFL_12', // Kansas City Chiefs (not Royals)
    awayId: 'NFL_11'  // Indianapolis Colts
  },
  'PIT_at_CHI_2025-11-23': {
    homeId: 'NFL_3',  // Chicago Bears
    awayId: 'NFL_23'  // Pittsburgh Steelers (not Penguins)
  },
  'JAX_at_ARI_2025-11-23': {
    homeId: 'NFL_22', // Arizona Cardinals (not Diamondbacks)
    awayId: 'NFL_30'  // Jacksonville Jaguars
  },
  'SEA_at_TEN_2025-11-23': {
    homeId: 'NFL_10', // Tennessee Titans
    awayId: 'NFL_26'  // Seattle Seahawks (not Mariners)
  },
  'PHI_at_DAL_2025-11-23': {
    homeId: 'NFL_6',  // Dallas Cowboys
    awayId: 'NFL_21'  // Philadelphia Eagles (not Phillies)
  },
  'ATL_at_NO_2025-11-23': {
    homeId: 'NFL_18', // New Orleans Saints
    awayId: 'NFL_1'   // Atlanta Falcons (not Braves)
  },
  'TB_at_LAR_2025-11-24': {
    homeId: 'NFL_14', // Los Angeles Rams
    awayId: 'NFL_27'  // Tampa Bay Buccaneers (not Rays)
  },
  'CLE_at_LV_2025-11-23': {
    homeId: 'NFL_13', // Las Vegas Raiders
    awayId: 'NFL_5'   // Cleveland Browns (not Guardians)
  },
  'NYG_at_DET_2025-11-23': {
    homeId: 'NFL_8',  // Detroit Lions (not Tigers)
    awayId: 'NFL_19'  // New York Giants
  },
  'CAR_at_SF_2025-11-25': {
    homeId: 'NFL_25', // San Francisco 49ers (not Giants)
    awayId: 'NFL_29'  // Carolina Panthers
  }
}

async function fixMismatchedGames() {
  console.log('🔧 FIXING TEAM SPORT MISMATCHES IN GAMES')
  console.log('='.repeat(60))

  let fixed = 0
  let errors = 0

  for (const [gameId, corrections] of Object.entries(ESPN_TEAM_CORRECTIONS)) {
    try {
      console.log(`\n🔧 Fixing game: ${gameId}`)

      // Verify the game exists and get current teams
      const { data: game } = await supabase
        .from('Game')
        .select('id, homeId, awayId')
        .eq('id', gameId)
        .single()

      if (!game) {
        console.log(`   ⚠️ Game ${gameId} not found, skipping`)
        continue
      }

      // Get current team names for logging
      const { data: currentHome } = await supabase
        .from('Team')
        .select('name, sport')
        .eq('id', game.homeId)
        .single()

      const { data: currentAway } = await supabase
        .from('Team')
        .select('name, sport')
        .eq('id', game.awayId)
        .single()

      console.log(`   Current: ${currentAway?.name} (${currentAway?.sport}) @ ${currentHome?.name} (${currentHome?.sport})`)

      // Get corrected team names
      const { data: newHome } = await supabase
        .from('Team')
        .select('name, sport')
        .eq('id', corrections.homeId)
        .single()

      const { data: newAway } = await supabase
        .from('Team')
        .select('name, sport')
        .eq('id', corrections.awayId)
        .single()

      console.log(`   Fixed:   ${newAway?.name} (${newAway?.sport}) @ ${newHome?.name} (${newHome?.sport})`)

      // Update the game with correct team IDs
      const { error: updateError } = await supabase
        .from('Game')
        .update({
          homeId: corrections.homeId,
          awayId: corrections.awayId
        })
        .eq('id', gameId)

      if (updateError) {
        console.error(`   ❌ Error updating game ${gameId}:`, updateError.message)
        errors++
      } else {
        console.log(`   ✅ Successfully fixed game ${gameId}`)
        fixed++
      }

    } catch (error) {
      console.error(`❌ Error fixing game ${gameId}:`, error.message)
      errors++
    }
  }

  console.log(`\n📈 SUMMARY:`)
  console.log(`✅ Games fixed: ${fixed}`)
  console.log(`❌ Errors: ${errors}`)

  console.log('\n🎯 NEXT STEPS:')
  console.log('1. Update fetch-fresh-games.js to prevent future mismatches')
  console.log('2. Add ESPN ID mapping to Team table for reliable resolution')
  console.log('3. Test the site to confirm fixes')

  console.log('\n' + '='.repeat(60))
}

fixMismatchedGames().catch(console.error)
