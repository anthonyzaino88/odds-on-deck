/**
 * MLB Published / Featured recording gate.
 *
 * Morning persist (≈8:10 AM ET) is 8+ hours before first pitch and before
 * lineups post. MLB props are recorded only when:
 *   1. The game is in the pre-first-pitch window (default 90 minutes)
 *   2. The game has not started
 *   3. The player is in the confirmed batting order, or is the
 *      confirmed probable / starting pitcher
 *
 * NFL / NHL are not gated here.
 *
 * Ops quiet period: the owner’s :09 ET hourly job must not write
 * between :05 and :15 ET. Recording steps no-op in that window.
 */

import { normalizePlayerName } from './parlay-integrity.js'
import { normalizeMlbPlayerName } from './mlb-stat-grade.js'
import { isMlbStatsDoubleheader } from './mlb-confirmed-lineup.js'
import { etDateKey } from './game-grade-eligibility.js'
import { parseRecordInstant } from './published-picks.js'
import { isDeadStatus, isStartedOrEndedStatus } from './game-status.js'

export const MLB_RECORD_WINDOW_MINUTES = 90
export const OPS_QUIET_MINUTE_START = 5
export const OPS_QUIET_MINUTE_END = 15
export const MLB_RECORD_HOUR_START = 11
export const MLB_RECORD_HOUR_START_POSTSEASON = 12
export const MLB_RECORD_HOUR_END = 22
export const ET = 'America/New_York'

const PITCHER_MARKETS = new Set([
  'pitcher_strikeouts', 'pitcher_outs', 'pitcher_walks',
  'pitcher_hits_allowed', 'pitcher_earned_runs', 'pitcher_record_a_win',
  'p_strikeouts', 'p_outs', 'p_walks',
  'strikeouts', 'outs',
])

export function isMlbSport(value) {
  return String(value || '').toLowerCase().trim() === 'mlb'
}

export function etClockParts(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant)
  const get = (type) => Number(parts.find((part) => part.type === type)?.value)
  let hour = get('hour')
  if (hour === 24) hour = 0
  return { hour, minute: get('minute') }
}

/**
 * :05–:15 ET inclusive. Hourly score jobs run at :09; recording
 * must not write in this window.
 */
export function isOpsWriteQuietPeriod(now = new Date()) {
  const { minute } = etClockParts(now)
  return Number.isFinite(minute)
    && minute >= OPS_QUIET_MINUTE_START
    && minute <= OPS_QUIET_MINUTE_END
}

/**
 * Recommended ops clock: 11–22 ET regular season, 12–22 postseason.
 * :16 and :46 inside those hours. :05–:15 is still a no-write window.
 */
export function isMlbRecordingClockHour(now = new Date(), { postseason = false } = {}) {
  const { hour } = etClockParts(now)
  const start = postseason ? MLB_RECORD_HOUR_START_POSTSEASON : MLB_RECORD_HOUR_START
  return Number.isFinite(hour) && hour >= start && hour <= MLB_RECORD_HOUR_END
}

/**
 * Same-day doubleheader key. Game.id is `away_at_home_YYYY-MM-DD`
 * (optional `_g2` / `_2`). Two rows with that matchup+day share one
 * cache gameId and can steal each other's window or lineup.
 */
export function mlbMatchupDayKey(game) {
  const id = String(game?.id || '').trim()
  const stripped = id.replace(/_(g2|game2|2)$/i, '')
  const fromId = stripped.match(/^(.+_at_.+)_(\d{4}-\d{2}-\d{2})$/i)
  if (fromId) return `${fromId[1].toLowerCase()}|${fromId[2]}`
  const start = parseMlbGameStart(game)
  const day = start ? etDateKey(start) : ''
  return `${id.toLowerCase()}|${day}`
}

export function findMlbDoubleheaderIds(games) {
  const groups = new Map()
  for (const game of games || []) {
    const key = mlbMatchupDayKey(game)
    const list = groups.get(key) || []
    list.push(game)
    groups.set(key, list)
  }
  const skip = new Set()
  for (const list of groups.values()) {
    const pks = new Set(list.map((game) => String(game?.mlbGameId || '')).filter(Boolean))
    if (list.length > 1 || pks.size > 1) {
      for (const game of list) {
        if (game?.id) skip.add(game.id)
      }
    }
  }
  return skip
}

export function buildMlbFeaturedRequests(windowGames) {
  const games = Array.isArray(windowGames) ? windowGames : []
  const requests = games.map((game) => ({
    type: 'single_game',
    gameId: game.id,
    gameIds: [game.id],
  }))
  if (games.length >= 2) {
    requests.push({
      type: 'multi_game',
      gameId: null,
      gameIds: games.map((game) => game.id),
    })
  }
  return requests
}

export function parseMlbGameStart(gameOrDate) {
  if (!gameOrDate) return null
  if (gameOrDate instanceof Date) {
    return Number.isNaN(gameOrDate.getTime()) ? null : gameOrDate
  }
  if (typeof gameOrDate !== 'object') return parseRecordInstant(gameOrDate)
  return parseRecordInstant(gameOrDate.date)
    || parseRecordInstant(gameOrDate.gameDate)
    || parseRecordInstant(gameOrDate.gameTime)
}

export function mlbGameStatus(game) {
  return String(game?.status || game?.detailedState || '').toLowerCase().replace(/_/g, ' ').trim()
}

export function hasMlbGameStarted(game, now = new Date()) {
  const status = mlbGameStatus(game)
  if (isStartedOrEndedStatus(status) || isDeadStatus(status)) return true
  const start = parseMlbGameStart(game)
  const instant = now instanceof Date ? now : new Date(now)
  if (!start || Number.isNaN(instant.getTime())) return false
  return start.getTime() <= instant.getTime()
}

export function isInMlbRecordWindow(game, now = new Date(), windowMinutes = MLB_RECORD_WINDOW_MINUTES) {
  const start = parseMlbGameStart(game)
  const instant = now instanceof Date ? now : new Date(now)
  if (!start || Number.isNaN(instant.getTime())) return false
  const ms = start.getTime() - instant.getTime()
  const windowMs = Number(windowMinutes) * 60 * 1000
  return ms > 0 && ms <= windowMs
}

export function isPitcherProp(prop) {
  const type = String(prop?.type || prop?.propType || '').toLowerCase().trim()
  if (PITCHER_MARKETS.has(type)) return true
  return type.startsWith('pitcher_') || type.startsWith('p_')
}

function lastName(normalized) {
  const parts = String(normalized || '').split(' ').filter(Boolean)
  return parts[parts.length - 1] || ''
}

/**
 * Accent-safe match name. PR #45's grader uses NFD + strip diacritics
 * (`normalizeMlbPlayerName`). `normalizePlayerName` alone deletes the
 * combining marks ('José Ramírez' → 'jos ram rez').
 */
export function normalizeMlbMatchName(name) {
  return normalizePlayerName(normalizeMlbPlayerName(name))
}

/**
 * Same player under common MLB name drift (Jr / accents / "G. Cole").
 */
export function mlbPlayerNamesMatch(a, b) {
  const left = normalizeMlbMatchName(a)
  const right = normalizeMlbMatchName(b)
  if (!left || !right) return false
  if (left === right) return true
  if (left.replace(/\s+/g, '') === right.replace(/\s+/g, '')) return true

  const leftLast = lastName(left)
  const rightLast = lastName(right)
  if (!leftLast || leftLast !== rightLast) return false

  const leftFirst = left.split(' ')[0] || ''
  const rightFirst = right.split(' ')[0] || ''
  if (leftFirst.length === 1) return rightFirst.startsWith(leftFirst)
  if (rightFirst.length === 1) return leftFirst.startsWith(rightFirst)
  return leftFirst === rightFirst
}

export function isConfirmedMlbBatter(playerName, lineup) {
  const batters = lineup?.batters || []
  return batters.some((player) => mlbPlayerNamesMatch(playerName, player?.fullName || player?.name))
}

export function isConfirmedMlbPitcher(playerName, lineup) {
  const pitchers = [
    ...(lineup?.pitchers || []),
    lineup?.probableHome,
    lineup?.probableAway,
    lineup?.startingHome,
    lineup?.startingAway,
  ].filter(Boolean)
  return pitchers.some((player) => mlbPlayerNamesMatch(playerName, player?.fullName || player?.name || player))
}

export function isMlbPlayerConfirmedForProp(prop, lineup) {
  const name = prop?.playerName
  if (!name || !lineup) return false
  if (isPitcherProp(prop)) return isConfirmedMlbPitcher(name, lineup)
  return isConfirmedMlbBatter(name, lineup)
}

export function lineupLooksConfirmed(lineup) {
  if (!lineup || typeof lineup !== 'object') return false
  const batters = Array.isArray(lineup.batters) ? lineup.batters.length : 0
  const pitchers = [
    ...(lineup.pitchers || []),
    lineup.probableHome,
    lineup.probableAway,
    lineup.startingHome,
    lineup.startingAway,
  ].filter(Boolean).length
  return batters >= 1 || pitchers >= 1
}

/**
 * Decision for one cache / board prop. NFL/NHL always record (existing).
 * MLB requires window + confirmed player. Missing gate → skip MLB.
 */
export function mlbPublishedRecordDecision(prop, context = {}) {
  if (!isMlbSport(prop?.sport)) {
    return { record: true, reason: 'not_mlb' }
  }

  const now = context.now || new Date()
  if (isOpsWriteQuietPeriod(now) && !context.allowQuietPeriod) {
    return { record: false, reason: 'ops_quiet_period' }
  }

  const gameId = prop.gameId || prop.gameIdRef
  const game = context.game
    || context.gamesById?.get?.(gameId)
    || context.gamesById?.[gameId]
  if (!game) {
    return { record: false, reason: 'mlb_game_missing' }
  }
  if (hasMlbGameStarted(game, now)) {
    return { record: false, reason: 'mlb_game_started' }
  }
  if (!isInMlbRecordWindow(game, now, context.windowMinutes)) {
    return { record: false, reason: 'mlb_outside_window' }
  }

  const lineup = context.lineup
    || context.lineupsByGameId?.get?.(game.id || gameId)
    || context.lineupsByGameId?.[game.id || gameId]
  if (lineup?.scheduleUnavailable) {
    return { record: false, reason: 'mlb_schedule_unavailable' }
  }
  if (isMlbStatsDoubleheader(lineup)) {
    return { record: false, reason: 'mlb_doubleheader' }
  }
  if (!lineupLooksConfirmed(lineup)) {
    return { record: false, reason: 'mlb_lineup_unavailable' }
  }
  if (!isMlbPlayerConfirmedForProp(prop, lineup)) {
    return { record: false, reason: 'mlb_player_not_confirmed' }
  }
  return { record: true, reason: 'mlb_confirmed' }
}

export function featuredMlbRecordDecision(parlay, context = {}) {
  const sport = String(parlay?.sport || '').toLowerCase().trim()
  const legs = Array.isArray(parlay?.legs) ? parlay.legs : []
  const mlbLegs = legs.filter((leg) => isMlbSport(leg.sport) || sport === 'mlb')
  if (sport !== 'mlb' && mlbLegs.length === 0) {
    return { record: true, reason: 'not_mlb' }
  }

  const now = context.now || new Date()
  if (isOpsWriteQuietPeriod(now) && !context.allowQuietPeriod) {
    return { record: false, reason: 'ops_quiet_period' }
  }
  if (!context.gamesById && !context.lineupsByGameId && !context.game) {
    return { record: false, reason: 'mlb_lineup_window' }
  }

  for (const leg of (mlbLegs.length ? mlbLegs : legs)) {
    const decision = mlbPublishedRecordDecision(
      { ...leg, sport: leg.sport || sport, gameId: leg.gameId || leg.gameIdRef },
      context,
    )
    if (!decision.record) return decision
  }
  return { record: true, reason: 'mlb_confirmed' }
}
