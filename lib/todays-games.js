import { isCancelledGameStatus } from './game-grade-eligibility.js'
import { isFinalStatus } from './game-status.js'
import { parseStoredGameDate } from './score-updater.js'
import { isSupabaseAdminConfigured, supabase } from './supabase.js'

const ET_TIME_ZONE = 'America/New_York'

const etDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatEtDateKey(date) {
  return etDateFormatter.format(date)
}

export function isHiddenFromTodaysSlate(game) {
  return isCancelledGameStatus(game?.status)
}

/** Finals from previous ET days drop off Games This Week. */
export function isPriorDayFinal(game, { todayEt, gameEtDate } = {}) {
  if (!isFinalStatus(game?.status)) return false
  return Boolean(todayEt && gameEtDate && gameEtDate < todayEt)
}

function shiftDateKey(dateKey, days) {
  const shifted = new Date(`${dateKey}T12:00:00.000Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

function weekdayFromDateKey(dateKey) {
  return new Date(`${dateKey}T12:00:00.000Z`).getUTCDay()
}

function etOffsetIso(dateKey) {
  const probe = new Date(`${dateKey}T12:00:00.000Z`)
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    timeZoneName: 'longOffset',
  })
    .formatToParts(probe)
    .find((part) => part.type === 'timeZoneName')
    ?.value || ''
  const match = name.match(/([+-]\d{2}:\d{2})/)
  return match ? match[1] : '-05:00'
}

function etWallToUtc(dateKey, wallTime) {
  return new Date(`${dateKey}T${wallTime}${etOffsetIso(dateKey)}`)
}

// NFL week is Thursday–Monday by ET calendar date, not the server's local midnight.
export function getNFLWeekBounds(now) {
  const todayKey = formatEtDateKey(now)
  const dayOfWeek = weekdayFromDateKey(todayKey)

  // Tue/Wed: upcoming Thu–Mon. Thu–Mon: current week (Sun/Mon look back to last Thu).
  let thursdayKey
  if (dayOfWeek === 2 || dayOfWeek === 3) {
    const daysUntilThursday = (4 - dayOfWeek + 7) % 7 || 7
    thursdayKey = shiftDateKey(todayKey, daysUntilThursday)
  } else if (dayOfWeek >= 4) {
    thursdayKey = shiftDateKey(todayKey, -(dayOfWeek - 4))
  } else {
    thursdayKey = shiftDateKey(todayKey, -(dayOfWeek + 3))
  }

  const mondayKey = shiftDateKey(thursdayKey, 4)
  const thursday = etWallToUtc(thursdayKey, '00:00:00.000')
  const monday = etWallToUtc(mondayKey, '23:59:59.999')

  return { thursday, monday, thursdayKey, mondayKey }
}

export function isGameInNflWeek(gameDate, nflWeek) {
  if (!(gameDate instanceof Date) || Number.isNaN(gameDate.getTime())) return false
  const gameEtDate = formatEtDateKey(gameDate)
  return gameEtDate >= nflWeek.thursdayKey && gameEtDate <= nflWeek.mondayKey
}

/**
 * Fetch today's slate using the same query as app/api/games/today/route.js
 * MLB/NHL: today's EST date. NFL: current Thu-Mon week.
 */
export async function getTodaysGames() {
  if (!isSupabaseAdminConfigured()) {
    return {
      success: false,
      error: 'Database not configured. Check your Supabase environment variables.',
    }
  }

  const now = new Date()
  const estDateStr = formatEtDateKey(now)

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
    if (isHiddenFromTodaysSlate(game)) continue

    const parsedDate = parseStoredGameDate(game.date)
    const gameDate = parsedDate || new Date(game.date)
    const dateStr = parsedDate?.toISOString() || game.date
    const gameEstDate = Number.isNaN(gameDate.getTime()) ? null : formatEtDateKey(gameDate)

    const homeTeam = teamMap[game.homeId] || { name: 'Unknown', abbr: '?' }
    const awayTeam = teamMap[game.awayId] || { name: 'Unknown', abbr: '?' }

    const enrichedGame = {
      ...game,
      date: dateStr,
      home: homeTeam,
      away: awayTeam,
    }

    if (game.sport === 'nfl') {
      if (isGameInNflWeek(gameDate, nflWeek)) {
        if (isPriorDayFinal(game, { todayEt: estDateStr, gameEtDate: gameEstDate })) continue
        nflGames.push(enrichedGame)
      }
    } else if (gameEstDate === estDateStr) {
      if (game.sport === 'mlb') mlbGames.push(enrichedGame)
      else if (game.sport === 'nhl') nhlGames.push(enrichedGame)
    }
  }

  return {
    success: true,
    data: {
      mlb: mlbGames,
      nfl: nflGames,
      nhl: nhlGames,
    },
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