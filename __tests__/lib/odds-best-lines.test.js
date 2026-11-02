import { readFileSync } from 'fs'
import { join } from 'path'
import { getBestLines } from '../../lib/vendors/odds.js'

describe('getBestLines totals mapping', () => {
  test('Over is priceAway and Under is priceHome, with each book keeping its total', () => {
    const best = getBestLines([
      {
        market: 'totals',
        book: 'DraftKings',
        priceAway: -108,
        priceHome: -112,
        total: 47.5,
      },
      {
        market: 'totals',
        book: 'FanDuel',
        priceAway: -105,
        priceHome: -115,
        total: 48,
      },
    ])

    expect(best.totals.over).toEqual({ price: -105, book: 'FanDuel', total: 48 })
    expect(best.totals.under).toEqual({ price: -112, book: 'DraftKings', total: 47.5 })
    expect(best.totals.total).toBeNull()
  })

  test('same-book over/under share that book total', () => {
    const best = getBestLines([
      {
        market: 'totals',
        book: 'BetMGM',
        priceAway: -110,
        priceHome: -110,
        total: 6.5,
      },
    ])

    expect(best.totals.over).toEqual({ price: -110, book: 'BetMGM', total: 6.5 })
    expect(best.totals.under).toEqual({ price: -110, book: 'BetMGM', total: 6.5 })
    expect(best.totals.total).toBe(6.5)
  })

  test('does not treat a missing over as a winning price', () => {
    const best = getBestLines([
      { market: 'totals', book: 'A', priceAway: null, priceHome: -105, total: 44 },
      { market: 'totals', book: 'B', priceAway: -110, priceHome: null, total: 44.5 },
    ])
    expect(best.totals.over).toEqual({ price: -110, book: 'B', total: 44.5 })
    expect(best.totals.under).toEqual({ price: -105, book: 'A', total: 44 })
  })

  test('vendor mapOddsData stores Over on priceAway like fetch-live-odds', () => {
    const src = readFileSync(join(process.cwd(), 'lib/vendors/odds.js'), 'utf8')
    expect(src).toMatch(/priceAway:\s*overOutcome/)
    expect(src).toMatch(/priceHome:\s*underOutcome/)
    expect(src).not.toMatch(/priceHome:\s*overOutcome/)
  })
})
