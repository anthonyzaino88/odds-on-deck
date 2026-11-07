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

  test('keeps the latest lock quote and every capture inside the 35-to-1 minute window', () => {
    const rows = [
      row({ id: 'early', quotedAt: at(-3 * 60 * 60 * 1000), ts: at(-3 * 60 * 60 * 1000) }),
      row({ id: 'lock', quotedAt: at(-70 * 60 * 1000), ts: at(-70 * 60 * 1000) }),
      row({ id: 'mid', quotedAt: at(-50 * 60 * 1000), ts: at(-50 * 60 * 1000) }),
      row({ id: 'close-a', quotedAt: at(-20 * 60 * 1000), ts: at(-20 * 60 * 1000) }),
      row({ id: 'close-b', quotedAt: at(-5 * 60 * 1000), ts: at(-5 * 60 * 1000) }),
      row({ id: 'too-late', quotedAt: at(-30 * 1000), ts: at(-30 * 1000) }),
    ]
    const kept = selectRetainedOddsRows(rows, games).map((item) => item.id).sort()
    expect(kept).toEqual(['close-a', 'close-b', 'lock'])
  })

  test('lock choice is per book and market, and a tie keeps the smaller id', () => {
    const same = at(-80 * 60 * 1000)
    const rows = [
      row({ id: 'b', book: 'FanDuel', market: 'h2h', quotedAt: same, ts: same }),
      row({ id: 'a', book: 'FanDuel', market: 'h2h', quotedAt: same, ts: same }),
      row({ id: 'total', book: 'FanDuel', market: 'totals', quotedAt: at(-90 * 60 * 1000), ts: at(-90 * 60 * 1000) }),
      row({ id: 'other-book', book: 'DraftKings', market: 'h2h', quotedAt: at(-2 * 60 * 60 * 1000), ts: at(-2 * 60 * 60 * 1000) }),
    ]
    const kept = selectRetainedOddsRows(rows, games).map((item) => item.id).sort()
    expect(kept).toEqual(['a', 'other-book', 'total'])
  })

  test('a missing quotedAt uses capture time for retention and stays null on the archive row', () => {
    const kept = selectRetainedOddsRows([
      row({ id: 'cap', quotedAt: null, ts: at(-2 * 60 * 60 * 1000) }),
    ], games)
    expect(kept.map((item) => item.id)).toEqual(['cap'])
    expect(toClosingOddsArchiveRow(kept[0], 'nfl')).toMatchObject({
      game_id: 'g1',
      sport: 'nfl',
      snapshot_at: at(-2 * 60 * 60 * 1000),
      quoted_at: null,
    })
  })

  test('an unparseable start keeps the rows instead of deleting them', () => {
    const kept = selectRetainedOddsRows([
      row({ id: 'x', ts: at(-10 * 60 * 1000), quotedAt: at(-10 * 60 * 1000) }),
    ], [{ id: 'g1', date: 'not-a-start' }])
    expect(kept.map((item) => item.id)).toEqual(['x'])
  })
})

describe('insertClosingOddsArchive', () => {
  test('retries without quoted_at when the column is missing', async () => {
    const bodies = []
    const supabase = {
      from(table) {
        expect(table).toBe('ClosingOdds')
        return {
          insert(body) {
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
      game_id: 'g1',
      quoted_at: '2026-11-08T16:00:00.000Z',
      snapshot_at: '2026-11-08T16:05:00.000Z',
    }])
    expect(result.ok).toBe(true)
    expect(result.wroteQuoteTime).toBe(false)
    expect(bodies[1][0].quoted_at).toBeUndefined()
    expect(bodies[1][0].snapshot_at).toBe('2026-11-08T16:05:00.000Z')
  })
})

describe('cleanup script', () => {
  const source = readFileSync(resolve('scripts/cleanup-old-games.js'), 'utf8')

  test('archives retained odds before delete and skips the batch when that copy fails', () => {
    expect(source).toMatch(/selectRetainedOddsRows/)
    expect(source).toMatch(/insertClosingOddsArchive/)
    expect(source).toMatch(/gameIdsReadyToDelete/)
    expect(source).toMatch(/Leaving this batch in place/)
    expect(source).not.toMatch(/keep latest by ts/)
  })
})
