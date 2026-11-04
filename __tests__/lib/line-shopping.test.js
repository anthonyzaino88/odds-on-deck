import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LINE_SHOP_UNPAIRED_VIG,
  attachEntryBook,
  bookQuoteLastUpdate,
  buildLineShoppingEdges,
  consensusOddsFromProbability,
  isMissingEntryBookColumnError,
  isMissingLineShopQuoteColumnError,
  isQuoteStale,
  lineShoppingEdge,
  parseStoredQuotes,
  playerPropCacheQuoteFields,
  publicNumBooks,
  quoteAgeMs,
  resetEntryBookColumnCache,
  resetLineShopQuoteColumnCache,
  toPublicPropShop,
  toPublicPropsApiRow,
  toPublicShopQuotes,
  upsertPlayerPropCacheWithOptionalQuotes,
  usableDecimalPrice,
  vigFreeProbability,
  withLineShopQuoteFields,
  withoutEntryBookFields,
  withoutLineShopQuoteFields,
  writeWithOptionalEntryBook,
} from '../../lib/line-shopping.js'

beforeEach(() => {
  resetLineShopQuoteColumnCache()
  resetEntryBookColumnCache()
})

function twoBookGame(overrides = {}) {
  return [{
    gameId: 'evt-1',
    props: {
      bookmakers: [
        {
          title: 'FanDuel',
          last_update: '2026-11-04T12:00:00.000Z',
          markets: [{
            key: 'batter_hits',
            last_update: '2026-11-04T12:00:00.000Z',
            outcomes: [
              { name: 'Over', description: 'Aaron Judge', point: 1.5, price: 2.00 },
              { name: 'Under', description: 'Aaron Judge', point: 1.5, price: 2.00 },
            ],
          }],
        },
        {
          title: 'DraftKings',
          last_update: '2026-11-04T12:05:00.000Z',
          markets: [{
            key: 'batter_hits',
            last_update: '2026-11-04T12:05:00.000Z',
            outcomes: [
              { name: 'Over', description: 'Aaron Judge', point: 1.5, price: 2.10 },
              { name: 'Under', description: 'Aaron Judge', point: 1.5, price: 1.91 },
            ],
          }],
        },
      ],
    },
    ...overrides,
  }]
}

describe('vig-free line-shop math', () => {
  test('paired Over/Under de-vigs; unpaired uses ×0.955', () => {
    expect(vigFreeProbability(2.00, 2.00)).toBeCloseTo(0.5, 8)
    expect(vigFreeProbability(2.00, null)).toBeCloseTo(0.5 * LINE_SHOP_UNPAIRED_VIG, 8)
    expect(usableDecimalPrice(1)).toBeNull()
    expect(usableDecimalPrice('n/a')).toBeNull()
  })

  test('edge is (consensus − bestImplied) / consensus, floored at 0', () => {
    expect(lineShoppingEdge(0.55, 0.50)).toBeCloseTo((0.55 - 0.50) / 0.55, 8)
    expect(lineShoppingEdge(0.50, 0.55)).toBe(0)
    expect(lineShoppingEdge(0, 0.5)).toBe(0)
  })
})

describe('buildLineShoppingEdges', () => {
  test('best is max decimal, consensus is mean vig-free, quotes keep last_update', () => {
    const map = buildLineShoppingEdges(twoBookGame())
    const over = map.get('evt-1|Aaron Judge|batter_hits|1.5|over')
    expect(over.bestBook).toBe('DraftKings')
    expect(over.bestPrice).toBeCloseTo(2.10, 8)
    expect(over.numBooks).toBe(2)
    expect(over.quotes).toHaveLength(2)
    expect(over.quotes.map((row) => row.book)).toEqual(['FanDuel', 'DraftKings'])
    expect(over.quotes[1].lastUpdate).toBe('2026-11-04T12:05:00.000Z')
    expect(over.quoteUpdatedAt).toBe('2026-11-04T12:05:00.000Z')

    const fd = vigFreeProbability(2.00, 2.00)
    const dk = vigFreeProbability(2.10, 1.91)
    const consensus = (fd + dk) / 2
    expect(over.consensusProb).toBeCloseTo(consensus, 8)
    expect(over.edge).toBeCloseTo(lineShoppingEdge(consensus, 1 / 2.10), 8)
    expect(over.edge).toBeGreaterThan(0)
  })

  test('one-sided markets use ×0.955 and skip empty/unparseable books', () => {
    const map = buildLineShoppingEdges([{
      gameId: 'evt-2',
      props: {
        bookmakers: [
          {
            title: 'BetMGM',
            markets: [{
              key: 'player_points',
              last_update: '2026-11-04T11:00:00.000Z',
              outcomes: [
                { name: 'Over', description: 'Auston Matthews', point: 0.5, price: 1.80 },
              ],
            }],
          },
          {
            title: 'BrokenBook',
            markets: [{
              key: 'player_points',
              outcomes: [
                { name: 'Over', description: 'Auston Matthews', point: 0.5, price: 'n/a' },
              ],
            }],
          },
        ],
      },
    }])
    const over = map.get('evt-2|Auston Matthews|player_points|0.5|over')
    expect(over.numBooks).toBe(1)
    expect(over.bestBook).toBe('BetMGM')
    expect(over.consensusProb).toBeCloseTo((1 / 1.80) * LINE_SHOP_UNPAIRED_VIG, 8)
    expect(over.quotes).toHaveLength(1)
    expect(over.quotes[0].book).toBe('BetMGM')
  })
})

describe('quote staleness', () => {
  const now = Date.parse('2026-11-04T18:00:00.000Z')
  const commence = '2026-11-04T23:00:00.000Z'

  test('ages from last_update and does not treat a missing stamp as fresh', () => {
    expect(quoteAgeMs('2026-11-04T17:00:00.000Z', now)).toBe(60 * 60 * 1000)
    expect(isQuoteStale({ lastUpdate: '2026-11-04T17:00:00.000Z' }, { now, commenceTime: commence })).toBe(false)
    expect(isQuoteStale({ lastUpdate: '2026-11-04T11:00:00.000Z' }, { now, commenceTime: commence })).toBe(true)
    expect(isQuoteStale({ lastUpdate: null }, { now, commenceTime: commence })).toBe(true)
    expect(isQuoteStale({}, { now, commenceTime: commence })).toBe(true)
  })

  test('flags quotes at or after commence_time', () => {
    expect(isQuoteStale(
      { lastUpdate: '2026-11-04T23:00:00.000Z' },
      { now: Date.parse('2026-11-04T23:30:00.000Z'), commenceTime: commence },
    )).toBe(true)
    expect(isQuoteStale(
      { lastUpdate: '2026-11-04T22:59:59.000Z' },
      { now: Date.parse('2026-11-04T23:30:00.000Z'), commenceTime: commence },
    )).toBe(false)
  })
})

describe('PlayerPropCache quote persist', () => {
  test('cache row stays one best; quotes length matches numBooks', () => {
    const lineShop = buildLineShoppingEdges(twoBookGame()).get('evt-1|Aaron Judge|batter_hits|1.5|over')
    const row = withLineShopQuoteFields({
      propId: 'g1-judge-hits-1.5-over',
      odds: lineShop.bestPrice,
      bookmaker: lineShop.bestBook,
      numBooks: lineShop.numBooks,
      probability: lineShop.consensusProb,
      edge: lineShop.edge,
    }, lineShop)
    expect(row.bookmaker).toBe('DraftKings')
    expect(row.odds).toBeCloseTo(2.10, 8)
    expect(row.quotes).toHaveLength(row.numBooks)
    expect(row.quoteUpdatedAt).toBe('2026-11-04T12:05:00.000Z')
    expect(playerPropCacheQuoteFields(lineShop).quotes).toHaveLength(2)
  })

  test('retries without quotes / quoteUpdatedAt on PGRST204', async () => {
    const payloads = []
    const lineShop = buildLineShoppingEdges(twoBookGame()).get('evt-1|Aaron Judge|batter_hits|1.5|over')
    const batch = [withLineShopQuoteFields({ propId: 'p1', odds: 2.1, bookmaker: 'DK' }, lineShop)]

    const result = await upsertPlayerPropCacheWithOptionalQuotes(async (rows) => {
      payloads.push(rows)
      if (rows[0].quotes) {
        return { error: { code: 'PGRST204', message: "Could not find the 'quotes' column of 'PlayerPropCache' in the schema cache" } }
      }
      return { error: null }
    }, batch)

    expect(result.error).toBeNull()
    expect(payloads).toHaveLength(2)
    expect(payloads[0][0].quotes).toHaveLength(2)
    expect(payloads[1][0].quotes).toBeUndefined()
    expect(payloads[1][0].quoteUpdatedAt).toBeUndefined()
    expect(withoutLineShopQuoteFields(payloads[0][0]).quotes).toBeUndefined()
  })

  test('later writes skip quote fields after a missing-column miss', async () => {
    const failThenOk = async (rows) => {
      if (rows[0]?.quotes) {
        return { error: { code: '42703', message: 'column quoteUpdatedAt does not exist' } }
      }
      return { error: null }
    }
    await upsertPlayerPropCacheWithOptionalQuotes(failThenOk, [{ propId: 'a', quotes: [{ book: 'DK' }] }])
    const payloads = []
    await upsertPlayerPropCacheWithOptionalQuotes(async (rows) => {
      payloads.push(rows)
      return { error: null }
    }, [{ propId: 'b', quotes: [{ book: 'FD' }], quoteUpdatedAt: '2026-11-04T12:00:00.000Z' }])
    expect(payloads[0][0].quotes).toBeUndefined()
  })

  test('isMissingLineShopQuoteColumnError is PGRST204 / 42703 for quote columns', () => {
    expect(isMissingLineShopQuoteColumnError({ code: 'PGRST204', message: "Could not find the 'quotes' column" })).toBe(true)
    expect(isMissingLineShopQuoteColumnError({ code: '42703', message: 'column quoteUpdatedAt does not exist' })).toBe(true)
    expect(isMissingLineShopQuoteColumnError({ code: 'PGRST204' })).toBe(true)
    expect(isMissingLineShopQuoteColumnError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingLineShopQuoteColumnError({
      code: '23502',
      message: 'null value in column "quotes" violates not-null constraint',
    })).toBe(false)
    expect(isMissingLineShopQuoteColumnError({
      code: 'PGRST204',
      message: "Could not find the 'commence_time' column of 'Odds' in the schema cache",
    })).toBe(false)
    expect(isMissingEntryBookColumnError({
      code: 'PGRST204',
      message: "Could not find the 'closeOdds' column of 'PropValidation'",
    })).toBe(false)
  })
})

describe('public shop mapping', () => {
  test('hides the ladder when quotes is null and does not invent numBooks', () => {
    expect(parseStoredQuotes(null)).toBeNull()
    expect(toPublicShopQuotes(null)).toBeNull()
    const shop = toPublicPropShop({
      odds: 1.91,
      bookmaker: 'FanDuel',
      probability: 0.55,
      edge: 0.04,
    })
    expect(shop.quotes).toBeNull()
    expect(shop.staleQuotes).toBe(false)
    expect(shop.numBooks).toBeNull()
    expect(shop.bestBook).toBe('FanDuel')
    expect(shop.consensusOdds).toBeCloseTo(consensusOddsFromProbability(0.55), 8)
    expect(toPublicPropsApiRow({
      propId: 'p1',
      odds: 1.91,
      bookmaker: 'FanDuel',
      probability: 0.55,
      edge: 0.04,
      sport: 'mlb',
    }).quotes).toBeNull()
  })

  test('marks stale quotes and uses real quote length for numBooks', () => {
    const now = Date.parse('2026-11-04T18:00:00.000Z')
    const shop = toPublicPropShop({
      odds: 2.10,
      bookmaker: 'DraftKings',
      probability: 0.52,
      edge: 0.03,
      gameTime: '2026-11-04T23:00:00.000Z',
      quotes: [
        { book: 'FanDuel', decimal: 2.00, lastUpdate: '2026-11-04T17:00:00.000Z' },
        { book: 'DraftKings', decimal: 2.10, lastUpdate: '2026-11-04T11:00:00.000Z' },
      ],
    }, { now })
    expect(shop.numBooks).toBe(2)
    expect(publicNumBooks(shop)).toBe(2)
    expect(shop.quotes[0].stale).toBe(false)
    expect(shop.quotes[1].stale).toBe(true)
    expect(shop.staleQuotes).toBe(true)
  })
})

describe('entryBook helpers (column is SQL 010; persist wiring is PR B)', () => {
  test('copies bookmaker / bestBook and retries without entryBook on PGRST204', async () => {
    expect(attachEntryBook({ odds: -110 }, { bookmaker: 'DraftKings' }).entryBook).toBe('DraftKings')
    expect(withoutEntryBookFields({ odds: -110, entryBook: 'DK' })).toEqual({ odds: -110 })
    expect(isMissingEntryBookColumnError({ code: 'PGRST204', message: "Could not find the 'entryBook' column" })).toBe(true)

    const payloads = []
    await writeWithOptionalEntryBook(async (payload) => {
      payloads.push(payload)
      if (payload.entryBook) {
        return { error: { code: 'PGRST204', message: "Could not find the 'entryBook' column of 'PropValidation'" } }
      }
      return { error: null }
    }, { odds: -110, entryBook: 'FanDuel' })
    expect(payloads).toHaveLength(2)
    expect(payloads[1].entryBook).toBeUndefined()
    expect(payloads[1].odds).toBe(-110)
  })
})

describe('010 migration + morning fetch contract', () => {
  test('SQL is additive, manual, and never run from CI', () => {
    const sql = readFileSync(join(process.cwd(), 'scripts/migrations/010_line_shop_quotes.sql'), 'utf8')
    const rollback = readFileSync(join(process.cwd(), 'scripts/migrations/010_line_shop_quotes_rollback.sql'), 'utf8')
    const docs = readFileSync(join(process.cwd(), 'docs/migrations/010_line_shop_quotes.md'), 'utf8')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "quotes" JSONB/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "quoteUpdatedAt"/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "entryBook"/)
    expect(sql).toMatch(/SET lock_timeout/)
    expect(sql).toMatch(/DO NOT run from CI/)
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS "quotes"/)
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS "entryBook"/)
    expect(docs).toMatch(/Do \*\*not\*\* run these from CI/)
  })

  test('morning fetch uses shared lib, keeps regions=us, and writes optional quotes', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/fetch-live-odds.js'), 'utf8')
    expect(src).toMatch(/from ['"]\.\.\/lib\/line-shopping\.js['"]/)
    expect(src).toMatch(/buildLineShoppingEdges/)
    expect(src).toMatch(/withLineShopQuoteFields/)
    expect(src).toMatch(/writePlayerPropCacheRows/)
    expect(src).toMatch(/regions=us/)
    expect(src).not.toMatch(/regions=us2/)
    expect(src).not.toMatch(/regions=us,us2/)
    expect(src).not.toMatch(/function buildLineShoppingEdges/)
  })

  test('flattenEventOddsQuotes shares book last_update helper', () => {
    const src = readFileSync(join(process.cwd(), 'lib/closing-line.js'), 'utf8')
    expect(src).toMatch(/bookQuoteLastUpdate/)
    expect(bookQuoteLastUpdate(
      { last_update: 'book' },
      { last_update: 'market' },
    )).toBe('market')
  })
})
