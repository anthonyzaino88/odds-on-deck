/**
 * Map PlayerPropCache (and similar) rows onto Path B prop-line archive records.
 *
 * Timestamps stay distinct:
 *   quote_ts     — bookmaker/source quote time when ingestion already had it
 *   fetched_at   — cache capture time (PlayerPropCache.fetchedAt)
 *   archived_at  — when this archive line was written
 *
 * Archiving a cached price now is not a current or closing quote. If the
 * original quote time was never stored, quote_ts is null and
 * quote_ts_status is "unknown".
 */

import { getBookCount } from './juice-traps.js'

export const PROP_LINE_ARCHIVE_SCHEMA_VERSION = 1
export const DEFAULT_PROP_ODDS_FORMAT = 'american'

function toIsoOrNull(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function firstTimestamp(row, keys) {
  if (!row) return null
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') {
      const iso = toIsoOrNull(row[key])
      if (iso) return iso
    }
  }
  return null
}

/**
 * Source quote time already present on the row. Does not fall back to
 * fetchedAt / archivedAt / now — those are different clocks.
 */
export function sourceQuoteTimestamp(row) {
  return firstTimestamp(row, [
    'quote_ts',
    'quoteTs',
    'quoteTime',
    'quote_time',
    'last_update',
    'lastUpdate',
    'bookmakerLastUpdate',
    'bookmaker_last_update',
  ])
}

export function cacheCaptureTimestamp(row) {
  return firstTimestamp(row, ['fetched_at', 'fetchedAt', 'captured_at', 'capturedAt'])
}

export function explicitOddsFormat(row) {
  const raw = row?.odds_format || row?.oddsFormat
  if (typeof raw === 'string' && raw.trim()) return raw.trim().toLowerCase()
  // Stored odds on PlayerPropCache are American integers (Odds API oddsFormat=american).
  if (row && (row.odds != null || row.price != null)) return DEFAULT_PROP_ODDS_FORMAT
  return DEFAULT_PROP_ODDS_FORMAT
}

/**
 * @param {object} row - PlayerPropCache row or snapshot payload
 * @param {object} [options]
 * @param {Date|string} [options.archivedAt]
 * @returns {object}
 */
export function mapPropCacheToArchiveRow(row, options = {}) {
  const archivedAt = toIsoOrNull(options.archivedAt) || new Date().toISOString()
  const quoteTs = sourceQuoteTimestamp(row)
  const fetchedAt = cacheCaptureTimestamp(row)
  const numBooks = getBookCount(row)

  return {
    schema_version: PROP_LINE_ARCHIVE_SCHEMA_VERSION,
    prop_id: row.propId ?? row.prop_id ?? null,
    cache_id: row.id ?? row.cache_id ?? null,
    game_id: row.gameId ?? row.game_id ?? null,
    sport: row.sport ?? null,
    player_name: row.playerName ?? row.player_name ?? null,
    team: row.team ?? null,
    prop_type: row.type ?? row.prop_type ?? row.propType ?? null,
    pick: row.pick ?? null,
    threshold: row.threshold ?? null,
    odds: row.odds ?? null,
    odds_format: explicitOddsFormat(row),
    probability: row.probability ?? null,
    edge: row.edge ?? null,
    confidence: row.confidence ?? null,
    quality_score: row.qualityScore ?? row.quality_score ?? null,
    bookmaker: row.bookmaker ?? null,
    projection: row.projection ?? null,
    game_time: toIsoOrNull(row.gameTime ?? row.game_time),
    num_books: numBooks,
    quote_ts: quoteTs,
    quote_ts_status: quoteTs ? 'source' : 'unknown',
    fetched_at: fetchedAt,
    archived_at: archivedAt,
    expires_at: toIsoOrNull(row.expiresAt ?? row.expires_at),
    is_stale: row.isStale ?? row.is_stale ?? null,
  }
}

/**
 * Identity of the exact cache version we archived, used to delete only that
 * version if the row is refreshed between capture and delete.
 */
export function propCacheVersionSnapshot(row) {
  return {
    id: row.id,
    prop_id: row.propId ?? row.prop_id ?? null,
    fetched_at: cacheCaptureTimestamp(row),
    odds: row.odds ?? null,
    threshold: row.threshold ?? null,
    pick: row.pick ?? null,
    type: row.type ?? row.prop_type ?? null,
  }
}
