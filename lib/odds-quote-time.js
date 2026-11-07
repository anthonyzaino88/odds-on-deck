/**
 * Bookmaker quote time (Odds API last_update) vs the time we stored the row.
 * Quote time is never filled from capture time. A missing last_update stays null.
 */

export function quoteTimeIso(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? value.toISOString() : null
  }
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** Market last_update, then the bookmaker last_update. One clock for both sides. */
export function bookmakerQuoteTimeIso(bookmaker, market) {
  const marketClock = quoteTimeIso(market?.last_update ?? market?.lastUpdate)
  if (marketClock) return marketClock
  return quoteTimeIso(bookmaker?.last_update ?? bookmaker?.lastUpdate)
}

/**
 * True when both clocks parse and the quote is later than the capture.
 * Retention rejects that row. Capture time is not rewritten into the quote.
 */
export function quoteExceedsCapture(quoteTime, captureTime) {
  const quoteMs = Date.parse(quoteTimeIso(quoteTime) || '')
  const captureMs = Date.parse(quoteTimeIso(captureTime) || '')
  if (!Number.isFinite(quoteMs) || !Number.isFinite(captureMs)) return false
  return quoteMs > captureMs
}

export function isMissingQuotedAtColumnError(error) {
  if (!error) return false
  const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`
  const code = String(error.code || '')
  const missing = /column|does not exist|schema cache|could not find/i.test(message)
    || code === 'PGRST204'
    || code === '42703'
  if (!missing) return false
  return /quoted_at|quotedAt/i.test(message)
}

export function omitQuotedAtFields(row) {
  if (!row || typeof row !== 'object') return row
  const next = { ...row }
  delete next.quotedAt
  delete next.quoted_at
  return next
}

const quotedAtPresence = new WeakMap()

/**
 * True when Odds.quotedAt can be selected. A missing-column error is cached
 * as false. Any other error is not cached, and the caller still tries the write.
 */
export async function oddsTableHasQuotedAt(supabase) {
  if (!supabase) return false
  if (quotedAtPresence.has(supabase)) return quotedAtPresence.get(supabase)
  const { error } = await supabase.from('Odds').select('quotedAt').limit(1)
  if (!error) {
    quotedAtPresence.set(supabase, true)
    return true
  }
  if (isMissingQuotedAtColumnError(error)) {
    quotedAtPresence.set(supabase, false)
    return false
  }
  return true
}
