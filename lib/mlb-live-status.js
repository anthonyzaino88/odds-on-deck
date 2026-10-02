/**
 * MLB live status mapping and ESPN reconcile.
 *
 * Per-game /game/{pk}/linescore has no status object. Status lives on the
 * schedule game (`schedule?hydrate=linescore`). Missing status is unknown,
 * never a silent in_progress — the updater then asks ESPN.
 *
 * Never mark final just because inning >= 9 (PR #27). Honor real codes:
 * Final (F), Game Over (O), postponed, suspended. ESPN may upgrade to final
 * only when STATUS_FINAL and completed=true, and only when MLB is not
 * explicitly live.
 *
 * Self-heal: the hourly updater re-checks MLB games marked final in the
 * last RECENT_MLB_FINAL_RECHECK_MS window and prefers ESPN in_progress
 * (or a still-live MLB payload without an explicit Final) over a false final.
 * A real Final/F/Game Over must not flip back to in_progress on leftover
 * balls/strikes.
 */

import { parseSupabaseDate } from './date-utils.js'

export const RECENT_MLB_FINAL_RECHECK_MS = 4 * 60 * 60 * 1000

const FINAL_CODED = new Set(['F', 'O'])
const LIVE_CODED = new Set(['I', 'N'])

/**
 * Non-terminal statuses resolveMlbLinescoreStatus can return.
 * `unknown` is never written to Game.status (see resolveMlbStatusForUpdate)
 * but is kept selectable if it ever leaks into the DB.
 */
export const MLB_RESOLVER_NON_TERMINAL_STATUSES = Object.freeze([
  'scheduled',
  'pre_game',
  'warmup',
  'in_progress',
  'unknown',
])

/**
 * Game.status values the hourly score updater must keep selecting.
 * Includes hyphen/underscore aliases plus delayed (ESPN / normalizeStatus).
 * Coded D (delay) from the MLB resolver maps to in_progress, not delayed.
 */
export const ACTIVE_GAME_STATUSES = Object.freeze([
  'scheduled',
  'pre_game',
  'pre-game',
  'pregame',
  'warmup',
  'delayed',
  'in_progress',
  'in-progress',
  'unknown',
])

/** Pre-start statuses that can go stale if no live payload ever arrives. */
export const PRE_START_GAME_STATUSES = Object.freeze([
  'scheduled',
  'pre_game',
  'pre-game',
  'pregame',
  'warmup',
])

export const STUCK_MLB_REPAIR_STATUSES = Object.freeze([
  'pre_game',
  'warmup',
  'delayed',
])

export function isActiveGameStatus(status) {
  return ACTIVE_GAME_STATUSES.includes(normalizeText(status))
}

export function isPreStartGameStatus(status) {
  return PRE_START_GAME_STATUSES.includes(normalizeText(status))
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function codedValue(value) {
  return String(value || '').trim().toUpperCase()
}

function toCount(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function isLiveGameStatus(status) {
  const value = normalizeText(status)
  return (
    value.includes('progress') ||
    value === 'halftime' ||
    value.includes('delay') ||
    value === 'warmup'
  )
}

export function hasAnyMlbStatusSignal(status) {
  if (!status || typeof status !== 'object') return false
  return Boolean(
    status.codedGameState ||
    status.abstractGameState ||
    status.detailedState ||
    status.abstractGameCode ||
    status.statusCode ||
    status.completed === true
  )
}

function isNonFinalTerminalStatus(status = {}) {
  const detailed = normalizeText(status.detailedState)
  const coded = codedValue(status.codedGameState)
  return (
    detailed.includes('postponed') ||
    detailed.includes('suspended') ||
    detailed.includes('cancel') ||
    coded === 'C' ||
    coded === 'U'
  )
}

export function hasExplicitMlbFinalStatus(status = {}) {
  if (isNonFinalTerminalStatus(status)) return false

  const coded = codedValue(status.codedGameState)
  const abstract = normalizeText(status.abstractGameState)
  const detailed = normalizeText(status.detailedState)
  const abstractCode = codedValue(status.abstractGameCode)

  if (FINAL_CODED.has(coded) || abstractCode === 'F') return true
  if (abstract === 'final') return true
  if (detailed === 'final' || detailed === 'game over') return true
  if (detailed.startsWith('final')) return true
  if (detailed.startsWith('completed early')) return true
  if (status.completed === true) return true
  return false
}

export function hasExplicitMlbLiveStatus(status = {}) {
  if (isNonFinalTerminalStatus(status)) return false

  const coded = codedValue(status.codedGameState)
  const abstract = normalizeText(status.abstractGameState)
  const detailed = normalizeText(status.detailedState)
  const abstractCode = codedValue(status.abstractGameCode)

  if (LIVE_CODED.has(coded) || abstractCode === 'L') return true
  if (abstract === 'live') return true
  if (detailed === 'in progress' || detailed.includes('in progress')) return true
  if (detailed.includes('manager challenge') || detailed.includes('instant replay')) return true
  if (detailed.includes('review')) return true
  return false
}

/**
 * True when the payload still has an in-progress half / in-inning state.
 * Used as a guard, not as the only signal for Final (walk-offs can have
 * outs < 3 with an explicit Final/F status).
 *
 * With outs=3, leftover balls/strikes (and leftover batter/pitcher ids
 * that the API leaves on Final games) must not count as live.
 */
export function mlbPayloadLooksLive(liveData) {
  if (!liveData) return false

  const half = normalizeText(liveData.inningHalf || liveData.inningState)
  const outs = toCount(liveData.outs)
  const balls = toCount(liveData.balls)
  const strikes = toCount(liveData.strikes)

  if (half.includes('mid')) return true
  if (outs != null && outs < 3) return true
  if (liveData.runnerOn1st || liveData.runnerOn2nd || liveData.runnerOn3rd) return true
  if (outs === 3) return false
  if (balls != null && balls > 0) return true
  if (strikes != null && strikes > 0) return true
  if (liveData.currentBatterId || liveData.currentPitcherId) return true
  return false
}

/**
 * Resolve MLB linescore status. Never mark final just because inning >= 9.
 * Only Final / F / Game Over / completed (and equivalent) become final.
 * Missing or unrecognized status is unknown — never inferred in_progress.
 */
export function resolveMlbLinescoreStatus(linescoreData = {}) {
  const status = linescoreData.status || {}
  if (!hasAnyMlbStatusSignal(status)) return 'unknown'

  const detailed = normalizeText(status.detailedState)
  const coded = codedValue(status.codedGameState)
  const abstract = normalizeText(status.abstractGameState)

  if (detailed.includes('postponed')) return 'postponed'
  if (detailed.includes('suspended') || coded === 'U') return 'suspended'
  if (coded === 'C' || detailed.includes('cancel')) return 'cancelled'

  const explicitLive = hasExplicitMlbLiveStatus(status)
  const explicitFinal = hasExplicitMlbFinalStatus(status)

  if (explicitLive && !explicitFinal) {
    return 'in_progress'
  }

  if (explicitLive && explicitFinal) {
    return mlbPayloadLooksLive({
      inningHalf: linescoreData.inningState || linescoreData.inningHalf,
      outs: linescoreData.outs,
      balls: linescoreData.balls,
      strikes: linescoreData.strikes,
      runnerOn1st: linescoreData.offense?.first?.id,
      runnerOn2nd: linescoreData.offense?.second?.id,
      runnerOn3rd: linescoreData.offense?.third?.id,
      currentBatterId: linescoreData.offense?.batter?.id,
      currentPitcherId: linescoreData.defense?.pitcher?.id,
    })
      ? 'in_progress'
      : 'final'
  }

  if (explicitFinal) {
    return 'final'
  }

  if (coded === 'D' || detailed.includes('delay')) {
    return 'in_progress'
  }
  if (coded === 'W' || detailed === 'warmup') return 'warmup'
  if (coded === 'P' || detailed === 'pre-game' || detailed === 'pregame') return 'pre_game'
  if (coded === 'S' || detailed === 'scheduled' || abstract === 'preview') return 'scheduled'

  return 'unknown'
}

export function resolveMlbInningHalf(linescoreData = {}) {
  const state = linescoreData.inningState
  if (state) return state
  return linescoreData.inningHalf || null
}

export function parseEspnMlbSummary(data) {
  const competition = data?.header?.competitions?.[0]
  if (!competition) return null

  const competitors = competition.competitors || []
  const home = competitors.find(c => c.homeAway === 'home')
  const away = competitors.find(c => c.homeAway === 'away')

  const statusType = competition.status?.type?.name || ''
  const shortDetail = competition.status?.type?.shortDetail || ''
  const completed = competition.status?.type?.completed === true

  let status = 'scheduled'
  if (statusType === 'STATUS_FINAL' && completed) status = 'final'
  else if (
    statusType === 'STATUS_IN_PROGRESS' ||
    statusType === 'STATUS_RAIN_DELAY' ||
    statusType === 'STATUS_DELAYED'
  ) {
    status = 'in_progress'
  }

  let inningHalf = null
  if (/\btop\b/i.test(shortDetail)) inningHalf = 'Top'
  else if (/\bbot(tom)?\b/i.test(shortDetail)) inningHalf = 'Bottom'
  else if (/\bmid(dle)?\b/i.test(shortDetail)) inningHalf = 'Middle'

  return {
    homeScore: parseInt(home?.score, 10) || 0,
    awayScore: parseInt(away?.score, 10) || 0,
    status,
    completed,
    statusType,
    inning: competition.status?.period || null,
    inningHalf,
  }
}

export function isEspnCompletedFinal(espnLiveData) {
  if (!espnLiveData) return false
  const type = String(espnLiveData.statusType || '').toUpperCase()
  return type === 'STATUS_FINAL' && espnLiveData.completed === true
}

/**
 * If MLB says final but ESPN is still live, keep in_progress.
 * If ESPN is STATUS_FINAL + completed and MLB is not explicitly live,
 * upgrade to final (covers missing linescore status).
 * If ESPN is unavailable and the MLB payload still looks live without an
 * explicit Final/F/Game Over, keep in_progress.
 */
export function reconcileMlbAndEspnStatus(mlbLiveData, espnLiveData) {
  if (!mlbLiveData && !espnLiveData) return null
  if (!mlbLiveData) {
    if (isEspnCompletedFinal(espnLiveData) || espnLiveData.status === 'final') {
      return {
        ...espnLiveData,
        status: isEspnCompletedFinal(espnLiveData) ? 'final' : espnLiveData.status,
        source: 'espn',
      }
    }
    return espnLiveData
  }

  const mlbStatus = normalizeText(mlbLiveData.status)
  const espnStatus = espnLiveData ? normalizeText(espnLiveData.status) : ''
  const explicitFinal = hasExplicitMlbFinalStatus(mlbLiveData.mlbStatus || {})
  const explicitLive = hasExplicitMlbLiveStatus(mlbLiveData.mlbStatus || {})

  if (
    isEspnCompletedFinal(espnLiveData) &&
    !explicitLive &&
    mlbStatus !== 'final' &&
    mlbStatus !== 'postponed' &&
    mlbStatus !== 'suspended' &&
    mlbStatus !== 'cancelled'
  ) {
    return {
      ...mlbLiveData,
      homeScore: espnLiveData.homeScore ?? mlbLiveData.homeScore,
      awayScore: espnLiveData.awayScore ?? mlbLiveData.awayScore,
      inning: espnLiveData.inning ?? mlbLiveData.inning,
      inningHalf: espnLiveData.inningHalf ?? mlbLiveData.inningHalf,
      status: 'final',
      source: 'espn-upgrade',
    }
  }

  if (
    mlbStatus === 'scheduled' &&
    espnLiveData &&
    (isLiveGameStatus(espnStatus) || espnStatus === 'final' || (espnLiveData.homeScore || 0) > 0 || (espnLiveData.awayScore || 0) > 0)
  ) {
    return {
      ...mlbLiveData,
      ...espnLiveData,
      source: 'espn-override',
    }
  }

  if (mlbStatus === 'final' && espnLiveData && isLiveGameStatus(espnStatus)) {
    return {
      ...mlbLiveData,
      homeScore: espnLiveData.homeScore ?? mlbLiveData.homeScore,
      awayScore: espnLiveData.awayScore ?? mlbLiveData.awayScore,
      inning: espnLiveData.inning ?? mlbLiveData.inning,
      inningHalf: espnLiveData.inningHalf ?? mlbLiveData.inningHalf,
      status: 'in_progress',
      source: 'espn-override',
    }
  }

  if (mlbStatus === 'final' && !explicitFinal && mlbPayloadLooksLive(mlbLiveData)) {
    return {
      ...mlbLiveData,
      status: 'in_progress',
      source: 'live-payload-guard',
    }
  }

  return {
    ...mlbLiveData,
    source: mlbLiveData.source || 'mlb',
  }
}

export function isRecentMlbFinalForRecheck(game, { now = Date.now(), windowMs = RECENT_MLB_FINAL_RECHECK_MS } = {}) {
  if (normalizeText(game?.status) !== 'final') return false
  const stamp = game.lastUpdate || game.date
  if (!stamp) return false
  const ts = parseSupabaseDate(stamp)?.getTime()
  if (!Number.isFinite(ts)) return false
  return now - ts >= 0 && now - ts <= windowMs
}

export function mergeActiveAndRecentFinalGames(activeGames = [], recentFinals = [], options) {
  const extras = (recentFinals || []).filter(game => isRecentMlbFinalForRecheck(game, options))
  const merged = []
  const seen = new Set()
  for (const game of [...(activeGames || []), ...extras]) {
    if (!game?.id || seen.has(game.id)) continue
    seen.add(game.id)
    merged.push(game)
  }
  return merged
}

export function shouldConfirmMlbFinalWithEspn(liveData) {
  const status = normalizeText(liveData?.status)
  if (status === 'final' || status === 'unknown') return true
  const inning = Number(liveData?.inning)
  if (Number.isFinite(inning) && inning >= 9) return true
  return false
}

/**
 * Unknown is not a DB status — keep the previous row so it stays in the
 * scheduled|in_progress updater query for the next pass.
 */
export function resolveMlbStatusForUpdate(liveData, previousStatus) {
  const status = normalizeText(liveData?.status)
  if (!liveData || !status || status === 'unknown') {
    return previousStatus || 'in_progress'
  }
  return liveData.status
}
