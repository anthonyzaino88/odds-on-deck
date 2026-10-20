/**
 * Canonical Game.status buckets.
 *
 * Vendors write a small set of values (ESPN scoreboard maps, NFL live
 * mapper, MLB linescore resolver). Callers used to keep slightly
 * different ad-hoc lists, so NFL `halftime` never entered the hourly
 * updater query and Featured treated warmup/halftime as still upcoming.
 *
 * LIVE includes halftime and warmup. warmup also sits in PRE_START
 * (stale-row detection and the SGP game list). DEAD includes
 * `not_needed` for if-necessary games that will never be played.
 *
 * Membership helpers accept hyphen / underscore / space / STATUS_
 * aliases so `.has()` checks do not fork per caller. DB `.in('status')`
 * lists stay the stored-value arrays below.
 */

function freezeSet(values) {
  return Object.freeze(new Set(values))
}

export const LIVE = freezeSet([
  'in_progress',
  'in-progress',
  'in progress',
  'inprogress',
  'live',
  'in play',
  'halftime',
  'warmup',
  'delayed',
])

export const FINAL = freezeSet([
  'final',
  'Final',
  'completed',
  'f',
  'closed',
  'post',
  'status_final',
  'STATUS_FINAL',
  'game_over',
  'game over',
])

export const PRE_START = freezeSet([
  'scheduled',
  'pre_game',
  'pre-game',
  'pregame',
  'warmup',
  'delayed_start',
])

export const DEAD = freezeSet([
  'cancelled',
  'canceled',
  'postponed',
  'suspended',
  'not_needed',
])

/**
 * Stored Game.status values the hourly score updater must keep selecting.
 * Includes hyphen/underscore aliases plus delayed (ESPN / normalizeStatus)
 * and unknown (resolver leak). Halftime must be here or NFL rows freeze.
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
  'halftime',
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

/** Stored / ESPN-cased finals used by Team.statsDataThrough lookups. */
export const FINAL_GAME_STATUSES = Object.freeze([
  'final',
  'Final',
  'completed',
  'STATUS_FINAL',
])

export function normalizeStatusToken(status) {
  return String(status || '').trim().toLowerCase()
}

export function statusMatches(set, status) {
  if (status == null || status === '') return false
  const raw = String(status).trim()
  if (set.has(raw)) return true
  const lower = raw.toLowerCase()
  if (set.has(lower)) return true
  const spaced = lower.replace(/_/g, ' ')
  if (set.has(spaced)) return true
  const underscored = lower.replace(/\s+/g, '_')
  if (set.has(underscored)) return true
  if (lower.startsWith('status_')) return statusMatches(set, lower.slice('status_'.length))
  return false
}

export function isLiveStatus(status) {
  return statusMatches(LIVE, status)
}

export function isFinalStatus(status) {
  return statusMatches(FINAL, status)
}

export function isPreStartStatus(status) {
  return statusMatches(PRE_START, status)
}

export function isDeadStatus(status) {
  return statusMatches(DEAD, status)
}

export function isStartedOrEndedStatus(status) {
  return isLiveStatus(status) || isFinalStatus(status)
}

/** Live but not still pre-start (warmup is both). */
export function isInProgressStatus(status) {
  return isLiveStatus(status) && !isPreStartStatus(status)
}

export function classifyVendorStatus(status) {
  if (isDeadStatus(status)) return 'dead'
  if (isFinalStatus(status)) return 'final'
  if (isLiveStatus(status)) return 'live'
  if (isPreStartStatus(status)) return 'pre_start'
  return null
}
