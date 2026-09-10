import { readFileSync } from 'fs'
import { resolve } from 'path'
import { removeMlVig, removeTotalVig } from '../../lib/implied.js'
import { toDecimalOdds } from '../../lib/odds-units.js'
import {
  CROSS_BOOK_CONSTRAINTS,
  CROSS_BOOK_PUBLIC_ELIGIBLE,
  CROSS_BOOK_USES_ODDS_API,
  CROSS_BOOK_WRITES_PRODUCTION_DB,
  PRICE_GAP_FORMULA,
  evaluateSnapshot,
  flattenSides,
  modelVersusConsensusGap,
  priceGapRelative,
} from '../../lib/research/nfl-cross-book-sides.js'

const FIXTURE_PATH = resolve('scripts/research/fixtures/nfl-cross-book-sides-snapshot.json')
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))

describe('NFL cross-book sides (research only)', () => {
  test('keeps the public board and production paths off', () => {
    expect(CROSS_BOOK_PUBLIC_ELIGIBLE).toBe(false)
    expect(CROSS_BOOK_WRITES_PRODUCTION_DB).toBe(false)
    expect(CROSS_BOOK_USES_ODDS_API).toBe(false)
    expect(CROSS_BOOK_CONSTRAINTS).toEqual({
      eligibleForPublic: false,
      writesProductionDb: false,
      usesOddsApi: false,
      regradesPicks: false,
      merges: false,
    })
    expect(PRICE_GAP_FORMULA).toBe('(consensus_fair - best_implied) / consensus_fair')
  })

  test('price gap matches the prop relative formula', () => {
    expect(priceGapRelative(0.55, 0.48)).toBeCloseTo((0.55 - 0.48) / 0.55, 10)
    expect(priceGapRelative(0, 0.5)).toBeNull()
  })

  test('model gap is separate and does not change the price gap', () => {
    const evaluation = evaluateSnapshot(FIXTURE, { phase: 'early' })
    const home = evaluation.events[0].moneyline.home
    expect(home.kind).toBe('price_gap')
    expect(home.modelGap).toBeNull()
    expect(home.modelP).toBeNull()

    const injected = modelVersusConsensusGap(0.60, home.consensusFair)
    expect(injected).toBeCloseTo(0.60 - home.consensusFair, 10)
    expect(home.priceGap).not.toBe(injected)
  })

  test('fixture moneyline matches de-vig consensus and best raw implied', () => {
    const evaluation = evaluateSnapshot(FIXTURE, { phase: 'early' })
    const kc = evaluation.events[0].moneyline.home
    const bal = evaluation.events[0].moneyline.away

    const books = [
      removeMlVig(-130, 110),
      removeMlVig(-140, 120),
      removeMlVig(105, -125),
    ]
    const consensusHome = books.reduce((sum, row) => sum + row.homeFairProb, 0) / 3
    const consensusAway = books.reduce((sum, row) => sum + row.awayFairProb, 0) / 3
    const bestHomeImplied = 1 / toDecimalOdds(105)
    const bestAwayImplied = 1 / toDecimalOdds(120)

    expect(kc.ok).toBe(true)
    expect(kc.numBooks).toBe(3)
    expect(kc.bestBook).toBe('BetRivers')
    expect(kc.consensusFair).toBeCloseTo(consensusHome, 8)
    expect(kc.bestImplied).toBeCloseTo(bestHomeImplied, 8)
    expect(kc.priceGap).toBeCloseTo((consensusHome - bestHomeImplied) / consensusHome, 8)
    expect(kc.priceGap).toBeGreaterThan(0.05)
    expect(kc.eligibleForPublic).toBeUndefined()

    expect(bal.bestBook).toBe('FanDuel')
    expect(bal.consensusFair).toBeCloseTo(consensusAway, 8)
    expect(bal.bestImplied).toBeCloseTo(bestAwayImplied, 8)
    expect(bal.priceGap).toBeCloseTo((consensusAway - bestAwayImplied) / consensusAway, 8)
  })

  test('fixture totals use the modal line and the same gap formula', () => {
    const evaluation = evaluateSnapshot(FIXTURE)
    const totals = evaluation.events[0].totals
    expect(totals.line).toBe(47.5)
    expect(totals.isModalLine).toBe(true)

    const books = [
      removeTotalVig(-110, -110, 47.5),
      removeTotalVig(-115, -105, 47.5),
      removeTotalVig(-102, -118, 47.5),
    ]
    const consensusOver = books.reduce((sum, row) => sum + row.overFairProb, 0) / 3
    const bestOverImplied = 1 / toDecimalOdds(-102)
    expect(totals.over.bestBook).toBe('BetRivers')
    expect(totals.over.consensusFair).toBeCloseTo(consensusOver, 8)
    expect(totals.over.priceGap).toBeCloseTo((consensusOver - bestOverImplied) / consensusOver, 8)
  })

  test('evaluation payload stays ineligible for the public board', () => {
    const evaluation = evaluateSnapshot(FIXTURE, { phase: 'early' })
    expect(evaluation.eligibleForPublic).toBe(false)
    expect(evaluation.constraints.eligibleForPublic).toBe(false)
    const sides = flattenSides(evaluation)
    expect(sides.every((row) => row.eligibleForPublic === false)).toBe(true)
    expect(sides.filter((row) => row.ok).length).toBe(4)
  })

  test('does not call fetch', () => {
    global.fetch.mockClear()
    evaluateSnapshot(FIXTURE)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
