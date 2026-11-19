/**
 * ESPN injury status tokens. Safe for client bundles — no Node builtins,
 * no Odds API, no fetch.
 */

export const INJURY_SKIP_STATUSES = Object.freeze([
  'out', 'o',
  'ir', 'injured reserve', 'injuredreserve',
  'ltir', 'long term injured reserve',
  'doubtful', 'd',
  'pup', 'nfi', 'suspended',
])

export const INJURY_FLAG_STATUSES = Object.freeze([
  'questionable', 'q',
  'day to day', 'day-to-day', 'dtd', 'daytoday',
])

function compactStatus(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function injurySkipReason(status) {
  const token = compactStatus(status)
  const tight = token.replace(/\s+/g, '')
  if (INJURY_SKIP_STATUSES.includes(token) || INJURY_SKIP_STATUSES.includes(tight)) {
    if (tight === 'ir' || token.includes('injured reserve')) return 'injury:ir'
    if (tight === 'd' || token === 'doubtful') return 'injury:doubtful'
    if (tight === 'ltir' || token.includes('ltir')) return 'injury:ir'
    return 'injury:out'
  }
  return null
}

export function injuryFlagReason(status) {
  const token = compactStatus(status)
  const tight = token.replace(/\s+/g, '')
  if (INJURY_FLAG_STATUSES.includes(token) || INJURY_FLAG_STATUSES.includes(tight)) {
    return 'injury:questionable'
  }
  return null
}
