/**
 * Which Odds rows survive cleanup so a later walk-forward can still see
 * a lock quote and a close. Odds itself is deleted with Game (FK). The
 * kept rows are copied onto ClosingOdds first.
 *
 * Lock: every eligible capture at least 60 minutes before start. Eligible
 * means both prices are present, a totals row has one numeric line, the
 * quote is present and at or before the capture, the quote is before
 * start, and the quote is at most LINE_SHOP_STALE_AFTER_MS (6 hours)
 * older than the capture. Nothing is collapsed to the latest capture per
 * book or market, so earlier totals lines stay. A quote after the capture
 * is rejected. A missing quote is not eligible.
 *
 * Close: every eligible capture whose ts sits after start − 35 minutes
 * and at or before start − 1 minute.
 *
 * Archive ids are oddsret:<source Odds id>. The write is ON CONFLICT DO
 * NOTHING so a rerun does not mint a second row.
 */

import { CLOSE_CAPTURE_MIN_LEAD_MINUTES, CLOSE_CAPTURE_WINDOW_MINUTES } from './closing-line.js'
import { LINE_SHOP_STALE_AFTER_MS } from './line-shopping.js'
import { isMissingQuotedAtColumnError, omitQuotedAtFields, quoteExceedsCapture, quoteTimeIso } from './odds-quote-time.js'

export const ODDS_LOCK_LEAD_MS = 60 * 60 * 1000
export const ODDS_CLOSE_WINDOW_MS = CLOSE_CAPTURE_WINDOW_MINUTES * 60 * 1000
export const ODDS_CLOSE_MIN_LEAD_MS = CLOSE_CAPTURE_MIN_LEAD_MINUTES * 60 * 1000
export const ODDS_ARCHIVE_ID_PREFIX = 'oddsret:'
export const CLOSING_ARCHIVE_CHUNK = 200

function instantMs(value) {
  if (value == null || value === '') return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function finiteNumber(value) {
  if (value == null || value === '') return false
  return Number.isFinite(Number(value))
}

function hasPairedPrices(row) {
  if (!finiteNumber(row?.priceHome) || !finiteNumber(row?.priceAway)) return false
  const market = String(row?.market || '').toLowerCase()
  if (market === 'totals' || market === 'total') return finiteNumber(row?.total)
  return true
}

/**
 * quoted: clocks pass. unquoted: no quote time. bad: quote fails a gate.
 * Capture time is not a stand-in for a quote that failed.
 */
function quoteDecision(row, startMs) {
  const capture = instantMs(row?.ts)
  const quote = instantMs(row?.quotedAt)
  if (capture == null || capture >= startMs) return 'bad'
  if (quote == null) return 'unquoted'
  if (quote > capture) return 'bad'
  if (capture - quote > LINE_SHOP_STALE_AFTER_MS) return 'bad'
  if (quote >= startMs) return 'bad'
  return 'quoted'
}

function inCloseWindow(ms, startMs) {
  return ms > startMs - ODDS_CLOSE_WINDOW_MS && ms <= startMs - ODDS_CLOSE_MIN_LEAD_MS
}

/**
 * @param {object[]} oddsRows
 * @param {object[]} games rows with id and date
 * @returns {{ rows: object[], blockedGameIds: string[], rejected: { id: string, gameId: string, reason: string }[] }}
 */
export function selectRetainedOddsRows(oddsRows, games) {
  const startById = new Map()
  for (const game of games || []) {
    if (game?.id) startById.set(game.id, game.date ?? game.gameDate ?? null)
  }

  const blocked = new Set()
  const rejected = []
  const kept = new Map()

  for (const row of oddsRows || []) {
    if (!row) continue
    const gameId = row.gameId
    if (!gameId || !startById.has(gameId) || instantMs(startById.get(gameId)) == null) {
      if (gameId) blocked.add(String(gameId))
      continue
    }
    if (row.id == null || String(row.id).trim() === '') {
      blocked.add(String(gameId))
      continue
    }
    if (quoteExceedsCapture(row.quotedAt, row.ts)) {
      rejected.push({
        id: String(row.id),
        gameId: String(gameId),
        reason: 'quote_after_capture',
      })
    }
    const startMs = instantMs(startById.get(gameId))
    if (!hasPairedPrices(row) || quoteDecision(row, startMs) !== 'quoted') continue
    const capture = instantMs(row.ts)
    const inLock = capture != null && capture <= startMs - ODDS_LOCK_LEAD_MS
    const inClose = capture != null && inCloseWindow(capture, startMs)
    if (inLock || inClose) kept.set(String(row.id), row)
  }

  return {
    rows: [...kept.values()],
    blockedGameIds: [...blocked],
    rejected,
  }
}

export function closingOddsArchiveId(sourceId) {
  const id = String(sourceId || '').trim()
  if (!id) return null
  return `${ODDS_ARCHIVE_ID_PREFIX}${id}`
}

export function toClosingOddsArchiveRow(row, sport) {
  const id = closingOddsArchiveId(row?.id)
  if (!id) return null
  return {
    id,
    game_id: row.gameId,
    sport: sport || 'unknown',
    book: row.book,
    market: row.market,
    price_home: row.priceHome ?? null,
    price_away: row.priceAway ?? null,
    total: row.total ?? null,
    spread: row.spread ?? null,
    snapshot_at: row.ts ?? null,
    quoted_at: quoteTimeIso(row.quotedAt),
  }
}

function sameNumber(stored, source) {
  if (stored == null && source == null) return true
  if (!finiteNumber(stored) || !finiteNumber(source)) return false
  return Number(stored) === Number(source)
}

function sameInstant(stored, source) {
  return instantMs(stored) === instantMs(source)
}

/**
 * Read-back check: price, line, and both clocks must match the source row.
 * quoted_at is compared only when that column was written.
 */
export function closingCopyMatches(source, stored, { quoteWritten = true } = {}) {
  if (!source || !stored) return false
  if (String(stored.id) !== closingOddsArchiveId(source.id)) return false
  if (stored.game_id !== source.gameId) return false
  if (stored.book !== source.book) return false
  if (stored.market !== source.market) return false
  if (!sameNumber(stored.price_home, source.priceHome)) return false
  if (!sameNumber(stored.price_away, source.priceAway)) return false
  if (!sameNumber(stored.total, source.total)) return false
  if (!sameNumber(stored.spread, source.spread)) return false
  if (!sameInstant(stored.snapshot_at, source.ts)) return false
  if (!quoteWritten) return true
  return sameInstant(stored.quoted_at, quoteTimeIso(source.quotedAt))
}

async function writeClosingBatch(supabase, payload, identified) {
  if (identified) {
    return supabase.from('ClosingOdds').upsert(payload, {
      onConflict: 'id',
      ignoreDuplicates: true,
    })
  }
  return supabase.from('ClosingOdds').insert(payload)
}

/**
 * Identified rows (cleanup copies) upsert on id and ignore conflicts.
 * Rows without ids (snapshot-closing-lines) stay inserts so that job can
 * keep a new snapshot. A missing quoted_at column retries without it.
 */
export async function insertClosingOddsArchive(supabase, rows, {
  beforeWrite,
  chunkSize = CLOSING_ARCHIVE_CHUNK,
} = {}) {
  const batch = Array.isArray(rows) ? rows : []
  if (!batch.length) return { ok: true, wroteQuoteTime: false, error: null, ids: [], reason: null }
  const identified = batch.every((row) => row?.id)
  const ids = identified ? batch.map((row) => row.id) : []
  let omitQuote = false
  const size = Math.max(1, Number(chunkSize) || CLOSING_ARCHIVE_CHUNK)
  const gate = async () => {
    if (typeof beforeWrite !== 'function') return null
    const blocked = await beforeWrite()
    if (!blocked) return null
    return {
      ok: false,
      wroteQuoteTime: false,
      error: blocked.error || new Error(blocked.reason || 'write refused'),
      ids: [],
      reason: blocked.reason || 'gated',
    }
  }
  for (let i = 0; i < batch.length; i += size) {
    const refused = await gate()
    if (refused) return refused
    const chunk = batch.slice(i, i + size)
    let result = await writeClosingBatch(supabase, omitQuote ? chunk.map(omitQuotedAtFields) : chunk, identified)
    if (result?.error && !omitQuote && isMissingQuotedAtColumnError(result.error)) {
      omitQuote = true
      const retryRefused = await gate()
      if (retryRefused) return retryRefused
      result = await writeClosingBatch(supabase, chunk.map(omitQuotedAtFields), identified)
    }
    if (result?.error) {
      return { ok: false, wroteQuoteTime: false, error: result.error, ids: [], reason: 'write' }
    }
  }
  return { ok: true, wroteQuoteTime: !omitQuote, error: null, ids, reason: null }
}
