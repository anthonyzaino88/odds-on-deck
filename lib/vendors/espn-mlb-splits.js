/**
 * ESPN MLB Splits & Matchup Data
 * 
 * Fetches pitcher/batter splits and game context from ESPN's public APIs.
 * Used on MLB game detail pages for matchup analysis.
 */

const BASE = 'https://site.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes'
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary'

/**
 * Fetch a pitcher's split stats for the given season.
 * Returns structured splits: vs L/R, home/away, recent form, times through order.
 */
export async function fetchPitcherSplits(espnPlayerId, season = null) {
  try {
    const yr = season || new Date().getFullYear()
    let url = `${BASE}/${espnPlayerId}/splits?season=${yr}&category=pitching`
    let res = await fetch(url, { next: { revalidate: 1800 } })
    if (!res.ok) return null
    let data = await res.json()

    // Fall back to previous season if current season has no split data
    let usedSeason = yr
    const hasData = data.splitCategories?.some(c => c.splits?.length > 0 && c.splits[0]?.stats?.length > 0)
    if (!hasData && !season) {
      const prevYr = yr - 1
      url = `${BASE}/${espnPlayerId}/splits?season=${prevYr}&category=pitching`
      res = await fetch(url, { next: { revalidate: 3600 } })
      if (res.ok) {
        const prevData = await res.json()
        const prevHasData = prevData.splitCategories?.some(c => c.splits?.length > 0 && c.splits[0]?.stats?.length > 0)
        if (prevHasData) {
          data = prevData
          usedSeason = prevYr
        }
      }
    }

    const labels = data.labels || []
    const pitchingNames = data.names || []
    // Platoon/opponent splits use batting-against columns instead of pitching
    const battingAgainstNames = ['AB','R','H','2B','3B','HR','RBI','BB','HBP','SO','SB','CS','AVG','OBP','SLG','OPS']

    // Categories that use batting-against stat columns
    const battingCategories = new Set([
      'Right / Left', 'Opponent Batting',
      'Count', 'Batting Order', 'Situation', 'Inning Pitches'
    ])

    function parseSplit(split, categoryName) {
      if (!split?.stats) return null
      const isBatting = battingCategories.has(categoryName)
      const colNames = isBatting ? battingAgainstNames : pitchingNames
      const obj = { _format: isBatting ? 'batting' : 'pitching' }
      colNames.forEach((n, i) => { obj[n] = split.stats[i] })
      obj._label = split.displayName

      if (isBatting) {
        // Already has AVG, OBP, SLG, OPS directly
        obj.K = obj.SO || '—'
      } else {
        // Pitching format — compute derived stats
        const ip = parseFloat(obj.innings) || 0
        if (ip > 0) {
          obj.WHIP = ((parseFloat(obj.walks || 0) + parseFloat(obj.hits || 0)) / ip).toFixed(2)
          obj['K/9'] = ((parseFloat(obj.strikeouts || 0) / ip) * 9).toFixed(1)
          obj['BB/9'] = ((parseFloat(obj.walks || 0) / ip) * 9).toFixed(1)
        }
        obj.AVG = obj.opponentAvg || obj.AVG || '—'
        obj.IP = obj.innings || '—'
        obj.K = obj.strikeouts || '—'
        obj.W = obj.wins || '—'
        obj.L = obj.losses || '—'
      }
      return obj
    }

    function findCategory(displayName) {
      return data.splitCategories?.find(c => c.displayName === displayName)
    }

    function findSplit(catName, splitName) {
      const cat = findCategory(catName)
      const s = cat?.splits?.find(s => s.displayName === splitName)
      return parseSplit(s, catName)
    }

    function allSplitsInCategory(catName) {
      const cat = findCategory(catName)
      return (cat?.splits || []).map(s => parseSplit(s, catName)).filter(Boolean)
    }

    const overall = findSplit('Overall', 'All Splits')
    const vsLeft = findSplit('Right / Left', 'vs. Left') || findSplit('Opponent Batting', 'vs. Left')
    const vsRight = findSplit('Right / Left', 'vs. Right') || findSplit('Opponent Batting', 'vs. Right')
    const home = findSplit('Breakdown', 'Home')
    const away = findSplit('Breakdown', 'Away')
    const day = findSplit('Breakdown', 'Day')
    const night = findSplit('Breakdown', 'Night')
    const last7 = findSplit('Day / Month', 'Last 7 Days')
    const last15 = findSplit('Day / Month', 'Last 15 Days')
    const last30 = findSplit('Day / Month', 'Last 30 Days')
    const firstTime = findSplit('Inning Pitches', '1st Time Faced In Game')
    const secondTime = findSplit('Inning Pitches', '2nd Time Faced In Game')
    const thirdTime = findSplit('Inning Pitches', '3rd Time Faced In Game')
    const opponents = allSplitsInCategory('Opponent')

    return {
      season: usedSeason,
      labels,
      names: pitchingNames,
      overall,
      platoon: { vsLeft, vsRight },
      venue: { home, away },
      timeOfDay: { day, night },
      recentForm: { last7, last15, last30 },
      timesThrough: { firstTime, secondTime, thirdTime },
      opponents
    }
  } catch (err) {
    console.error(`Error fetching pitcher splits for ${espnPlayerId}:`, err.message)
    return null
  }
}

/**
 * Fetch a batter's split stats for the given season.
 * Returns structured splits: vs L/R, home/away, recent form, situational.
 */
export async function fetchBatterSplits(espnPlayerId, season = null) {
  try {
    const yr = season || new Date().getFullYear()
    let url = `${BASE}/${espnPlayerId}/splits?season=${yr}`
    let res = await fetch(url, { next: { revalidate: 1800 } })
    if (!res.ok) return null
    let data = await res.json()

    const hasData = data.splitCategories?.some(c => c.splits?.length > 0 && c.splits[0]?.stats?.length > 0)
    if (!hasData && !season) {
      const prevYr = yr - 1
      url = `${BASE}/${espnPlayerId}/splits?season=${prevYr}`
      res = await fetch(url, { next: { revalidate: 3600 } })
      if (res.ok) {
        const prevData = await res.json()
        const prevHasData = prevData.splitCategories?.some(c => c.splits?.length > 0 && c.splits[0]?.stats?.length > 0)
        if (prevHasData) data = prevData
      }
    }

    const labels = data.labels || []
    const names = data.names || []

    function parseSplit(split) {
      if (!split?.stats) return null
      const obj = {}
      names.forEach((n, i) => { obj[n] = split.stats[i] })
      obj._label = split.displayName
      return obj
    }

    function findCategory(displayName) {
      return data.splitCategories?.find(c => c.displayName === displayName)
    }

    function findSplit(catName, splitName) {
      const cat = findCategory(catName)
      const s = cat?.splits?.find(s => s.displayName === splitName)
      return parseSplit(s)
    }

    function allSplitsInCategory(catName) {
      const cat = findCategory(catName)
      return (cat?.splits || []).map(parseSplit).filter(Boolean)
    }

    const overall = findSplit('Overall', 'All Splits')
    const vsLeft = findSplit('Breakdown', 'vs. Left')
    const vsRight = findSplit('Breakdown', 'vs. Right')
    const home = findSplit('Breakdown', 'Home')
    const away = findSplit('Breakdown', 'Away')
    const day = findSplit('Breakdown', 'Day')
    const night = findSplit('Breakdown', 'Night')
    const last7 = findSplit('Day / Month', 'Last 7 Days')
    const last15 = findSplit('Day / Month', 'Last 15 Days')
    const last30 = findSplit('Day / Month', 'Last 30 Days')
    const noneOn = findSplit('Situation', 'None On')
    const runnersOn = findSplit('Situation', 'Runners On')
    const scoringPos = findSplit('Situation', 'Scoring Position')
    const opponents = allSplitsInCategory('Opponent')

    return {
      season: yr,
      labels,
      names,
      overall,
      platoon: { vsLeft, vsRight },
      venue: { home, away },
      timeOfDay: { day, night },
      recentForm: { last7, last15, last30 },
      situation: { noneOn, runnersOn, scoringPos },
      opponents
    }
  } catch (err) {
    console.error(`Error fetching batter splits for ${espnPlayerId}:`, err.message)
    return null
  }
}

/**
 * Fetch extended game context from the ESPN summary endpoint.
 * Returns: predictor, last 5 games, season series, injuries, weather, team leaders.
 */
export async function fetchGameContext(espnGameId) {
  try {
    const url = `${SUMMARY}?event=${espnGameId}`
    const res = await fetch(url, { next: { revalidate: 600 } })
    if (!res.ok) return null
    const data = await res.json()

    const predictor = data.predictor || null

    const last5 = (data.lastFiveGames || []).map(team => ({
      teamName: team.team?.displayName,
      teamAbbr: team.team?.abbreviation,
      events: (team.events || []).map(e => ({
        opponent: e.opponent?.displayName,
        atVs: e.atVs,
        result: e.gameResult,
        score: e.score
      }))
    }))

    const seasonSeries = (data.seasonseries || []).map(s => ({
      type: s.type,
      title: s.title,
      summary: s.summary,
      seriesScore: s.seriesScore,
      totalGames: s.totalCompetitions,
      completed: s.completed
    }))

    const injuries = (data.injuries || []).map(team => ({
      teamName: team.team?.displayName,
      teamAbbr: team.team?.abbreviation,
      injuries: (team.injuries || []).map(inj => ({
        player: inj.athlete?.displayName,
        status: inj.status,
        detail: inj.details?.detail,
        type: inj.details?.type
      }))
    }))

    const weather = data.gameInfo?.weather || null

    const leaders = (data.leaders || []).map(team => ({
      teamName: team.team?.displayName,
      teamAbbr: team.team?.abbreviation,
      leaders: (team.leaders || []).map(cat => ({
        category: cat.displayName,
        leaders: (cat.leaders || []).slice(0, 1).map(l => ({
          player: l.athlete?.displayName,
          value: l.displayValue,
          headshot: l.athlete?.headshot?.href
        }))
      }))
    }))

    // Extract pitcher ESPN IDs from the header for splits fetching
    const competition = data.header?.competitions?.[0]
    const pitcherIds = { home: null, away: null }
    for (const competitor of competition?.competitors || []) {
      const prob = competitor.probables?.[0]
      if (prob?.athlete?.id) {
        pitcherIds[competitor.homeAway] = prob.athlete.id
      }
    }

    return {
      predictor,
      last5,
      seasonSeries,
      injuries,
      weather,
      leaders,
      pitcherIds
    }
  } catch (err) {
    console.error(`Error fetching game context for ${espnGameId}:`, err.message)
    return null
  }
}

/**
 * Fetch the full matchup analysis for an MLB game.
 * Combines game context + both pitchers' splits in parallel.
 */
export async function fetchMLBMatchupAnalysis(espnGameId) {
  const context = await fetchGameContext(espnGameId)
  if (!context) return null

  const { pitcherIds } = context

  const [homePitcherSplits, awayPitcherSplits] = await Promise.all([
    pitcherIds.home ? fetchPitcherSplits(pitcherIds.home) : null,
    pitcherIds.away ? fetchPitcherSplits(pitcherIds.away) : null
  ])

  return {
    ...context,
    homePitcherSplits,
    awayPitcherSplits
  }
}
