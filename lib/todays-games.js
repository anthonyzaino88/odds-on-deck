import { supabase } from './supabase.js'

const TOTALS_MARKETS = new Set(['totals', 'total'])

/**
 * ET calendar day as YYYY-MM-DD. Homepage cache keys must include this
 * so a Tuesday slate cannot reuse Monday's empty/failed entry.
 */
export function etDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function parseGameInstant(raw) {
  if (!raw) return null
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  const text = String(raw)
  const iso = text.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(text) ? text : `${text}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** True when the game's start falls on today's ET calendar day (evening first pitch included). */
export function isEtCalendarDay(gameDate, now = new Date()) {
  const instant = parseGameInstant(gameDate)
  if (!instant) return false
  return etDateKey(instant) === etDateKey(now)
}

export function emptyTodaysGames() {
  return { mlb: [], nfl: [], nhl: [] }
}

export function isSuccessfulTodaysGames(result) {
  return Boolean(result?.success && result.data && typeof result.data === 'object')
}

/**
 * Latest posted market total per game. Skips missing / non-finite values —
 * never invents a line.
 */
export function pickLatestGameTotals(oddsRows) {
  const totals = {}
  for (const row of Array.isArray(oddsRows) ? oddsRows : []) {
    const gameId = row?.gameId
    if (!gameId || totals[gameId] != null) continue
    const market = String(row.market || '').toLowerCase()
    if (!TOTALS_MARKETS.has(market)) continue
    const n = Number(row.total)
    if (!Number.isFinite(n) || n <= 0) continue
    totals[gameId] = n
  }
  return totals
}

export function formatGameTotal(total) {
  const n = Number(total)
  if (!Number.isFinite(n) || n <= 0) return null
  return Number.isInteger(n) ? String(n) : String(n)
}

export function formatMatchupChip(game) {
  const away = game?.away?.abbr || game?.away?.name || 'Away'
  const home = game?.home?.abbr || game?.home?.name || 'Home'
  return {
    matchup: `${away} @ ${home}`,
    total: formatGameTotal(game?.total),
  }
}

/**
 * Prefer a fresh slate over a cached miss. Empty sports stay empty only
 * when the live query itself says so.
 */
export async function resolveHomepageTodaysGames({ cached, live }) {
  try {
    const result = await cached()
    if (isSuccessfulTodaysGames(result)) return result
  } catch (error) {
    console.error('homepage: today\'s games cache missed', error)
  }
  return live()
}

// Helper to get NFL week boundaries (Thursday to Monday)
// Shows UPCOMING games: Thu-Mon of current NFL week
function getNFLWeekBounds(now) {
  const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dayOfWeek = estDate.getDay() // 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat

  // Calculate days until next Thursday
  // If today is Tue(2) or Wed(3), show upcoming Thu-Mon
  // If today is Thu(4)-Mon(1), show current Thu-Mon
  let thursday = new Date(estDate)

  if (dayOfWeek === 2 || dayOfWeek === 3) {
    // Tuesday or Wednesday - show upcoming Thursday
    const daysUntilThursday = (4 - dayOfWeek + 7) % 7 || 7
    thursday.setDate(estDate.getDate() + daysUntilThursday)
  } else if (dayOfWeek >= 4) {
    // Thursday, Friday, Saturday - find this week's Thursday
    thursday.setDate(estDate.getDate() - (dayOfWeek - 4))
  } else {
    // Sunday (0) or Monday (1) - find last Thursday
    thursday.setDate(estDate.getDate() - (dayOfWeek + 3))
  }

  thursday.setHours(0, 0, 0, 0)

  // Monday is 4 days after Thursday
  const monday = new Date(thursday)
  monday.setDate(thursday.getDate() + 4)
  monday.setHours(23, 59, 59, 999)

  return { thursday, monday }
}

async function attachMarketTotals(gamesBySport) {
  const listed = ['mlb', 'nfl', 'nhl'].flatMap((sport) => gamesBySport[sport] || [])
  const ids = [...new Set(listed.map((game) => game.id).filter(Boolean))]
  if (!supabase || ids.length === 0) return gamesBySport

  const { data: oddsRows, error } = await supabase
    .from('Odds')
    .select('gameId, market, total, ts')
    .in('gameId', ids)
    .in('market', ['totals', 'total'])
    .order('ts', { ascending: false })

  if (error) {
    console.error('todays-games: failed to load market totals', error)
    return gamesBySport
  }

  const totals = pickLatestGameTotals(oddsRows)
  const withTotal = (game) => ({
    ...game,
    total: totals[game.id] ?? null,
  })

  return {
    mlb: (gamesBySport.mlb || []).map(withTotal),
    nfl: (gamesBySport.nfl || []).map(withTotal),
    nhl: (gamesBySport.nhl || []).map(withTotal),
  }
}

/**
 * Fetch today's slate using the same query as app/api/games/today/route.js
 * MLB/NHL: today's EST date. NFL: current Thu-Mon week.
 */
export async function getTodaysGames() {
  if (!supabase) {
    return {
      success: false,
      error: 'Database not configured. Check your Supabase environment variables.',
    }
  }

  const now = new Date()
  const estDateStr = etDateKey(now)

  const nflWeek = getNFLWeekBounds(now)

  const todayStart = new Date(now)
  todayStart.setDate(now.getDate() - 1)
  todayStart.setHours(0, 0, 0, 0)

  const todayEnd = new Date(now)
  todayEnd.setDate(now.getDate() + 2)
  todayEnd.setHours(23, 59, 59, 999)

  const nflStart = new Date(nflWeek.thursday)
  nflStart.setDate(nflStart.getDate() - 1)

  const nflEnd = new Date(nflWeek.monday)
  nflEnd.setDate(nflEnd.getDate() + 1)

  const windowStart = new Date(Math.min(todayStart.getTime(), nflStart.getTime()))
  const windowEnd = new Date(Math.max(todayEnd.getTime(), nflEnd.getTime()))

  const { data: allGames, error } = await supabase
    .from('Game')
    .select('*')
    .gte('date', windowStart.toISOString())
    .lte('date', windowEnd.toISOString())
    .order('date', { ascending: true })

  if (error) {
    return { success: false, error: error.message }
  }

  const teamIds = new Set()
  allGames?.forEach((game) => {
    if (game.homeId) teamIds.add(game.homeId)
    if (game.awayId) teamIds.add(game.awayId)
  })

  const { data: teams } = teamIds.size
    ? await supabase
        .from('Team')
        .select('id, name, abbr')
        .in('id', Array.from(teamIds))
    : { data: [] }

  const teamMap = {}
  teams?.forEach((team) => {
    teamMap[team.id] = team
  })

  const mlbGames = []
  const nflGames = []
  const nhlGames = []

  for (const game of allGames || []) {
    const gameDate = parseGameInstant(game.date)
    const rawDate = game.date == null ? '' : String(game.date)
    const dateStr = rawDate
      ? (rawDate.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(rawDate) ? rawDate : `${rawDate}Z`)
      : game.date

    const homeTeam = teamMap[game.homeId] || { name: 'Unknown', abbr: '?' }
    const awayTeam = teamMap[game.awayId] || { name: 'Unknown', abbr: '?' }

    const enrichedGame = {
      ...game,
      date: dateStr,
      home: homeTeam,
      away: awayTeam,
    }

    if (game.sport === 'nfl') {
      if (gameDate && gameDate >= nflWeek.thursday && gameDate <= nflWeek.monday) {
        nflGames.push(enrichedGame)
      }
    } else if (gameDate && isEtCalendarDay(gameDate, now)) {
      if (game.sport === 'mlb') mlbGames.push(enrichedGame)
      else if (game.sport === 'nhl') nhlGames.push(enrichedGame)
    }
  }

  const data = await attachMarketTotals({
    mlb: mlbGames,
    nfl: nflGames,
    nhl: nhlGames,
  })

  return {
    success: true,
    data,
    timestamp: now.toISOString(),
    debug: {
      estDate: estDateStr,
      serverTime: now.toISOString(),
      nflWeekStart: nflWeek.thursday.toISOString(),
      nflWeekEnd: nflWeek.monday.toISOString(),
      totalGames: allGames?.length || 0,
    },
  }
}