import { calculateNFLNHLEdges, calculateNHLEdges, NHL_MODEL_VERSION } from '../../lib/edge-nfl-nhl.js'
import { NFL_SELECTION_MODEL_VERSION } from '../../lib/nfl-selection-model.js'

const evenOdds = [
  { market: 'h2h', priceHome: -110, priceAway: -110, book: 'Test' },
  { market: 'totals', priceHome: -110, priceAway: -110, total: 6.5, book: 'Test' },
]

describe('NHL heuristic is isolated from the NFL rewrite', () => {
  test('missing NHL team data still uses the legacy HFA-only ~4.0pp home edge', () => {
    const result = calculateNHLEdges({
      sport: 'nhl',
      home: { abbr: 'BOS' },
      away: { abbr: 'NYR' },
    }, evenOdds)

    const expectedHome = 1 / (1 + Math.exp(-8 * 0.02))
    expect(result.modelRun).toBe(NHL_MODEL_VERSION)
    expect(result.edgeMlHome).toBeCloseTo(expectedHome - 0.5, 5)
    expect(result.edgeMlAway).toBeCloseTo(0.5 - expectedHome, 5)
    expect(Math.abs(result.edgeMlHome)).toBeGreaterThanOrEqual(0.02)
  })

  test('1-0 home vs 0-1 away still reaches the legacy 10% NHL edge cap', () => {
    const result = calculateNHLEdges({
      sport: 'nhl',
      home: { abbr: 'BOS', homeRecord: '1-0' },
      away: { abbr: 'NYR', awayRecord: '0-1' },
    }, evenOdds)

    expect(result.edgeMlHome).toBeCloseTo(0.10, 8)
    expect(result.edgeMlAway).toBeCloseTo(-0.10, 8)
  })

  test('shared entry point keeps NHL on the heuristic and NFL on the new model', () => {
    const nhl = calculateNFLNHLEdges({
      sport: 'nhl',
      home: { abbr: 'BOS' },
      away: { abbr: 'NYR' },
    }, evenOdds)
    const nfl = calculateNFLNHLEdges({
      sport: 'nfl',
      home: { abbr: 'KC' },
      away: { abbr: 'DEN' },
    }, evenOdds)

    expect(nhl.modelRun).toBe(NHL_MODEL_VERSION)
    expect(nhl.edgeMlHome).not.toBeNull()
    expect(nfl.modelRun).toBe(NFL_SELECTION_MODEL_VERSION)
    expect(nfl.edgeMlHome).toBeNull()
  })

  test('NHL totals still use the fixed points-to-edge coefficient', () => {
    const result = calculateNHLEdges({
      sport: 'nhl',
      home: {
        abbr: 'BOS',
        last10Record: '8-4',
        avgPointsLast10: 2.5,
        avgPointsAllowedLast10: 3.0,
      },
      away: {
        abbr: 'NYR',
        last10Record: '7-5',
        avgPointsLast10: 2.5,
        avgPointsAllowedLast10: 3.0,
      },
    }, evenOdds)

    // homeExpected=(2.5+3.0)/2=2.75, awayExpected=2.75, +0.2 HFA = 5.7
    // vs market 6.5 → diff -0.8 → 0.8 * 0.03 = 0.024 under edge
    expect(result.edgeTotalU).toBeCloseTo(0.024, 5)
    expect(result.edgeTotalO).toBeCloseTo(-0.024, 5)
  })
})
