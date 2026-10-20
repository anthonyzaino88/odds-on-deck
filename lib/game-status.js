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

function espnStatusType(status) {
  if (!status || typeof status !== 'object') return null
  return status.type || status.status?.type || status
}

function espnStatusBlob(status) {
  const type = espnStatusType(status)
  if (!type || typeof type !== 'object') return ''
  return [
    type.name,
    type.description,
    type.detail,
    type.shortDetail,
    type.detailedState,
  ].filter(Boolean).join(' ').toLowerCase()
}

/**
 * Most specific vendor token. Prefer name / detail over ESPN's coarse
 * `state` (`pre` | `in` | `post`). ESPN uses `state=post` for finals,
 * postponed, and cancelled — never treat a bare `post` as finished.
 */
export function vendorStatusToken(status) {
  if (status == null || status === '') return ''
  if (typeof status === 'string' || typeof status === 'number') {
    return String(status).trim()
  }
  const type = espnStatusType(status)
  if (type && typeof type === 'object') {
    const detailed = String(
      type.name
      || type.detailedState
      || type.detail
      || type.description
      || type.shortDetail
      || '',
    ).trim()
    if (detailed) return detailed
  }
  return String(status.status || '').trim()
}

export function normalizeStatusToken(status) {
  return vendorStatusToken(status).toLowerCase()
}

export function statusMatches(set, status) {
  if (status == null || status === '') return false
  const raw = typeof status === 'string' || typeof status === 'number'
    ? String(status).trim()
    : vendorStatusToken(status)
  if (!raw) return false
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
  if (isDeadStatus(status)) return false
  const type = espnStatusType(status)
  if (type && typeof type === 'object') {
    const name = String(type.name || '').toUpperCase()
    if (name === 'STATUS_POSTPONED' || name === 'STATUS_CANCELED' || name === 'STATUS_CANCELLED' || name === 'STATUS_SUSPENDED') {
      return false
    }
    if (type.completed === true || name === 'STATUS_FINAL' || name === 'STATUS_FINAL_OVERTIME') {
      return true
    }
  }
  const token = vendorStatusToken(status)
  if (normalizeStatusToken(token) === 'post') return false
  return statusMatches(FINAL, token)
}

export function isPreStartStatus(status) {
  return statusMatches(PRE_START, status)
}

export function isDeadStatus(status) {
  const blob = espnStatusBlob(status)
  if (blob && (/\bpostponed\b/.test(blob) || /\bcancel/.test(blob) || /\bsuspend/.test(blob) || /\bnot[_ ]needed\b/.test(blob))) {
    return true
  }
  const name = String(espnStatusType(status)?.name || '').toUpperCase()
  if (name === 'STATUS_POSTPONED' || name === 'STATUS_CANCELED' || name === 'STATUS_CANCELLED' || name === 'STATUS_SUSPENDED') {
    return true
  }
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
