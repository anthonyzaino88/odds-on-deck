import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// ESPN ID mappings by team abbreviation and sport
// This maps our team abbreviations to ESPN's team IDs
const ESPN_ID_MAPPING = {
  // NFL Teams
  'nfl': {
    'BUF': 2,   // Buffalo Bills
    'MIA': 15,  // Miami Dolphins
    'NE': 17,   // New England Patriots
    'NYJ': 20,  // New York Jets
    'BAL': 33,  // Baltimore Ravens
    'CIN': 4,   // Cincinnati Bengals
    'CLE': 5,   // Cleveland Browns
    'PIT': 23,  // Pittsburgh Steelers
    'HOU': 34,  // Houston Texans
    'IND': 11,  // Indianapolis Colts
    'JAX': 30,  // Jacksonville Jaguars
    'TEN': 10,  // Tennessee Titans
    'DEN': 7,   // Denver Broncos
    'KC': 12,   // Kansas City Chiefs
    'LV': 13,   // Las Vegas Raiders
    'LAC': 24,  // Los Angeles Chargers
    'DAL': 6,   // Dallas Cowboys
    'NYG': 19,  // New York Giants
    'PHI': 21,  // Philadelphia Eagles
    'WSH': 28,  // Washington Commanders
    'CHI': 3,   // Chicago Bears
    'DET': 8,   // Detroit Lions
    'GB': 9,    // Green Bay Packers
    'MIN': 16,  // Minnesota Vikings
    'ATL': 1,   // Atlanta Falcons
    'CAR': 29,  // Carolina Panthers
    'NO': 18,   // New Orleans Saints
    'TB': 27,   // Tampa Bay Buccaneers
    'ARI': 22,  // Arizona Cardinals
    'LAR': 14,  // Los Angeles Rams
    'SF': 25,   // San Francisco 49ers
    'SEA': 26   // Seattle Seahawks
  },

  // NHL Teams (sample - would need complete mapping)
  'nhl': {
    'BOS': 1,   // Boston Bruins
    'BUF': 2,   // Buffalo Sabres
    'DET': 8,   // Detroit Red Wings
    'FLA': 13,  // Florida Panthers
    'MTL': 8,   // Montreal Canadiens
    'OTT': 9,   // Ottawa Senators
    'TB': 14,   // Tampa Bay Lightning
    'TOR': 10,  // Toronto Maple Leafs
    // ... more NHL teams would go here
  },

  // MLB Teams (sample)
  'mlb': {
    'LAD': 25,  // Los Angeles Dodgers
    'LAA': 3,   // Los Angeles Angels
    'OAK': 7,   // Oakland Athletics
    'SEA': 11,  // Seattle Mariners
    'TEX': 15,  // Texas Rangers
    // ... more MLB teams would go here
  }
}

async function addEspnIdColumn() {
  console.log('🔧 ADDING ESPN ID COLUMN TO TEAM TABLE')
  console.log('='.repeat(60))

  try {
    // First, let's check if espnId column exists by trying to select it
    const { data: testData, error: testError } = await supabase
      .from('Team')
      .select('espnId')
      .limit(1)

    if (testError && testError.message.includes('column') && testError.message.includes('does not exist')) {
      console.log('📋 espnId column does not exist, would need to add it via SQL migration')
      console.log('💡 Run this SQL in Supabase:')
      console.log('   ALTER TABLE "Team" ADD COLUMN "espnId" TEXT;')
      return
    }

    console.log('✅ espnId column exists, proceeding with updates...')

    // Get all teams
    const { data: teams, error: fetchError } = await supabase
      .from('Team')
      .select('id, abbr, sport')

    if (fetchError) throw fetchError

    console.log(`📊 Processing ${teams?.length || 0} teams...`)

    let updated = 0
    let skipped = 0

    for (const team of teams || []) {
      const espnId = ESPN_ID_MAPPING[team.sport]?.[team.abbr]

      if (espnId) {
        const { error: updateError } = await supabase
          .from('Team')
          .update({ espnId: espnId.toString() })
          .eq('id', team.id)

        if (updateError) {
          console.error(`❌ Error updating ${team.abbr}:`, updateError.message)
        } else {
          console.log(`✅ Updated ${team.abbr} (${team.sport}) -> ESPN ID: ${espnId}`)
          updated++
        }
      } else {
        console.log(`⚠️ No ESPN ID mapping for ${team.abbr} (${team.sport})`)
        skipped++
      }
    }

    console.log(`\n📈 SUMMARY:`)
    console.log(`✅ Teams updated: ${updated}`)
    console.log(`⚠️ Teams skipped: ${skipped}`)

  } catch (error) {
    console.error('❌ Error:', error.message)
  }

  console.log('\n' + '='.repeat(60))
}

addEspnIdColumn().catch(console.error)
