/**
 * Pure helpers for fetch-live-odds: map events to the right Game row
 * and stamp props/odds with the redirected game's date (or commence_time).
 * No I/O — scripts/ and operations/ call these from their write loops.
 */

import { parseStoredGameDate } from './score-updater.js'

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

export function pickUnmappedOddsGame(teamMatches, eventTime) {
  const unmapped = (teamMatches || []).filter((game) => !game?.oddsApiEventId)
  if (unmapped.length === 0) return null
  const target = Number(eventTime)
  if (!Number.isFinite(target)) return unmapped[0]
  return [...unmapped].sort((a, b) => {
    const aMs = parseStoredGameDate(a.date)?.getTime() ?? Number.POSITIVE_INFINITY
    const bMs = parseStoredGameDate(b.date)?.getTime() ?? Number.POSITIVE_INFINITY
    return Math.abs(aMs - target) - Math.abs(bMs - target)
  })[0]
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
