/**
 * Pure helpers for fetch-live-odds: map events to the right Game row
 * and stamp props/odds with the redirected game's date (or commence_time).
 * No I/O — scripts/ and operations/ call these from their write loops.
 */

import { parseStoredGameDate } from './score-updater.js'
import { isPreStartStatus } from './game-status.js'

export function storedInstantIso(value) {
  const parsed = value instanceof Date ? value : parseStoredGameDate(value)
  if (!parsed || Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

export function eventCommenceMs(commenceTime, fallbackDate) {
  const fromEvent = storedInstantIso(commenceTime)
  if (fromEvent) return Date.parse(fromEvent)
  if (fallbackDate) {
    const fallback = Date.parse(`${fallbackDate}T12:00:00.000Z`)
    if (Number.isFinite(fallback)) return fallback
  }
  return NaN
}

/**
 * Only unmapped Game rows may receive a new oddsApiEventId.
 * Falling back to the closest already-mapped sibling steals that
 * event and lands odds/props on the wrong game (doubleheaders, makeups).
 */
export function isOpenForOddsEvent(game, eventId) {
  const mapped = game?.oddsApiEventId
  if (mapped == null || mapped === '') return true
  return eventId != null && eventId !== '' && String(mapped) === String(eventId)
}

/**
 * saveGameOdds team-name fallback: first same-teams row that is still
 * unmapped (or already this event). A mapped sibling must not be stolen.
 */
export function pickOpenTeamMatch(games, eventId) {
  return (games || []).find((game) => isOpenForOddsEvent(game, eventId)) || null
}

/**
 * Team-name fallback for saveGameOdds.
 * ±1 day is only for timezone / date-boundary misses (no same-day
 * team matches at all). If same-day matches exist but are all mapped
 * to other events, stay unmapped — do not attach to tomorrow's game.
 */
export function resolveTeamNameFallback(sameDayMatches, adjacentDayMatches, eventId) {
  const sameDay = Array.isArray(sameDayMatches) ? sameDayMatches : []
  if (sameDay.length > 0) return pickOpenTeamMatch(sameDay, eventId)
  return pickOpenTeamMatch(adjacentDayMatches, eventId)
}

/**
 * Game columns mapAndSaveEventIds must load. `status` is required:
 * pickUnmappedOddsGame only maps pre-start rows.
 */
export const MAP_EVENT_GAME_SELECT =
  'id, sport, date, status, homeId, awayId, oddsApiEventId, espnGameId, home:Team!Game_homeId_fkey(name, abbr), away:Team!Game_awayId_fkey(name, abbr)'

/** An Odds API event may only map to a Game whose start is within this window. */
export const ODDS_EVENT_MATCH_WINDOW_MS = 6 * 60 * 60 * 1000
/** A mapped Game whose start differs from its event by more than this is re-mapped. */
export const ODDS_EVENT_REMAP_DRIFT_MS = 3 * 60 * 60 * 1000

function gameStartMs(game) {
  const ms = parseStoredGameDate(game?.date)?.getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * |Game.date - event commence_time| in ms, or null when either is unknown.
 */
export function eventStartDriftMs(game, eventTime) {
  const start = gameStartMs(game)
  const target = Number(eventTime)
  if (start == null || !Number.isFinite(target)) return null
  return Math.abs(start - target)
}

export function shouldRemapEvent(game, eventTime, driftMs = ODDS_EVENT_REMAP_DRIFT_MS) {
  const drift = eventStartDriftMs(game, eventTime)
  return drift != null && drift > driftMs
}

/**
 * Pick the open Game row closest to the event start, but only within
 * `windowMs`. Outside the window returns null (log + leave unmapped)
 * instead of falling forward onto the next day's game — that cascade
 * put TB@CLE 10/15 odds on 10/16 and 10/16 odds/props on 10/17.
 *
 * `isReclaimable(game)` lets the caller treat a row as open even though
 * it is mapped (e.g. its event id is no longer in the Odds API feed).
 * Only pre-start rows may receive a mapping — unmapped live / final /
 * postponed rows are left alone, same as a mapped reclaim.
 */
export function pickUnmappedOddsGame(teamMatches, eventTime, {
  windowMs = ODDS_EVENT_MATCH_WINDOW_MS,
  isReclaimable = null,
} = {}) {
  const open = (teamMatches || []).filter((game) => {
    if (!isPreStartStatus(game?.status)) return false
    if (!game?.oddsApiEventId) return true
    return typeof isReclaimable === 'function' && isReclaimable(game)
  })
  if (open.length === 0) return null
  const target = Number(eventTime)
  if (!Number.isFinite(target)) {
    // Unknown event time: only an unambiguous single unmapped row is safe.
    const unmapped = open.filter((game) => !game?.oddsApiEventId)
    return unmapped.length === 1 ? unmapped[0] : null
  }
  const inWindow = open
    .map((game) => ({ game, drift: eventStartDriftMs(game, target) }))
    .filter(({ drift }) => drift != null && drift <= windowMs)
    .sort((a, b) => a.drift - b.drift)
  return inWindow[0]?.game || null
}

/**
 * Milliseconds since midnight America/New_York for `now`. Used so a
 * props cache from yesterday morning never counts as fresh today.
 */
export function msSinceEtMidnight(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0)
  const hour = get('hour') % 24
  return ((hour * 60 + get('minute')) * 60 + get('second')) * 1000 + date.getMilliseconds()
}

/**
 * When the mapped row is already final, props belong on the next
 * scheduled sibling. Prefer that sibling's date, then the event
 * commence_time — never the final game's date or the script run time.
 */
export function resolvePropLanding({
  mappedGame = null,
  redirectGame = null,
  commenceTime = null,
  now = new Date(),
} = {}) {
  const target = redirectGame || mappedGame
  const redirected = Boolean(redirectGame?.id && redirectGame.id !== mappedGame?.id)
  const gameTime =
    storedInstantIso(redirectGame?.date)
    || storedInstantIso(commenceTime)
    || storedInstantIso(mappedGame?.date)
    || (now instanceof Date ? now.toISOString() : new Date(now).toISOString())
  return {
    gameId: target?.id || mappedGame?.id || null,
    gameTime,
    redirected,
  }
}

export function oddsInsertPayload({
  id,
  gameId,
  book,
  market,
  priceAway,
  priceHome,
  spread,
  total,
  ts,
  commenceTime,
  includeCommenceTime = false,
} = {}) {
  const row = {
    id,
    gameId,
    book,
    market,
    priceAway,
    priceHome,
    spread,
    total,
    ts,
  }
  if (includeCommenceTime) {
    const commence = storedInstantIso(commenceTime)
    if (commence) row.commence_time = commence
  }
  return row
}

const MISSING_COLUMN = /column|does not exist|schema cache|could not find/i

export function oddsInsertFailedForMissingCommenceTime(error) {
  if (!error) return false
  const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`
  const code = String(error.code || '')
  if (!MISSING_COLUMN.test(message) && code !== 'PGRST204' && code !== '42703') return false
  return /commence_time/i.test(message) || code === 'PGRST204' || code === '42703'
}
