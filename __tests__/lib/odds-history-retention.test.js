import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  insertClosingOddsArchive,
  ODDS_CLOSE_MIN_LEAD_MS,
  ODDS_CLOSE_WINDOW_MS,
  ODDS_LOCK_LEAD_MS,
  selectRetainedOddsRows,
  toClosingOddsArchiveRow,
} from '../../lib/odds-history-retention.js'
import { CLOSE_CAPTURE_MIN_LEAD_MINUTES, CLOSE_CAPTURE_WINDOW_MINUTES } from '../../lib/closing-line.js'
import {
  bookmakerQuoteTimeIso,
  isMissingQuotedAtColumnError,
  quoteExceedsCapture,
  quoteTimeIso,
} from '../../lib/odds-quote-time.js'
import { oddsInsertPayload } from '../../lib/live-odds-landing.js'

const START = '2026-11-08T18:00:00.000Z'
const startMs = Date.parse(START)

function at(offsetMs) {
  return new Date(startMs + offsetMs).toISOString()
}

function row(partial) {
  return {
    id: partial.id,
    gameId: 'g1',
    book: 'FanDuel',
    market: 'h2h',
    priceHome: -110,
    priceAway: -110,
    total: null,
    spread: null,
    ts: partial.ts,
    quotedAt: partial.quotedAt ?? null,
    ...partial,
  }
}

describe('quote time', () => {
  test('reads market last_update, then the bookmaker clock, and does not invent one', () => {
    expect(bookmakerQuoteTimeIso(
      { last_update: '2026-11-08T10:00:00.000Z' },
      { last_update: '2026-11-08T12:00:00.000Z' },
    )).toBe('2026-11-08T12:00:00.000Z')
    expect(bookmakerQuoteTimeIso(
      { lastUpdate: '2026-11-08T09:00:00.000Z' },
      {},
    )).toBe('2026-11-08T09:00:00.000Z')
    expect(bookmakerQuoteTimeIso({}, {})).toBeNull()
    expect(quoteTimeIso('not-a-time')).toBeNull()
    expect(bookmakerQuoteTimeIso(
      { last_update: '2026-11-08T09:30:00.000Z' },
      { last_update: 'not-a-time' },
    )).toBe('2026-11-08T09:30:00.000Z')
    expect(quoteExceedsCapture('2026-11-08T12:05:00.000Z', '2026-11-08T12:00:00.000Z')).toBe(true)
    expect(quoteExceedsCapture('2026-11-08T12:00:00.000Z', '2026-11-08T12:00:00.000Z')).toBe(false)
    expect(quoteExceedsCapture('not-a-time', '2026-11-08T12:00:00.000Z')).toBe(false)
  })

  test('odds insert stores quotedAt only when the column is included', () => {
    const base = {
      id: 'o1',
      gameId: 'g1',
      book: 'DraftKings',
      market: 'totals',
      priceAway: -108,
      priceHome: -112,
      spread: null,
      total: 47.5,
      ts: '2026-11-08T12:00:00.000Z',
      quoteTime: '2026-11-08T11:55:00.000Z',
    }
    expect(oddsInsertPayload(base).quotedAt).toBeUndefined()
    expect(oddsInsertPayload({ ...base, includeQuotedAt: true }).quotedAt).toBe('2026-11-08T11:55:00.000Z')
    expect(oddsInsertPayload({ ...base, includeQuotedAt: true, quoteTime: null }).quotedAt).toBeNull()
  })

  test('missing quotedAt / quoted_at is a column error, a duplicate key is not', () => {
    expect(isMissingQuotedAtColumnError({
      code: 'PGRST204',
      message: "Could not find the 'quotedAt' column of 'Odds' in the schema cache",
    })).toBe(true)
    expect(isMissingQuotedAtColumnError({
      code: '42703',
      message: 'column "quoted_at" of relation "ClosingOdds" does not exist',
    })).toBe(true)
    expect(isMissingQuotedAtColumnError({
      code: 'PGRST204',
      message: "Could not find the 'commence_time' column of 'Odds' in the schema cache",
    })).toBe(false)
    expect(isMissingQuotedAtColumnError({ code: '23505', message: 'duplicate key' })).toBe(false)
  })
})

describe('selectRetainedOddsRows', () => {
  const games = [{ id: 'g1', date: START, sport: 'nfl' }]

  test('window constants match close capture', () => {
    expect(ODDS_LOCK_LEAD_MS).toBe(60 * 60 * 1000)
    expect(ODDS_CLOSE_WINDOW_MS).toBe(CLOSE_CAPTURE_WINDOW_MINUTES * 60 * 1000)
    expect(ODDS_CLOSE_MIN_LEAD_MS).toBe(CLOSE_CAPTURE_MIN_LEAD_MINUTES * 60 * 1000)
  })

  test('keeps the latest lock capture and every capture inside the 35-to-1 minute window', () => {
    const rows = [
      row({ id: 'early', quotedAt: at(-3 * 60 * 60 * 1000), ts: at(-3 * 60 * 60 * 1000) }),
      row({ id: 'lock', quotedAt: at(-70 * 60 * 1000), ts: at(-70 * 60 * 1000) }),
      row({ id: 'mid', quotedAt: at(-50 * 60 * 1000), ts: at(-50 * 60 * 1000) }),
      row({ id: 'close-a', quotedAt: at(-20 * 60 * 1000), ts: at(-20 * 60 * 1000) }),
      row({ id: 'close-b', quotedAt: at(-5 * 60 * 1000), ts: at(-5 * 60 * 1000) }),
      row({ id: 'too-late', quotedAt: at(-30 * 1000), ts: at(-30 * 1000) }),
    ]
    const kept = selectRetainedOddsRows(rows, games).rows.map((item) => item.id).sort()
    expect(kept).toEqual(['close-a', 'close-b', 'lock'])
  })

  test('a later quote on an older capture does not beat a later capture', () => {
    const plan = selectRetainedOddsRows([
      row({ id: 'old', quotedAt: at(-2 * 60 * 60 * 1000), ts: at(-2 * 60 * 60 * 1000) }),
      row({ id: 'lock', quotedAt: at(-100 * 60 * 1000), ts: at(-70 * 60 * 1000) }),
    ], games)
    expect(plan.rows.map((item) => item.id)).toEqual(['lock'])
    expect(plan.blockedGameIds).toEqual([])
  })

  test('a quote after capture is flagged and cannot win the lock', () => {
    const plan = selectRetainedOddsRows([
      row({ id: 'stale', quotedAt: at(-30 * 60 * 1000), ts: at(-4 * 60 * 60 * 1000) }),
      row({ id: 'lock', quotedAt: at(-90 * 60 * 1000), ts: at(-70 * 60 * 1000) }),
    ], games)
    expect(plan.rows.map((item) => item.id)).toEqual(['lock'])
    expect(plan.rejected).toEqual([{ id: 'stale', gameId: 'g1', reason: 'quote_after_capture' }])
  })

  test('a quote older than 6 hours before capture is not the lock', () => {
    const six = 6 * 60 * 60 * 1000
    const plan = selectRetainedOddsRows([
      row({ id: 'aged', quotedAt: at(-80 * 60 * 1000 - six - 1), ts: at(-80 * 60 * 1000) }),
      row({ id: 'fresh', quotedAt: at(-70 * 60 * 1000 - six), ts: at(-70 * 60 * 1000) }),
    ], games)
    expect(plan.rows.map((item) => item.id)).toEqual(['fresh'])
  })

  test('lock is the latest capture per book and market, and the same capture keeps every row', () => {
    const same = at(-80 * 60 * 1000)
    const rows = [
      row({ id: 'b', book: 'FanDuel', market: 'h2h', quotedAt: same, ts: same }),
      row({ id: 'a', book: 'FanDuel', market: 'h2h', quotedAt: same, ts: same }),
      row({ id: 'total', book: 'FanDuel', market: 'totals', total: 47.5, quotedAt: at(-90 * 60 * 1000), ts: at(-90 * 60 * 1000) }),
      row({ id: 'other-book', book: 'DraftKings', market: 'h2h', quotedAt: at(-2 * 60 * 60 * 1000), ts: at(-2 * 60 * 60 * 1000) }),
    ]
    const kept = selectRetainedOddsRows(rows, games).rows.map((item) => item.id).sort()
    expect(kept).toEqual(['a', 'b', 'other-book', 'total'])
  })

  test('drops a one-sided price and a totals row that has no line', () => {
    const plan = selectRetainedOddsRows([
      row({ id: 'one', priceAway: null, quotedAt: at(-70 * 60 * 1000), ts: at(-70 * 60 * 1000) }),
      row({ id: 'no-line', market: 'totals', total: null, quotedAt: at(-70 * 60 * 1000), ts: at(-70 * 60 * 1000) }),
      row({ id: 'line', market: 'totals', total: 6.5, quotedAt: at(-80 * 60 * 1000), ts: at(-80 * 60 * 1000) }),
    ], games)
    expect(plan.rows.map((item) => item.id)).toEqual(['line'])
  })

  test('a missing quotedAt stays on capture time only when the book has no usable quote', () => {
    const onlyCapture = selectRetainedOddsRows([
      row({ id: 'cap', quotedAt: null, ts: at(-2 * 60 * 60 * 1000) }),
    ], games)
    expect(onlyCapture.rows.map((item) => item.id)).toEqual(['cap'])
    expect(toClosingOddsArchiveRow(onlyCapture.rows[0], 'nfl')).toMatchObject({
      id: 'oddsret:cap',
      game_id: 'g1',
      sport: 'nfl',
      snapshot_at: at(-2 * 60 * 60 * 1000),
      quoted_at: null,
    })

    const mixed = selectRetainedOddsRows([
      row({ id: 'old', quotedAt: null, ts: at(-3 * 60 * 60 * 1000) }),
      row({ id: 'lock', quotedAt: at(-80 * 60 * 1000), ts: at(-70 * 60 * 1000) }),
      row({ id: 'close', quotedAt: null, ts: at(-10 * 60 * 1000) }),
    ], games)
    expect(mixed.rows.map((item) => item.id).sort()).toEqual(['close', 'lock'])

    const quoteOnlyInWindow = selectRetainedOddsRows([
      row({ id: 'lock', quotedAt: null, ts: at(-2 * 60 * 60 * 1000) }),
      row({ id: 'close', quotedAt: at(-10 * 60 * 1000), ts: at(-10 * 60 * 1000) }),
    ], games)
    expect(quoteOnlyInWindow.rows.map((item) => item.id).sort()).toEqual(['close', 'lock'])
  })

  test('an unparseable start blocks the game instead of choosing rows', () => {
    const plan = selectRetainedOddsRows([
      row({ id: 'x', ts: at(-10 * 60 * 1000), quotedAt: at(-10 * 60 * 1000) }),
    ], [{ id: 'g1', date: 'not-a-start' }])
    expect(plan.rows).toEqual([])
    expect(plan.blockedGameIds).toEqual(['g1'])
  })
})

describe('insertClosingOddsArchive', () => {
  test('upserts a deterministic id and ignores a conflict', async () => {
    const writes = []
    const supabase = {
      from() {
        return {
          upsert(body, options) {
            writes.push({ body, options })
            return Promise.resolve({ error: null })
          },
          insert() {
            throw new Error('identified rows must upsert')
          },
        }
      },
    }
    const archived = toClosingOddsArchiveRow(row({
      id: 'cap',
      ts: at(-2 * 60 * 60 * 1000),
      quotedAt: at(-2 * 60 * 60 * 1000),
    }), 'nfl')
    const again = toClosingOddsArchiveRow(row({
      id: 'cap',
      ts: at(-2 * 60 * 60 * 1000),
      quotedAt: at(-2 * 60 * 60 * 1000),
    }), 'nfl')
    expect(archived.id).toBe('oddsret:cap')
    expect(again.id).toBe(archived.id)
    const result = await insertClosingOddsArchive(supabase, [archived])
    expect(result.ok).toBe(true)
    expect(result.ids).toEqual(['oddsret:cap'])
    expect(writes[0].options).toEqual({ onConflict: 'id', ignoreDuplicates: true })
  })

  test('retries the upsert without quoted_at when the column is missing', async () => {
    const bodies = []
    const supabase = {
      from(table) {
        expect(table).toBe('ClosingOdds')
        return {
          upsert(body) {
            bodies.push(body)
            if (bodies.length === 1) {
              return Promise.resolve({
                error: {
                  code: 'PGRST204',
                  message: "Could not find the 'quoted_at' column of 'ClosingOdds' in the schema cache",
                },
              })
            }
            return Promise.resolve({ error: null })
          },
        }
      },
    }
    const result = await insertClosingOddsArchive(supabase, [{
      id: 'oddsret:cap',
      game_id: 'g1',
      quoted_at: '2026-11-08T16:00:00.000Z',
      snapshot_at: '2026-11-08T16:05:00.000Z',
    }])
    expect(result.ok).toBe(true)
    expect(result.wroteQuoteTime).toBe(false)
    expect(result.ids).toEqual(['oddsret:cap'])
    expect(bodies[1][0].quoted_at).toBeUndefined()
    expect(bodies[1][0].snapshot_at).toBe('2026-11-08T16:05:00.000Z')
  })

  test('rows without an id still insert for the closing snapshot job', async () => {
    const bodies = []
    const supabase = {
      from() {
        return {
          insert(body) {
            bodies.push(body)
            return Promise.resolve({ error: null })
          },
        }
      },
    }
    const result = await insertClosingOddsArchive(supabase, [{
      game_id: 'g1',
      quoted_at: null,
      snapshot_at: '2026-11-08T16:05:00.000Z',
    }])
    expect(result.ok).toBe(true)
    expect(result.ids).toEqual([])
    expect(bodies).toHaveLength(1)
  })
})

describe('cleanup script', () => {
  const source = readFileSync(resolve('scripts/cleanup-old-games.js'), 'utf8')
  const runner = readFileSync(resolve('lib/cleanup-old-games.js'), 'utf8')

  test('delegates to the guarded runner', () => {
    expect(source).toMatch(/runCleanupOldGames/)
    expect(source).not.toMatch(/keep latest by ts/)
    expect(runner).toMatch(/selectRetainedOddsRows/)
    expect(runner).toMatch(/insertClosingOddsArchive/)
    expect(runner).toMatch(/isOpsWriteQuietPeriod/)
    expect(runner).toMatch(/acquireCleanupRunLock/)
    expect(runner).toMatch(/Not deleting/)
  })
})
