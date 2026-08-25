// Counting-stat UNDER 0.5 (and below) is a juice trap:
// books price the favorite at -250 to -900. High hit rate, terrible payout.
// NHL player_power_play_points under 0.5 is the worst; batter_hits under 0.5 etc.

const GAME_MARKETS = new Set(['total', 'totals', 'moneyline', 'h2h', 'spread', 'spreads'])

/**
 * @param {object} prop - PlayerPropCache row, pick, or PropValidation-like object
 * @returns {boolean}
 */
export function isJuiceTrap(prop) {
  if (!prop || typeof prop !== 'object') return false

  const pick = String(prop.pick || prop.prediction || '').toLowerCase().trim()
  if (pick !== 'under') return false

  const threshold = Number(prop.threshold)
  if (!Number.isFinite(threshold) || threshold > 0.5) return false

  const type = String(prop.type || prop.propType || '').toLowerCase().trim()
  if (GAME_MARKETS.has(type)) return false

  // Editor's Picks wrap the market in propType while type === 'player_prop'
  if (type === 'player_prop') {
    const market = String(prop.propType || '').toLowerCase().trim()
    if (GAME_MARKETS.has(market)) return false
  }

  return true
}

/**
 * Book count if the cache row actually stores it. Returns null rather than guessing.
 * @param {object} prop
 * @returns {number|null}
 */
export function getBookCount(prop) {
  if (!prop || typeof prop !== 'object') return null

  const n = prop.numBooks ?? prop.bookCount ?? prop.booksCount ?? prop.nBooks
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n
  if (typeof n === 'string' && n.trim() !== '') {
    const parsed = Number(n)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  if (Array.isArray(prop.books)) return prop.books.length

  return null
}

export function filterJuiceTraps(items) {
  if (!Array.isArray(items)) return []
  return items.filter((item) => !isJuiceTrap(item))
}
