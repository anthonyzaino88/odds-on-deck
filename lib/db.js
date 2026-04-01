// Database wrapper - Provides backward compatibility for pages still using old function names
// USES SUPABASE - This is just a compatibility layer
import { supabase } from './supabase.js'
import { fetchMLBMatchupAnalysis } from './vendors/espn-mlb-splits.js'

/**
 * Fetch MLB box score from MLB Stats API for completed games
 */
async function fetchMLBBoxScore(mlbGameId) {
  try {
    const url = `https://statsapi.mlb.com/api/v1/game/${mlbGameId}/boxscore`
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) return null
    const data = await res.json()

    function extractTeamStats(teamData) {
      const batters = []
      const pitchers = []
      if (!teamData?.players) return { batters, pitchers, info: teamData?.team }

      for (const [, p] of Object.entries(teamData.players)) {
        const name = p.person?.fullName
        if (!name) continue

        const batting = p.stats?.batting
        if (batting && (batting.atBats > 0 || batting.baseOnBalls > 0 || batting.hitByPitch > 0)) {
          batters.push({
            name,
            position: p.position?.abbreviation || '',
            ab: batting.atBats || 0,
            r: batting.runs || 0,
            h: batting.hits || 0,
            rbi: batting.rbi || 0,
            bb: batting.baseOnBalls || 0,
            so: batting.strikeOuts || 0,
            hr: batting.homeRuns || 0,
            avg: batting.avg || '',
            obp: batting.obp || '',
            battingOrder: p.battingOrder ? parseInt(p.battingOrder) : 999
          })
        }

        const pitching = p.stats?.pitching
        if (pitching && pitching.inningsPitched) {
          pitchers.push({
            name,
            ip: pitching.inningsPitched || '0',
            h: pitching.hits || 0,
            r: pitching.runs || 0,
            er: pitching.earnedRuns || 0,
            bb: pitching.baseOnBalls || 0,
            so: pitching.strikeOuts || 0,
            hr: pitching.homeRuns || 0,
            pitches: pitching.numberOfPitches || 0,
            era: pitching.era || ''
          })
        }
      }

      batters.sort((a, b) => a.battingOrder - b.battingOrder)
      return { batters, pitchers, info: teamData?.team }
    }

    return {
      away: extractTeamStats(data.teams?.away),
      home: extractTeamStats(data.teams?.home)
    }
  } catch (err) {
    console.error('Error fetching MLB box score:', err.message)
    return null
  }
}

/**
 * Fetch probable pitchers from ESPN for an MLB game
 */
async function fetchESPNProbablePitchers(espnGameId) {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${espnGameId}`
    const res = await fetch(url, { next: { revalidate: 600 } })
    if (!res.ok) return { home: null, away: null }
    const data = await res.json()

    // Pitchers are in header.competitions[].competitors[].probables[]
    const competition = data.header?.competitions?.[0]
    if (!competition) return { home: null, away: null }

    const result = { home: null, away: null }

    for (const competitor of competition.competitors || []) {
      const probable = competitor.probables?.[0]
      if (!probable?.athlete) continue

      const athlete = probable.athlete
      const categories = probable.statistics?.splits?.categories || []
      const wins = categories.find(c => c.name === 'wins')?.displayValue || '0'
      const losses = categories.find(c => c.name === 'losses')?.displayValue || '0'
      const era = categories.find(c => c.name === 'ERA')?.displayValue || ''

      const pitcher = {
        fullName: athlete.fullName || athlete.displayName || 'TBD',
        headshot: athlete.headshot?.href || null,
        throws: athlete.position?.name?.includes('Left') ? 'L' : 'R',
        record: `${wins}-${losses}`,
        era,
        stats: categories.map(c => ({ name: c.name, display: c.displayValue }))
      }

      if (competitor.homeAway === 'home') result.home = pitcher
      else result.away = pitcher
    }

    return result
  } catch (err) {
    console.error('Error fetching ESPN pitchers:', err.message)
    return { home: null, away: null }
  }
}

/**
 * Get game detail by ID
 * Used by: app/game/[id]/page.js
 * 
 * Fetches game with all related data:
 * - Teams (home/away)
 * - Odds
 * - EdgeSnapshot (edges)
 * - Player props (from PlayerPropCache)
 * - MLB box score (for completed games)
 * - Probable pitchers (from ESPN)
 */
export async function getGameDetail(gameId) {
  try {
    // Fetch game with teams
    const { data: game, error: gameError } = await supabase
      .from('Game')
      .select(`
        *,
        home:Team!Game_homeId_fkey(*),
        away:Team!Game_awayId_fkey(*)
      `)
      .eq('id', gameId)
      .maybeSingle()
    
    if (gameError) throw gameError
    if (!game) return null

    // Build list of game IDs to search — include sibling games that share the
    // same oddsApiEventId or same team matchup on adjacent days. This handles
    // the common case where odds/props were saved to a different date's record.
    const gameIdsToCheck = [gameId]
    if (game.oddsApiEventId) {
      const { data: siblings } = await supabase
        .from('Game')
        .select('id')
        .eq('oddsApiEventId', game.oddsApiEventId)
        .neq('id', gameId)
      if (siblings?.length) gameIdsToCheck.push(...siblings.map(s => s.id))
    }
    // Also check same-team matchup ±1 day (handles event ID mismatch)
    if (game.homeId && game.awayId) {
      const { data: adjacent } = await supabase
        .from('Game')
        .select('id')
        .eq('homeId', game.homeId)
        .eq('awayId', game.awayId)
        .eq('sport', game.sport)
        .neq('id', gameId)
        .gte('date', new Date(new Date(game.date).getTime() - 86400000).toISOString())
        .lte('date', new Date(new Date(game.date).getTime() + 86400000).toISOString())
      if (adjacent?.length) {
        for (const a of adjacent) {
          if (!gameIdsToCheck.includes(a.id)) gameIdsToCheck.push(a.id)
        }
      }
    }

    // Parallel fetches for related data — search across all sibling game IDs
    const [oddsResult, edgesResult, propsResult] = await Promise.all([
      supabase
        .from('Odds')
        .select('*')
        .in('gameId', gameIdsToCheck)
        .order('ts', { ascending: false })
        .limit(20),
      supabase
        .from('EdgeSnapshot')
        .select('*')
        .in('gameId', gameIdsToCheck)
        .order('ts', { ascending: false })
        .limit(5),
      supabase
        .from('PlayerPropCache')
        .select('*')
        .in('gameId', gameIdsToCheck)
        .eq('isStale', false)
        .order('qualityScore', { ascending: false })
        .limit(50)
    ])

    if (oddsResult.error) console.error('Error fetching odds:', oddsResult.error)
    if (edgesResult.error) console.error('Error fetching edges:', edgesResult.error)
    if (propsResult.error) console.error('Error fetching props:', propsResult.error)

    // MLB-specific enrichment
    let mlbBoxScore = null
    let pitchers = { home: null, away: null }
    let matchupAnalysis = null

    if (game.sport === 'mlb') {
      const enrichPromises = []

      if (game.status === 'final' && game.mlbGameId) {
        enrichPromises.push(fetchMLBBoxScore(game.mlbGameId).then(r => { mlbBoxScore = r }))
      }

      if (game.espnGameId) {
        enrichPromises.push(fetchESPNProbablePitchers(game.espnGameId).then(r => { pitchers = r }))
        enrichPromises.push(
          fetchMLBMatchupAnalysis(game.espnGameId)
            .then(r => { matchupAnalysis = r })
            .catch(() => { matchupAnalysis = null })
        )
      }

      if (enrichPromises.length) await Promise.all(enrichPromises)
    }

    return {
      ...game,
      odds: oddsResult.data || [],
      edges: edgesResult.data || [],
      playerProps: propsResult.data || [],
      mlbBoxScore,
      matchupAnalysis,
      probableHomePitcher: pitchers.home,
      probableAwayPitcher: pitchers.away,
      lineups: [],
      nflData: null,
      postGameStats: null,
      postGamePlayerStats: null
    }
  } catch (error) {
    console.error('Error getting game detail:', error)
    return null
  }
}

/**
 * Get players for DFS
 * Used by: app/dfs/page.js
 */
export async function getPlayersForDFS() {
  try {
    // Return empty array - DFS functionality not currently active
    // Can be implemented later when needed
    return []
  } catch (error) {
    console.error('Error getting DFS players:', error)
    return []
  }
}

/**
 * Export a mock prisma object for compatibility
 * Used by: lib/api-usage-manager.js
 */
export const prisma = {
  // Mock Prisma client - not actually used
  // API usage tracking can be implemented in Supabase if needed
}


