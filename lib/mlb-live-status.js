/**
 * MLB live status mapping and ESPN reconcile.
 *
 * The Stats API linescore sometimes omits codedGameState and only has
 * abstractGameState "Live". Older mapping treated any unknown 9th-inning
 * state as final, which stuck because update-scores-safely only selected
 * scheduled|in_progress rows.
 *
 * Self-heal: the hourly updater re-checks MLB games marked final in the
 * last RECENT_MLB_FINAL_RECHECK_MS window and prefers ESPN in_progress
 * (or a still-live MLB payload) over a false final.
 */

export const RECENT_MLB_FINAL_RECHECK_MS = 4 * 60 * 60 * 1000

const FINAL_CODED = new Set(['F', 'O'])
const LIVE_CODED = new Set(['I', 'N'])

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

export function hasExplicitMlbFinalStatus(status = {}) {
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
 * True when the payload still has an in-progress count / half / runners.
 * Used as a guard, not as the only signal for Final (walk-offs can have
 * outs < 3 with an explicit Final/F status).
 */
export function mlbPayloadLooksLive(liveData) {
  if (!liveData) return false

  const half = normalizeText(liveData.inningHalf || liveData.inningState)
  const outs = toCount(liveData.outs)
  const balls = toCount(liveData.balls)
  const strikes = toCount(liveData.strikes)

  if (half.includes('mid')) return true
  if (balls != null && balls > 0) return true
  if (strikes != null && strikes > 0) return true
  if (outs != null && outs < 3) return true
  if (liveData.runnerOn1st || liveData.runnerOn2nd || liveData.runnerOn3rd) return true
  if (liveData.currentBatterId || liveData.currentPitcherId) return true
  return false
}

/**
 * Resolve MLB linescore status. Never mark final just because inning >= 9.
 * Only Final / F / Game Over / completed (and equivalent) become final.
 */
export function resolveMlbLinescoreStatus(linescoreData = {}) {
  const status = linescoreData.status || {}
  const detailed = normalizeText(status.detailedState)
  const coded = codedValue(status.codedGameState)
  const abstract = normalizeText(status.abstractGameState)

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

  if (detailed.includes('postponed')) return 'postponed'
  if (coded === 'D' || detailed.includes('delay') || detailed.includes('suspended')) {
    return 'in_progress'
  }
  if (coded === 'W' || detailed === 'warmup') return 'warmup'
  if (coded === 'P' || detailed === 'pre-game' || detailed === 'pregame') return 'pre_game'
  if (coded === 'C' || detailed.includes('cancel')) return 'cancelled'
  if (coded === 'S' || detailed === 'scheduled' || abstract === 'preview') return 'scheduled'

  const currentInning = linescoreData.currentInning
  const homeScore = linescoreData.teams?.home?.runs || 0
  const awayScore = linescoreData.teams?.away?.runs || 0

  if (currentInning && currentInning > 0) return 'in_progress'
  if (homeScore > 0 || awayScore > 0) return 'in_progress'
  return 'scheduled'
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
  if (statusType === 'STATUS_FINAL' || completed) status = 'final'
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
    inning: competition.status?.period || null,
    inningHalf,
  }
}

/**
 * If MLB says final but ESPN is still live, keep in_progress.
 * If ESPN is unavailable and the MLB payload still looks live without an
 * explicit Final/F/Game Over, keep in_progress.
 */
export function reconcileMlbAndEspnStatus(mlbLiveData, espnLiveData) {
  if (!mlbLiveData && !espnLiveData) return null
  if (!mlbLiveData) return espnLiveData

  const mlbStatus = normalizeText(mlbLiveData.status)
  const espnStatus = espnLiveData ? normalizeText(espnLiveData.status) : ''
  const explicitFinal = hasExplicitMlbFinalStatus(mlbLiveData.mlbStatus || {})

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
  const ts = new Date(stamp).getTime()
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
  return normalizeText(liveData?.status) === 'final'
}
