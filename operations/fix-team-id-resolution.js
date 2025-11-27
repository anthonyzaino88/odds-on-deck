import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

/**
 * Resolve team ID by ESPN ID and sport
 * This prevents conflicts where ESPN uses same ID for different teams in different sports
 */
async function resolveTeamId(espnTeamId, sport) {
  if (!espnTeamId || !sport) return null

  // First try exact match by ESPN ID and sport
  const { data: team } = await supabase
    .from('Team')
    .select('id')
    .eq('espnId', espnTeamId.toString())
    .eq('sport', sport)
    .maybeSingle()

  if (team) {
    return team.id
  }

  // If not found, try by abbreviation (fallback)
  // This handles cases where ESPN ID mapping might be missing
  const espnTeamData = await getESPNTeamData(espnTeamId, sport)
  if (espnTeamData?.abbreviation) {
    const { data: teamByAbbr } = await supabase
      .from('Team')
      .select('id')
      .eq('abbr', espnTeamData.abbreviation)
      .eq('sport', sport)
      .maybeSingle()

    if (teamByAbbr) {
      console.log(`✅ Resolved team by abbreviation: ${espnTeamData.abbreviation} (${sport}) -> ${teamByAbbr.id}`)
      return teamByAbbr.id
    }
  }

  console.warn(`⚠️ Could not resolve team: ESPN ID ${espnTeamId}, sport ${sport}`)
  return null
}

/**
 * Mock ESPN API call (in real implementation, this would fetch from ESPN)
 * For now, return basic team data structure
 */
async function getESPNTeamData(espnTeamId, sport) {
  // This is a placeholder - in production you'd fetch from ESPN API
  // For now, we'll rely on the abbreviation from the game data
  return null
}

/**
 * Fix existing games with wrong team IDs
 */
async function fixTeamIdsInGames() {
  console.log('🔧 FIXING TEAM ID ISSUES IN GAMES')
  console.log('='.repeat(60))

  // Get all games that might have team ID issues
  const { data: games } = await supabase
    .from('Game')
    .select('id, sport, espnGameId, homeId, awayId')
    .eq('sport', 'nfl') // Focus on NFL games first
    .limit(50)

  console.log(`📊 Checking ${games?.length || 0} NFL games...`)

  let fixed = 0
  let errors = 0

  for (const game of games || []) {
    try {
      // Get home team details
      const { data: homeTeam } = await supabase
        .from('Team')
        .select('name, sport, espnId')
        .eq('id', game.homeId)
        .single()

      // Get away team details
      const { data: awayTeam } = await supabase
        .from('Team')
        .select('name, sport, espnId')
        .eq('id', game.awayId)
        .single()

      let needsFix = false

      // Check if home team sport matches game sport
      if (homeTeam && homeTeam.sport !== game.sport) {
        console.log(`🔧 HOME TEAM MISMATCH: Game ${game.id} (${game.sport}) has home team ${homeTeam.name} (${homeTeam.sport})`)
        needsFix = true
      }

      // Check if away team sport matches game sport
      if (awayTeam && awayTeam.sport !== game.sport) {
        console.log(`🔧 AWAY TEAM MISMATCH: Game ${game.id} (${game.sport}) has away team ${awayTeam.name} (${awayTeam.sport})`)
        needsFix = true
      }

      if (needsFix) {
        console.log(`   ESPN Game ID: ${game.espnGameId}`)
        console.log(`   Current: ${awayTeam?.name || 'Unknown'} @ ${homeTeam?.name || 'Unknown'}`)
      }

    } catch (error) {
      console.error(`❌ Error checking game ${game.id}:`, error.message)
      errors++
    }
  }

  console.log(`\n✅ Fixed: ${fixed} games`)
  console.log(`❌ Errors: ${errors}`)

  console.log('\n💡 RECOMMENDED FIXES:')
  console.log('1. Update fetch-fresh-games.js to properly resolve team IDs by ESPN ID + sport')
  console.log('2. Add ESPN ID mapping to Team table for reliable lookups')
  console.log('3. Create a team resolution function that handles conflicts')

  console.log('\n' + '='.repeat(60))
}

fixTeamIdsInGames().catch(console.error)
