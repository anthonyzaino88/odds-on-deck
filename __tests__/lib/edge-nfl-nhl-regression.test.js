import { calculateNFLNHLEdges, calculateNHLEdges, NHL_MODEL_VERSION } from '../../lib/edge-nfl-nhl.js'
import { NFL_SELECTION_MODEL_VERSION } from '../../lib/nfl-selection-model.js'
import { TEAM_STATS_STALE_AFTER_DAYS } from '../../lib/team-performance-stats.js'

const evenOdds = [
  { market: 'h2h', priceHome: -110, priceAway: -110, book: 'Test' },
  { market: 'totals', priceHome: -110, priceAway: -110, total: 6.5, book: 'Test' },
]

const NOW = new Date('2025-12-15T18:00:00.000Z')

function freshTeam(overrides = {}) {
  return {
    last10Record: '8-4',
    homeRecord: '5-2',
    awayRecord: '3-2',
    avgPointsLast10: 3.2,
    avgPointsAllowedLast10: 2.6,
    statsCapturedAt: '2025-12-14T22:00:00.000Z',
    statsDataThrough: '2025-12-14T00:00:00.000Z',
    ...overrides,
  }
}

describe('NHL heuristic is isolated from the NFL rewrite', () => {
  test('null NHL team stats skip the edge — no 54/46 fallback', () => {
    const result = calculateNHLEdges({
      sport: 'nhl',
      home: { abbr: 'BOS' },
      away: { abbr: 'NYR' },
    }, evenOdds, { now: NOW })

    expect(result.modelRun).toBe(NHL_MODEL_VERSION)
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toMatch(/null_team_stats/)
    expect(result.edgeMlHome).toBeNull()
    expect(result.edgeMlAway).toBeNull()
    expect(result.edgeTotalO).toBeNull()
    expect(result.edgeTotalU).toBeNull()
  })

  test('all-zero NHL team stats skip the edge', () => {
    const zeros = {
      last10Record: '0-0-0',
      homeRecord: '0-0-0',
      awayRecord: '0-0-0',
      avgPointsLast10: 0,
      avgPointsAllowedLast10: 0,
      statsCapturedAt: '2025-12-14T22:00:00.000Z',
    }
    const result = calculateNHLEdges({
      sport: 'nhl',
      home: { abbr: 'BOS', ...zeros },
      away: { abbr: 'NYR', ...zeros },
    }, evenOdds, { now: NOW })

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toMatch(/all_zero_team_stats/)
    expect(result.edgeMlHome).toBeNull()
    expect(result.edgeMlAway).toBeNull()
  })

  test('stale NHL team stats skip the edge', () => {
    const staleAt = '2025-12-01T00:00:00.000Z'
    expect(NOW.getTime() - new Date(staleAt).getTime())
      .toBeGreaterThan(TEAM_STATS_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000)

    const result = calculateNHLEdges({
      sport: 'nhl',
      home: freshTeam({ abbr: 'BOS', statsCapturedAt: staleAt, statsDataThrough: staleAt }),
      away: freshTeam({ abbr: 'NYR', last10Record: '4-8', statsCapturedAt: staleAt, statsDataThrough: staleAt }),
    }, evenOdds, { now: NOW })

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toMatch(/stale_team_stats/)
    expect(result.edgeMlHome).toBeNull()
    expect(result.edgeMlAway).toBeNull()
  })

  test('1-0 home vs 0-1 away still reaches the legacy 10% NHL edge cap', () => {
    const result = calculateNHLEdges({
      sport: 'nhl',
      home: { abbr: 'BOS', homeRecord: '1-0' },
      away: { abbr: 'NYR', awayRecord: '0-1' },
    }, evenOdds, { now: NOW })

    expect(result.skipped).toBeFalsy()
    expect(result.edgeMlHome).toBeCloseTo(0.10, 8)
    expect(result.edgeMlAway).toBeCloseTo(-0.10, 8)
  })

  test('shared entry point keeps NHL on the heuristic and NFL on the new model', () => {
    const nhl = calculateNFLNHLEdges({
      sport: 'nhl',
      home: freshTeam({ abbr: 'BOS' }),
      away: freshTeam({ abbr: 'NYR', last10Record: '4-8', homeRecord: '2-4', awayRecord: '2-4' }),
    }, evenOdds, { now: NOW })
    const nfl = calculateNFLNHLEdges({
      sport: 'nfl',
      home: { abbr: 'KC' },
      away: { abbr: 'DEN' },
    }, evenOdds, { now: NOW })

    expect(nhl.modelRun).toBe(NHL_MODEL_VERSION)
    expect(nhl.skipped).toBeFalsy()
    expect(nhl.edgeMlHome).not.toBeNull()
    expect(nfl.modelRun).toBe(NFL_SELECTION_MODEL_VERSION)
    expect(nfl.edgeMlHome).toBeNull()
  })

  test('fresh NHL stats produce the same totals edges as before', () => {
    const result = calculateNHLEdges({
      sport: 'nhl',
      home: {
        abbr: 'BOS',
        last10Record: '8-4',
        avgPointsLast10: 2.5,
        avgPointsAllowedLast10: 3.0,
        statsCapturedAt: '2025-12-14T22:00:00.000Z',
      },
      away: {
        abbr: 'NYR',
        last10Record: '7-5',
        avgPointsLast10: 2.5,
        avgPointsAllowedLast10: 3.0,
        statsCapturedAt: '2025-12-14T22:00:00.000Z',
      },
    }, evenOdds, { now: NOW })

    // homeExpected=(2.5+3.0)/2=2.75, awayExpected=2.75, +0.2 HFA = 5.7
    // vs market 6.5 → diff -0.8 → 0.8 * 0.03 = 0.024 under edge
    expect(result.skipped).toBeFalsy()
    expect(result.edgeTotalU).toBeCloseTo(0.024, 5)
    expect(result.edgeTotalO).toBeCloseTo(-0.024, 5)
  })
})
