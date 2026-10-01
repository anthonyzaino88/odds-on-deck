/**
 * Shared score-updater helpers used by scripts/update-scores-safely.js
 * and the stuck-MLB repair script. Keep I/O (Supabase, HTTP) in the scripts;
 * this module is the status / write-plan logic.
 */

import { parseSupabaseDate } from './date-utils.js'
import {
  ACTIVE_GAME_STATUSES,
  PRE_START_GAME_STATUSES,
  STUCK_MLB_REPAIR_STATUSES,
  isLiveGameStatus,
  isPreStartGameStatus,
  reconcileMlbAndEspnStatus,
  resolveMlbStatusForUpdate,
  shouldConfirmMlbFinalWithEspn,
} from './mlb-live-status.js'

export {
  ACTIVE_GAME_STATUSES,
  PRE_START_GAME_STATUSES,
  STUCK_MLB_REPAIR_STATUSES,
}

export const GAME_SELECT =
  'id, espnGameId, mlbGameId, homeId, awayId, homeScore, awayScore, status, date, lastUpdate, home:Team!Game_homeId_fkey(abbr), away:Team!Game_awayId_fkey(abbr)'

const STALE_NO_DATA_HOURS = 24

export function parseStoredGameDate(value) {
  return parseSupabaseDate(value)
}

export function normalizeStatus(status) {
  if (!status) return 'scheduled'

  if (typeof status === 'string' && !status.toLowerCase().startsWith('status_')) {
    return status
  }

  let cleanStatus = status.toLowerCase().replace(/^status_/i, '')

  const statusMap = {
    'in_progress': 'in_progress',
    'in-progress': 'in_progress',
    'scheduled': 'scheduled',
    'final': 'final',
    'halftime': 'halftime',
    'postponed': 'postponed',
    'delayed': 'delayed',
    'pre_game': 'pre_game',
    'pre-game': 'pre_game',
    'pregame': 'pre_game',
    'warmup': 'warmup',
    'cancelled': 'cancelled',
    'canceled': 'cancelled',
    'suspended': 'suspended',
  }

  return statusMap[cleanStatus] || cleanStatus
}

export function looksUnplayedIfNecessary(game) {
  if (!game) return false
  const home = Number(game.homeScore)
  const away = Number(game.awayScore)
  const scoreless = (!Number.isFinite(home) || home === 0) && (!Number.isFinite(away) || away === 0)
  if (!scoreless) return false

  const blob = [game.id, game.lastPlay, game.description, game.notes]
    .filter(Boolean)
    .join(' ')
  if (/if[\s_-]*necessary/i.test(blob)) return true

  // Placeholder rows that never landed in StatsAPI (no gamePk).
  return !game.mlbGameId
}

export function decideMissingLiveDataUpdate(game, { now = Date.now() } = {}) {
  const start = parseStoredGameDate(game?.date)
  if (!start) {
    return { action: 'skip', reason: 'No live data available' }
  }

  const ageHours = (now - start.getTime()) / (1000 * 60 * 60)
  if (ageHours <= STALE_NO_DATA_HOURS || !isPreStartGameStatus(game.status)) {
    return { action: 'skip', reason: 'No live data available' }
  }

  const home = Number(game.homeScore)
  const away = Number(game.awayScore)
  const scoreless = (!Number.isFinite(home) || home === 0) && (!Number.isFinite(away) || away === 0)

  if (scoreless || looksUnplayedIfNecessary(game)) {
    return {
      action: 'update',
      reason: 'stale unplayed (no live data) — postponed, not final 0-0',
      updateData: {
        status: 'postponed',
        lastUpdate: new Date(now).toISOString(),
      },
    }
  }

  return {
    action: 'update',
    reason: 'stale with scores, no live data — marking final',
    updateData: {
      status: 'final',
      lastUpdate: new Date(now).toISOString(),
    },
  }
}

export function buildScoreUpdate({ game, liveData, sport, now = Date.now() }) {
  if (!liveData) return decideMissingLiveDataUpdate(game, { now })

  let resolvedStatus = normalizeStatus(liveData.status)
  const gameStart = parseStoredGameDate(game.date)
  const minutesUntilStart = gameStart
    ? (gameStart.getTime() - now) / (1000 * 60)
    : 0

  if (
    resolvedStatus === 'in_progress' &&
    minutesUntilStart > 10 &&
    (liveData.homeScore || 0) === 0 &&
    (liveData.awayScore || 0) === 0
  ) {
    resolvedStatus = 'scheduled'
  }

  const updateData = {
    homeScore: liveData.homeScore ?? game.homeScore,
    awayScore: liveData.awayScore ?? game.awayScore,
    status: resolvedStatus,
    lastUpdate: new Date(now).toISOString(),
  }

  if (sport === 'nhl' && liveData.period) {
    updateData.lastPlay = liveData.periodDescriptor ||
      `Period ${liveData.period}${liveData.clock ? ` - ${liveData.clock}` : ''}`
  } else if (sport === 'mlb' && liveData.inning) {
    updateData.inning = liveData.inning
    updateData.inningHalf = liveData.inningHalf
    updateData.outs = liveData.outs
    updateData.balls = liveData.balls
    updateData.strikes = liveData.strikes
    updateData.lastPlay = liveData.lastPlay
  }

  return { action: 'update', updateData, resolvedStatus }
}

export async function resolveMlbLiveDataForGame(game, {
  mlbLiveByPk,
  fetchLiveGameData,
  fetchEspnMlb,
  now = Date.now(),
} = {}) {
  let liveData = null
  if (game.mlbGameId && mlbLiveByPk) {
    liveData = mlbLiveByPk.get(String(game.mlbGameId)) || null
  }
  if (!liveData && game.mlbGameId && fetchLiveGameData) {
    liveData = await fetchLiveGameData(game.mlbGameId, true)
  }

  const start = parseStoredGameDate(game.date)
  const gameStarted = start ? start.getTime() < now : false
  const mlbStillPreStart = liveData && isPreStartGameStatus(liveData.status) && gameStarted
  const needsEspn = game.espnGameId && (
    !liveData || mlbStillPreStart || shouldConfirmMlbFinalWithEspn(liveData)
  )

  let espnNote = null
  if (needsEspn && fetchEspnMlb) {
    const espnData = await fetchEspnMlb(game.espnGameId)
    if (!liveData) {
      if (
        espnData &&
        (espnData.status === 'final' ||
          espnData.status === 'in_progress' ||
          espnData.homeScore > 0 ||
          espnData.awayScore > 0)
      ) {
        liveData = espnData
      }
    } else {
      const previousStatus = liveData.status
      liveData = reconcileMlbAndEspnStatus(liveData, espnData)
      if (previousStatus === 'final' && liveData?.status === 'in_progress') {
        espnNote = 'MLB API said final but ESPN/live payload is in_progress — keeping in_progress'
      } else if (previousStatus !== 'final' && liveData?.status === 'final' && liveData?.source === 'espn-upgrade') {
        espnNote = 'ESPN STATUS_FINAL/completed — marking final'
      } else if (mlbStillPreStart && espnData) {
        espnNote = `MLB API said ${previousStatus} but ESPN says ${espnData.status} — using ESPN`
      }
    }
  } else if (liveData?.status === 'final') {
    liveData = reconcileMlbAndEspnStatus(liveData, null)
  }

  if (liveData) {
    liveData = {
      ...liveData,
      status: resolveMlbStatusForUpdate(liveData, game.status),
    }
  }

  return { liveData, espnNote }
}

export function formatMatchup(game, awayScore, homeScore) {
  const away = game.away?.abbr || '?'
  const home = game.home?.abbr || '?'
  return `${away} ${awayScore ?? 0} @ ${home} ${homeScore ?? 0}`
}

export function formatLiveDetail(sport, liveData, status) {
  const parts = [status]
  if (sport === 'mlb' && liveData?.inning) {
    const half = liveData.inningHalf ? `${liveData.inningHalf} ` : ''
    parts.push(`${half}${liveData.inning}`.trim())
  } else if (sport === 'nhl' && liveData?.period) {
    parts.push(liveData.periodDescriptor || `P${liveData.period}${liveData.clock ? ` ${liveData.clock}` : ''}`)
  } else if (liveData?.lastPlay) {
    parts.push(liveData.lastPlay)
  }
  return parts.filter(Boolean).join(' · ')
}

export function printScoreRecap({ live, changes, totalUpdated, totalErrors, duration, writtenLabel = 'Rows written' }) {
  console.log('\n----- SCORE RECAP -----')
  console.log(`Ran at: ${new Date().toISOString()}`)
  console.log(`${writtenLabel}: ${totalUpdated}  Errors: ${totalErrors}  Duration: ${duration}s`)

  console.log('\nLIVE GAMES:')
  if (!live.length) {
    console.log('  None in progress')
  } else {
    for (const game of live) {
      console.log(`  ${game.sport.toUpperCase()}  ${game.line}`)
    }
  }

  console.log('\nWHAT CHANGED:')
  if (!changes.length) {
    console.log('  No score or status changes this run')
  } else {
    for (const change of changes) {
      console.log(`  ${change.sport.toUpperCase()}  ${change.line}`)
    }
  }
  console.log('----- END RECAP -----\n')
}

export function parseInclusiveUtcDayRange({ from, to, now = Date.now() } = {}) {
  const start = from
    ? new Date(`${from}T00:00:00.000Z`)
    : new Date(now - 14 * 24 * 60 * 60 * 1000)
  const end = to
    ? new Date(`${to}T23:59:59.999Z`)
    : new Date(now)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error(`Invalid date range ${from || '?'} .. ${to || '?'}`)
  }
  return { start, end }
}

export function parseRepairStuckMlbArgs(argv = []) {
  const take = (flag) => {
    const i = argv.indexOf(flag)
    if (i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--')) return argv[i + 1]
    return null
  }
  return {
    apply: argv.includes('--apply'),
    from: take('--from'),
    to: take('--to'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

export async function fetchActiveGamesForSport(supabase, sport, { now = Date.now(), cutoffDays = 3 } = {}) {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - cutoffDays)

  const { data: activeGames, error } = await supabase
    .from('Game')
    .select(GAME_SELECT)
    .eq('sport', sport)
    .in('status', ACTIVE_GAME_STATUSES)
    .gte('date', cutoff.toISOString())
    .order('date', { ascending: true })

  return { games: activeGames || [], error }
}

export async function fetchStuckMlbGames(supabase, {
  from,
  to,
  now = Date.now(),
  statuses = STUCK_MLB_REPAIR_STATUSES,
} = {}) {
  const range = parseInclusiveUtcDayRange({ from, to, now })
  const { data, error } = await supabase
    .from('Game')
    .select(GAME_SELECT)
    .eq('sport', 'mlb')
    .in('status', statuses)
    .gte('date', range.start.toISOString())
    .lte('date', range.end.toISOString())
    .lt('date', new Date(now).toISOString())
    .order('date', { ascending: true })

  return { games: data || [], error, range }
}

async function resolveTargetGameId(supabase, game, sport) {
  let targetGameId = game.id
  if (!game.espnGameId || !supabase) return targetGameId

  const { data: duplicates } = await supabase
    .from('Game')
    .select('id, oddsApiEventId')
    .eq('espnGameId', game.espnGameId)
    .eq('sport', sport)

  if (duplicates && duplicates.length > 1) {
    const withOdds = duplicates.find(g => g.oddsApiEventId)
    if (withOdds) targetGameId = withOdds.id
  }
  return targetGameId
}

export async function refreshGameScores({
  sport,
  games,
  supabase,
  apply = true,
  mlbLiveByPk = null,
  fetchLiveGameData,
  fetchNHLGameDetail,
  fetchNFLGameDetail,
  fetchEspnMlb,
  now = Date.now(),
  delayMs = 300,
  log = console.log,
  error = console.error,
} = {}) {
  let updated = 0
  let errors = 0
  const live = []
  const changes = []
  const plans = []

  for (const game of games || []) {
    try {
      log(`🔄 Updating ${game.away?.abbr || '?'} @ ${game.home?.abbr || '?'}...`)

      let liveData = null
      if (sport === 'nhl' && game.espnGameId && fetchNHLGameDetail) {
        liveData = await fetchNHLGameDetail(game.espnGameId)
      } else if (sport === 'nfl' && game.espnGameId && fetchNFLGameDetail) {
        liveData = await fetchNFLGameDetail(game.espnGameId)
      } else if (sport === 'mlb') {
        const resolved = await resolveMlbLiveDataForGame(game, {
          mlbLiveByPk,
          fetchLiveGameData,
          fetchEspnMlb,
          now,
        })
        liveData = resolved.liveData
        if (resolved.espnNote) log(`  ℹ️  ${resolved.espnNote}`)
      }

      const plan = buildScoreUpdate({ game, liveData, sport, now })
      plans.push({ game, plan })

      if (plan.action === 'skip') {
        log(`  ⚠️  ${plan.reason}`)
        continue
      }

      const targetGameId = await resolveTargetGameId(supabase, game, sport)
      const resolvedStatus = plan.updateData.status
      const nextAway = plan.updateData.awayScore ?? game.awayScore ?? 0
      const nextHome = plan.updateData.homeScore ?? game.homeScore ?? 0
      const prevAway = game.awayScore ?? 0
      const prevHome = game.homeScore ?? 0
      const prevStatus = normalizeStatus(game.status)

      if (apply && supabase) {
        const { error: updateError } = await supabase
          .from('Game')
          .update(plan.updateData)
          .eq('id', targetGameId)

        if (updateError) {
          error(`  ❌ Update error: ${updateError.message}`)
          errors++
          continue
        }
      } else {
        log(`  💡 Dry-run: would write ${nextAway}-${nextHome} ${prevStatus} → ${resolvedStatus}`)
      }

      log(`  ✅ ${apply ? 'Updated' : 'Would update'}: ${nextAway}-${nextHome} - Status: ${resolvedStatus}`)
      updated++

      const scoreOrStatusChanged =
        prevAway !== nextAway || prevHome !== nextHome || prevStatus !== resolvedStatus

      if (isLiveGameStatus(resolvedStatus)) {
        live.push({
          sport,
          line: `${formatMatchup(game, nextAway, nextHome)}  — ${formatLiveDetail(sport, liveData, resolvedStatus)}`,
        })
      }

      if (scoreOrStatusChanged) {
        changes.push({
          sport,
          line: `${game.away?.abbr || '?'} @ ${game.home?.abbr || '?'}  ${prevAway}-${prevHome} ${prevStatus} → ${nextAway}-${nextHome} ${resolvedStatus}`,
        })
      }

      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
    } catch (err) {
      error(`  ❌ Error updating ${game.away?.abbr || '?'} @ ${game.home?.abbr || '?'}:`, err.message)
      errors++
    }
  }

  return { updated, errors, live, changes, plans }
}
