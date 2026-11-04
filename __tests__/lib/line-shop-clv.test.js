import {
  closeCapturePayload,
  clvFromOdds,
  flattenEventOddsQuotes,
  matchClosingQuote,
} from '../../lib/closing-line.js'
import { impliedProbabilityFromOdds } from '../../lib/odds-units.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const quotes = flattenEventOddsQuotes({
  bookmakers: [
    {
      title: 'FanDuel',
      markets: [{
        key: 'batter_hits',
        outcomes: [
          { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -115 },
          { name: 'Under', description: 'Vinnie Pasquantino', point: 0.5, price: -105 },
        ],
      }],
    },
    {
      title: 'DraftKings',
      markets: [{
        key: 'batter_hits',
        outcomes: [
          { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -108 },
        ],
      }],
    },
  ],
})

describe('line shopping must not change CLV math', () => {
  test('close capture stores consensus close, not the best shop price', () => {
    const match = matchClosingQuote({
      playerName: 'Vinnie Pasquantino',
      propType: 'batter_hits',
      prediction: 'over',
      threshold: 0.5,
    }, quotes)
    expect(match).toMatchObject({
      book: 'FanDuel',
      odds: -115,
      bestOdds: -108,
      bestBook: 'DraftKings',
    })
    const payload = closeCapturePayload(match)
    expect(payload.closeOdds).toBe(-115)
    expect(payload.closeBook).toBe('FanDuel')
    expect(payload).not.toHaveProperty('bestOdds')
    expect(payload.closeOdds).not.toBe(match.bestOdds)
  })

  test('clvProb stays implied(close) − implied(recorded entry)', () => {
    const recorded = 150
    const close = -115
    const clv = clvFromOdds(recorded, close)
    expect(clv.clvProb).toBeCloseTo(
      impliedProbabilityFromOdds(close) - impliedProbabilityFromOdds(recorded),
      8,
    )
    expect(clv.clvProb).toBeCloseTo(
      impliedProbabilityFromOdds(-115) - impliedProbabilityFromOdds(150),
      8,
    )
  })

  test('Prisma PropValidation still omits entryBook; SQL 010 adds it', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    const model = schema.slice(schema.indexOf('model PropValidation'), schema.indexOf('model MockPropValidation'))
    expect(model).not.toMatch(/entryBook/)
    const validationSrc = readFileSync(join(process.cwd(), 'lib/validation.js'), 'utf8')
    expect(validationSrc).toMatch(/writeWithOptionalEntryBook/)
    const publishedSrc = readFileSync(join(process.cwd(), 'lib/published-picks.js'), 'utf8')
    expect(publishedSrc).toMatch(/attachEntryBook/)
    expect(publishedSrc).toMatch(/if \(fields\.entryBook\) patch\.entryBook = fields\.entryBook/)
  })
})
