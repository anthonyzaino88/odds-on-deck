import {
  cacheCaptureTimestamp,
  mapPropCacheToArchiveRow,
  sourceQuoteTimestamp,
} from '../../lib/prop-line-archive.js'

const BASE_ROW = {
  id: 'cache-1',
  propId: 'prop-1',
  gameId: 'KC_at_PHI_2026-09-14',
  sport: 'nfl',
  playerName: 'Saquon Barkley',
  team: 'PHI',
  type: 'player_rushing_yards',
  pick: 'over',
  threshold: 89.5,
  odds: -110,
  probability: 0.52,
  edge: 0.01,
  confidence: 'medium',
  qualityScore: 55,
  bookmaker: 'draftkings',
  projection: 92.1,
  gameTime: '2026-09-14T17:00:00.000Z',
  fetchedAt: '2026-09-14T11:00:00.000Z',
  expiresAt: '2026-09-14T16:00:00.000Z',
  isStale: false,
  numBooks: 4,
}

describe('prop-line archive timestamps', () => {
  test('keeps quote, capture, and archive times distinct', () => {
    const row = {
      ...BASE_ROW,
      lastUpdate: '2026-09-14T10:45:00.000Z',
    }
    const archived = mapPropCacheToArchiveRow(row, { archivedAt: '2026-09-14T20:00:00.000Z' })
    expect(archived.quote_ts).toBe('2026-09-14T10:45:00.000Z')
    expect(archived.quote_ts_status).toBe('source')
    expect(archived.fetched_at).toBe('2026-09-14T11:00:00.000Z')
    expect(archived.archived_at).toBe('2026-09-14T20:00:00.000Z')
    expect(archived.odds_format).toBe('unknown')
    expect(archived.num_books).toBe(4)
    expect(new Set([archived.quote_ts, archived.fetched_at, archived.archived_at]).size).toBe(3)
  })

  test('marks quote time unknown when ingestion never stored it', () => {
    const archived = mapPropCacheToArchiveRow(BASE_ROW, { archivedAt: '2026-09-14T20:00:00.000Z' })
    expect(archived.quote_ts).toBeNull()
    expect(archived.quote_ts_status).toBe('unknown')
    expect(archived.fetched_at).toBe('2026-09-14T11:00:00.000Z')
    expect(sourceQuoteTimestamp(BASE_ROW)).toBeNull()
    expect(cacheCaptureTimestamp(BASE_ROW)).toBe('2026-09-14T11:00:00.000Z')
  })

  test('does not treat archive time as a closing quote', () => {
    const archived = mapPropCacheToArchiveRow(BASE_ROW, { archivedAt: '2026-09-15T08:00:00.000Z' })
    expect(archived.quote_ts).not.toBe(archived.archived_at)
    expect(archived.quote_ts_status).toBe('unknown')
  })
})

describe('prop-line odds format provenance', () => {
  test('current-writer decimal rows keep decimal format and the original price', () => {
    const archived = mapPropCacheToArchiveRow(
      { ...BASE_ROW, odds: 1.88 },
      { archivedAt: '2026-09-14T20:00:00.000Z', writer: 'fetch-live-odds' }
    )
    expect(archived.odds_format).toBe('decimal')
    expect(archived.odds).toBe(1.88)
  })

  test('explicit American format is preserved with the original price', () => {
    const archived = mapPropCacheToArchiveRow(
      { ...BASE_ROW, odds: -110, oddsFormat: 'american' },
      { archivedAt: '2026-09-14T20:00:00.000Z' }
    )
    expect(archived.odds_format).toBe('american')
    expect(archived.odds).toBe(-110)
  })

  test('large decimal is not labeled American from magnitude', () => {
    const archived = mapPropCacheToArchiveRow(
      { ...BASE_ROW, odds: 150, oddsFormat: 'decimal' },
      { archivedAt: '2026-09-14T20:00:00.000Z' }
    )
    expect(archived.odds_format).toBe('decimal')
    expect(archived.odds).toBe(150)

    const unlabeled = mapPropCacheToArchiveRow(
      { ...BASE_ROW, odds: 150 },
      { archivedAt: '2026-09-14T20:00:00.000Z' }
    )
    expect(unlabeled.odds_format).toBe('unknown')
    expect(unlabeled.odds).toBe(150)
  })

  test('unknown legacy rows stay unknown and keep the numeric price', () => {
    const archived = mapPropCacheToArchiveRow(BASE_ROW, { archivedAt: '2026-09-14T20:00:00.000Z' })
    expect(archived.odds_format).toBe('unknown')
    expect(archived.odds).toBe(-110)
  })
})
