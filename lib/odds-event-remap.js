/**
 * Re-map an already-mapped Odds API event when its Game row's start
 * differs from the event by more than ODDS_EVENT_REMAP_DRIFT_MS.
 * planEventRemap is pure; applyEventRemap does the two Game writes.
 */

import {
  ODDS_EVENT_REMAP_DRIFT_MS,
  eventStartDriftMs,
  pickUnmappedOddsGame,
  shouldRemapEvent,
} from './live-odds-landing.js'
import { parseStoredGameDate } from './score-updater.js'

export function etDateKey(value) {
  const parsed = value instanceof Date ? value : parseStoredGameDate(value)
  if (!parsed || Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(parsed)
}

/** Same-teams rows sharing an ET calendar date with `game` (doubleheader twins). */
export function doubleheaderTwins(game, siblings) {
  const key = etDateKey(game?.date)
  if (!key) return []
  return (siblings || []).filter((g) => g?.id !== game?.id && etDateKey(g?.date) === key)
}

/**
 * @returns {{ action: 'none'|'keep'|'skip_doubleheader'|'remap', target?: object, driftMs: number|null }}
 */
export function planEventRemap({ mapped, siblings = [], eventTime, isReclaimable = null } = {}) {
  const driftMs = eventStartDriftMs(mapped, eventTime)
  if (!shouldRemapEvent(mapped, eventTime)) return { action: 'none', driftMs }
  const others = (siblings || []).filter((g) => g?.id !== mapped?.id)
  // Doubleheaders: ESPN and the Odds API often disagree on game-2 start
  // times by hours; moving events between twins is riskier than keeping.
  if (doubleheaderTwins(mapped, others).length > 0) return { action: 'skip_doubleheader', driftMs }
  const target = pickUnmappedOddsGame(others, eventTime, { windowMs: ODDS_EVENT_REMAP_DRIFT_MS, isReclaimable })
  if (!target) return { action: 'keep', driftMs }
  if (doubleheaderTwins(target, others).length > 0) return { action: 'skip_doubleheader', driftMs }
  return { action: 'remap', target, driftMs }
}

function isUniqueViolation(error) {
  return String(error?.code || '').includes('23505')
}

/**
 * Set the event on the new row FIRST, then clear the old row, so a failure
 * never leaves the event mapped nowhere. If the DB enforces a unique
 * oddsApiEventId (set-first conflicts), fall back to clear-then-set and log
 * any half-done state loudly.
 * @returns {Promise<{ ok: boolean, state: string, error?: any }>}
 */
export async function applyEventRemap(supabase, { fromId, toId, eventId }, logger = console) {
  const tag = `${String(eventId).substring(0, 8)}... ${fromId} -> ${toId}`
  const set = await supabase.from('Game').update({ oddsApiEventId: eventId }).eq('id', toId)
  if (!set.error) {
    const clear = await supabase.from('Game').update({ oddsApiEventId: null }).eq('id', fromId).eq('oddsApiEventId', eventId)
    if (clear.error) {
      logger.error?.(`    🚨 HALF-DONE RE-MAP ${tag}: new row set but old row NOT cleared (${clear.error.message}). Both rows carry the event — clear ${fromId}.oddsApiEventId by hand.`)
      return { ok: false, state: 'both_mapped', error: clear.error }
    }
    return { ok: true, state: 'remapped' }
  }
  if (!isUniqueViolation(set.error)) {
    logger.error?.(`    ❌ Re-map ${tag} failed before any change: ${set.error.message}`)
    return { ok: false, state: 'unchanged', error: set.error }
  }
  const clear = await supabase.from('Game').update({ oddsApiEventId: null }).eq('id', fromId).eq('oddsApiEventId', eventId)
  if (clear.error) {
    logger.error?.(`    ❌ Re-map ${tag} failed before any change: ${clear.error.message}`)
    return { ok: false, state: 'unchanged', error: clear.error }
  }
  const retry = await supabase.from('Game').update({ oddsApiEventId: eventId }).eq('id', toId)
  if (retry.error) {
    logger.error?.(`    🚨 HALF-DONE RE-MAP ${tag}: old row cleared but new row NOT set (${retry.error.message}). Event is mapped nowhere — set ${toId}.oddsApiEventId = ${eventId} by hand.`)
    return { ok: false, state: 'unmapped', error: retry.error }
  }
  return { ok: true, state: 'remapped' }
}

/**
 * Props cache may be consulted only when not forced fresh and the game's
 * event mapping did not change in this run (its cached props would belong
 * to a different event).
 */
export function shouldCheckPropsCache({ ignoreCache = false, ourGameId = null, changedGameIds = null } = {}) {
  if (ignoreCache) return false
  if (!ourGameId) return false
  if (changedGameIds && changedGameIds.has(ourGameId)) return false
  return true
}
