/**
 * Which Odds rows survive cleanup so a later walk-forward can still see
 * a lock quote and a close. Odds itself is deleted with Game (FK). The
 * kept rows are copied onto ClosingOdds first.
 *
 * Lock, per game + book + market: the latest capture at least 60 minutes
 * before start. Ranking uses capture time (Odds.ts), never the quote
 * timestamp. A row with a quote time is eligible only when both prices
 * are present, totals share one numeric line, the quote is at or before
 * the capture, the quote is before start, and the quote is at most
 * LINE_SHOP_STALE_AFTER_MS (6 hours) older than the capture. A quote
 * after the capture is rejected. A missing quote does not outrank a
 * usable quote; it is kept by capture time only when that book and
 * market have no usable quote (pre-013 rows).
 *
 * Close: every capture whose ts sits after start − 35 minutes and at or
 * before start − 1 minute, under the same pair and quote gates. A missing
 * quote still keeps that capture. A quote that fails the gates does not.
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
  const groups = new Map()

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
    const key = `${gameId}|${row.book || ''}|${row.market || ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const kept = new Map()
  const remember = (row) => kept.set(String(row.id), row)

  for (const group of groups.values()) {
    const startMs = instantMs(startById.get(group[0].gameId))
    const eligible = group.filter((row) => {
      if (!hasPairedPrices(row)) return false
      return quoteDecision(row, startMs) !== 'bad'
    })
    const lockCandidates = eligible.filter((row) => {
      const capture = instantMs(row.ts)
      return capture != null && capture <= startMs - ODDS_LOCK_LEAD_MS
    })
    const quotedLocks = lockCandidates.filter((row) => quoteDecision(row, startMs) === 'quoted')
    const lockPool = quotedLocks.length > 0
      ? quotedLocks
      : lockCandidates.filter((row) => quoteDecision(row, startMs) === 'unquoted')

    for (const row of eligible) {
      const capture = instantMs(row.ts)
      if (capture != null && inCloseWindow(capture, startMs)) remember(row)
    }

    let bestCapture = null
    for (const row of lockPool) {
      const capture = instantMs(row.ts)
      if (bestCapture == null || capture > bestCapture) bestCapture = capture
    }
    if (bestCapture == null) continue
    for (const row of lockPool) {
      if (instantMs(row.ts) === bestCapture) remember(row)
    }
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
export async function insertClosingOddsArchive(supabase, rows) {
  const batch = Array.isArray(rows) ? rows : []
  if (!batch.length) return { ok: true, wroteQuoteTime: false, error: null, ids: [] }
  const identified = batch.every((row) => row?.id)
  const ids = identified ? batch.map((row) => row.id) : []
  let omitQuote = false
  const chunkSize = 200
  for (let i = 0; i < batch.length; i += chunkSize) {
    const chunk = batch.slice(i, i + chunkSize)
    let result = await writeClosingBatch(supabase, omitQuote ? chunk.map(omitQuotedAtFields) : chunk, identified)
    if (result?.error && !omitQuote && isMissingQuotedAtColumnError(result.error)) {
      omitQuote = true
      result = await writeClosingBatch(supabase, chunk.map(omitQuotedAtFields), identified)
    }
    if (result?.error) {
      return { ok: false, wroteQuoteTime: false, error: result.error, ids: [] }
    }
  }
  return { ok: true, wroteQuoteTime: !omitQuote, error: null, ids }
}
