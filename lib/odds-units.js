/**
 * Honest unit P/L from mixed American / decimal odds.
 * Does not rewrite stored PropValidation.odds ? only interprets at display/aggregate time.
 *
 * Rules:
 * - American if abs(odds) >= 100, or classic +/- American integers (including +110 stored as 110)
 * - Decimal if 1 < odds < 100 (typical 1.44, 1.91, 2.10)
 * - Negative numbers are always American (-150)
 */

export function parseOddsNumber(odds) {
  if (odds == null || odds === '') return null
  if (typeof odds === 'number') {
    return Number.isFinite(odds) && odds !== 0 ? odds : null
  }
  const s = String(odds).trim()
  if (!s) return null
  const n = parseFloat(s.replace(/^\+/, ''))
  return Number.isFinite(n) && n !== 0 ? n : null
}

export function detectOddsFormat(odds) {
  const n = parseOddsNumber(odds)
  if (n == null) return null
  if (n < 0) return 'american'
  if (Math.abs(n) >= 100) return 'american'
  if (n > 1 && n < 100) return 'decimal'
  return null
}

export function toDecimalOdds(odds) {
  const n = parseOddsNumber(odds)
  if (n == null) return null
  const format = detectOddsFormat(n)
  if (format === 'decimal') return n
  if (format === 'american') {
    if (n > 0) return 1 + n / 100
    return 1 + 100 / Math.abs(n)
  }
  return null
}

export function impliedProbabilityFromOdds(odds) {
  const dec = toDecimalOdds(odds)
  if (dec == null || dec <= 1) return null
  return 1 / dec
}

/**
 * Convert mixed American / decimal odds to American.
 * Decimal 2.00 → +100; 1.50 → -200; 3.50 → +250.
 */
export function toAmericanOdds(odds) {
  const n = parseOddsNumber(odds)
  if (n == null) return null
  const format = detectOddsFormat(n)
  if (format === 'american') return n
  if (format === 'decimal') {
    if (n === 2) return 100
    if (n > 2) return (n - 1) * 100
    if (n > 1) return -100 / (n - 1)
  }
  return null
}

export function formatAmericanOdds(odds) {
  const american = toAmericanOdds(odds)
  if (american == null || !Number.isFinite(american)) return null
  const rounded = Math.round(american)
  if (rounded === 0) return null
  return rounded > 0 ? `+${rounded}` : `${rounded}`
}

export const PUBLISHED_AMERICAN_ODDS_MIN = -200
export const PUBLISHED_AMERICAN_ODDS_MAX = 250

/**
 * Published-picks odds band: American −200 to +250 after honest parse.
 */
export function isAmericanOddsInPublishedBand(odds) {
  const american = toAmericanOdds(odds)
  if (american == null || !Number.isFinite(american)) return false
  return american >= PUBLISHED_AMERICAN_ODDS_MIN && american <= PUBLISHED_AMERICAN_ODDS_MAX
}

/**
 * Profit in units for a 1-unit flat bet.
 * Win: decimal - 1  (e.g. +110 ? +1.10, 1.91 ? +0.91, -150 ? +0.667)
 * Loss: -1
 * Push: 0
 * Missing/unparseable odds on a win: assume -110 (+0.91)
 */
export function unitsFromResult(odds, result) {
  const r = String(result || '').toLowerCase()
  if (r === 'push' || r === 'pushed' || r === 'void') return 0
  if (r === 'incorrect' || r === 'loss' || r === 'lost' || r === 'lose') return -1
  if (r !== 'correct' && r !== 'win' && r !== 'won' && r !== 'hit') return 0

  const dec = toDecimalOdds(odds)
  if (dec == null) return 0.91
  return dec - 1
}
