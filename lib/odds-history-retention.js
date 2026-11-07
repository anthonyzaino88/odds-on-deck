/**
 * Which Odds rows survive cleanup so a later walk-forward can still see
 * a lock quote and a close. Odds itself is deleted with Game (FK). The
 * kept rows are copied onto ClosingOdds first.
 *
 * Lock: per game + book + market, the latest quote at least 60 minutes
 * before start. Quote time is quotedAt when it parses, otherwise the
 * capture time ts (pre-013 rows). The copy still stores quoted_at only
 * from quotedAt, never from ts.
 *
 * Close: every capture whose ts, or quotedAt when present, sits after
 * start − 35 minutes and at or before start − 1 minute. Same window as
 * CLOSE_CAPTURE_WINDOW_MINUTES / CLOSE_CAPTURE_MIN_LEAD_MINUTES.
 */

import { CLOSE_CAPTURE_MIN_LEAD_MINUTES, CLOSE_CAPTURE_WINDOW_MINUTES } from './closing-line.js'
import { isMissingQuotedAtColumnError, omitQuotedAtFields, quoteTimeIso } from './odds-quote-time.js'

export const ODDS_LOCK_LEAD_MS = 60 * 60 * 1000
export const ODDS_CLOSE_WINDOW_MS = CLOSE_CAPTURE_WINDOW_MINUTES * 60 * 1000
export const ODDS_CLOSE_MIN_LEAD_MS = CLOSE_CAPTURE_MIN_LEAD_MINUTES * 60 * 1000

function instantMs(value) {
  if (value == null || value === '') return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function retentionKey(row) {
  return `${row?.gameId || ''}|${row?.book || ''}|${row?.market || ''}`
}

function inCloseWindow(ms, startMs) {
  return ms > startMs - ODDS_CLOSE_WINDOW_MS && ms <= startMs - ODDS_CLOSE_MIN_LEAD_MS
}

/**
 * @param {object[]} oddsRows
 * @param {object[]} games rows with id and date
 * @returns {object[]} odds rows to copy before the Odds delete
 */
export function selectRetainedOddsRows(oddsRows, games) {
  const startById = new Map()
  for (const game of games || []) {
    if (game?.id) startById.set(game.id, game.date ?? game.gameDate ?? null)
  }

  const groups = new Map()
  for (const row of oddsRows || []) {
    if (!row) continue
    const key = retentionKey(row)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const kept = new Map()
  const remember = (row) => {
    if (row?.id == null) return
    kept.set(String(row.id), row)
  }

  for (const group of groups.values()) {
    const startMs = instantMs(startById.get(group[0]?.gameId))
    if (startMs == null) {
      for (const row of group) remember(row)
      continue
    }

    let bestLock = null
    let bestLockMs = null
    for (const row of group) {
      const quoteMs = instantMs(row.quotedAt)
      const captureMs = instantMs(row.ts)
      const lockMs = quoteMs ?? captureMs
      if (lockMs != null && lockMs <= startMs - ODDS_LOCK_LEAD_MS) {
        const later = bestLockMs == null || lockMs > bestLockMs
        const tie = bestLockMs != null && lockMs === bestLockMs
          && String(row.id) < String(bestLock?.id)
        if (later || tie) {
          bestLock = row
          bestLockMs = lockMs
        }
      }
      if ((captureMs != null && inCloseWindow(captureMs, startMs))
        || (quoteMs != null && inCloseWindow(quoteMs, startMs))) {
        remember(row)
      }
    }
    if (bestLock) remember(bestLock)
  }

  return [...kept.values()]
}

export function toClosingOddsArchiveRow(row, sport) {
  return {
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

export async function insertClosingOddsArchive(supabase, rows) {
  const batch = Array.isArray(rows) ? rows : []
  if (!batch.length) return { ok: true, wroteQuoteTime: false, error: null }
  const first = await supabase.from('ClosingOdds').insert(batch)
  if (!first?.error) return { ok: true, wroteQuoteTime: true, error: null }
  if (!isMissingQuotedAtColumnError(first.error)) {
    return { ok: false, wroteQuoteTime: false, error: first.error }
  }
  const retry = await supabase.from('ClosingOdds').insert(batch.map(omitQuotedAtFields))
  if (retry?.error) return { ok: false, wroteQuoteTime: false, error: retry.error }
  return { ok: true, wroteQuoteTime: false, error: null }
}
