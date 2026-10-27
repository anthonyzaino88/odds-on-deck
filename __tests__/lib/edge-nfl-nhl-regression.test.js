import {
  calculateNFLNHLEdges,
  calculateNHLEdges,
  deriveNhlSeasonRecord,
  NHL_MODEL_VERSION,
  NHL_SKIP_REASONS,
} from '../../lib/edge-nfl-nhl.js'
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

  test('1-0 home vs 0-1 away no longer saturates at the legacy 10% NHL edge cap', () => {
    // Previously pinned the bug: split-only 1-0 vs 0-1 drove strength to the
    // 0.2/0.8 floors, the -8 logistic saturated, and capEdge wrote ±10%.
    // Splits are ignored now; without ESPN GP/GF/GA the model writes no ML edge.
    const result = calculateNHLEdges({
      sport: 'nhl',
      home: { abbr: 'BOS', homeRecord: '1-0' },
      away: { abbr: 'NYR', awayRecord: '0-1' },
    }, evenOdds, { now: NOW })

    expect(result.modelRun).toBe(NHL_MODEL_VERSION)
    expect(result.modelRun).not.toBe('nfl-nhl-v0.1.0')
    // Must not write the legacy ±10% cap; split-only rows skip instead.
    expect(result.edgeMlHome).toBeNull()
    expect(result.edgeMlAway).toBeNull()
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe(NHL_SKIP_REASONS.MISSING_GOAL_DIFF)
  })

  test('shared entry point keeps NHL on the heuristic and NFL on the new model', () => {
    const nhl = calculateNFLNHLEdges({
      sport: 'nhl',
      home: freshTeam({
        abbr: 'BOS',
        gamesPlayed: 12,
        avgPointsLast10: 3.2,
        avgPointsAllowedLast10: 2.7,
      }),
      away: freshTeam({
        abbr: 'NYR',
        last10Record: '4-8',
        homeRecord: '2-4',
        awayRecord: '2-4',
        gamesPlayed: 12,
        avgPointsLast10: 3.0,
        avgPointsAllowedLast10: 2.9,
      }),
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
    expect(result.modelRun).toBe(NHL_MODEL_VERSION)
    expect(result.edgeTotalU).toBeCloseTo(0.024, 5)
    expect(result.edgeTotalO).toBeCloseTo(-0.024, 5)
  })

  test('writes the bumped NHL model version, not the legacy heuristic id', () => {
    expect(NHL_MODEL_VERSION).toBe('nhl-gd-v0.2.0')
    expect(NHL_MODEL_VERSION).not.toBe('nfl-nhl-v0.1.0')

    const result = calculateNHLEdges({
      sport: 'nhl',
      home: freshTeam({ abbr: 'BOS' }),
      away: freshTeam({ abbr: 'NYR', last10Record: '4-8' }),
    }, evenOdds, { now: NOW })

    expect(result.modelRun).toBe(NHL_MODEL_VERSION)
    expect(result.modelRun).not.toBe('nfl-nhl-v0.1.0')
  })

  test('W-L-only 3-7 record with ESPN 13 GP recovers OTL = 3', () => {
    const record = deriveNhlSeasonRecord({
      last10Record: '3-7',
      gamesPlayed: 13,
    })
    expect(record.wins).toBe(3)
    expect(record.losses).toBe(7)
    expect(record.otl).toBe(3)
    expect(record.gamesPlayed).toBe(13)
    expect(record.ptsPct).toBeCloseTo((2 * 3 + 3) / (2 * 13), 8)
  })

  test('BUF@SJ-like stale splits stay within 0.08 of the market or skip', () => {
    // Old model: SJ home split 6-1 vs BUF away 0-6 floored BUF at 0.20,
    // + home bonus → ~80/20 against a ~43.9% SJ market.
    const sjHome = {
      market: 'h2h',
      priceHome: 128,
      priceAway: -128,
      book: 'Test',
    }
    const result = calculateNHLEdges({
      sport: 'nhl',
      home: freshTeam({
        abbr: 'SJ',
        homeRecord: '6-1',
        awayRecord: '0-4',
        last10Record: '4-6-1',
        gamesPlayed: 11,
        avgPointsLast10: 2.7,
        avgPointsAllowedLast10: 3.2,
      }),
      away: freshTeam({
        abbr: 'BUF',
        homeRecord: '5-1',
        awayRecord: '0-6',
        last10Record: '6-4-1',
        gamesPlayed: 11,
        avgPointsLast10: 3.2,
        avgPointsAllowedLast10: 2.8,
      }),
    }, [sjHome, evenOdds[1]], { now: NOW })

    expect(result.modelRun).toBe(NHL_MODEL_VERSION)
    if (result.skipped) {
      expect([NHL_SKIP_REASONS.CLAMP_HIT, NHL_SKIP_REASONS.GAP_GT_0_08]).toContain(result.skipReason)
      expect(result.edgeMlHome).toBeNull()
      expect(result.edgeMlAway).toBeNull()
      return
    }
    for (const edge of [result.edgeMlHome, result.edgeMlAway]) {
      if (edge != null) {
        expect(Math.abs(edge)).toBeLessThanOrEqual(0.08)
        expect(Math.abs(edge)).toBeLessThanOrEqual(0.05)
      }
    }
  })

  test('skips when |model - market| is greater than 0.08', () => {
    const result = calculateNHLEdges({
      sport: 'nhl',
      home: freshTeam({
        abbr: 'BOS',
        gamesPlayed: 12,
        avgPointsLast10: 3.5,
        avgPointsAllowedLast10: 2.7,
      }),
      away: freshTeam({
        abbr: 'NYR',
        last10Record: '4-8',
        gamesPlayed: 12,
        avgPointsLast10: 3.1,
        avgPointsAllowedLast10: 3.0,
      }),
    }, evenOdds, { now: NOW })

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe(NHL_SKIP_REASONS.GAP_GT_0_08)
    expect(result.edgeMlHome).toBeNull()
    expect(result.edgeMlAway).toBeNull()
    expect(result.modelRun).toBe(NHL_MODEL_VERSION)
  })

  test('tripwire skip when raw model p_home is outside 0.25-0.75', () => {
    const result = calculateNHLEdges({
      sport: 'nhl',
      home: freshTeam({
        abbr: 'BOS',
        last10Record: '40-20',
        gamesPlayed: 60,
        avgPointsLast10: 4.5,
        avgPointsAllowedLast10: 2.0,
      }),
      away: freshTeam({
        abbr: 'SJS',
        last10Record: '20-40',
        gamesPlayed: 60,
        avgPointsLast10: 2.0,
        avgPointsAllowedLast10: 4.0,
      }),
    }, evenOdds, { now: NOW })

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe(NHL_SKIP_REASONS.CLAMP_HIT)
    expect(result.edgeMlHome).toBeNull()
    expect(result.edgeMlAway).toBeNull()
    expect(result.edgeTotalO).toBeNull()
    expect(result.edgeTotalU).toBeNull()
    expect(result.modelRun).toBe(NHL_MODEL_VERSION)
  })
})
