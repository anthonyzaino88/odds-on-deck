// Tests for edge calculation utilities

import {
  calculateGameEdges,
  calculateTotalProbabilities,
  getBatterVsPitcherMatchup,
  MODEL_VERSION,
} from '../../lib/edge.js'

describe('calculateGameEdges', () => {
  const mockPitchers = {
    probableHomePitcher: {
      id: 'pitcher1',
      fullName: 'Home Pitcher',
      throws: 'R',
    },
    probableAwayPitcher: {
      id: 'pitcher2',
      fullName: 'Away Pitcher',
      throws: 'L',
    },
  }

  const mockGame = {
    id: 'test-game',
    home: {
      id: 'team1',
      name: 'Home Team',
      abbr: 'HOM',
      parkFactor: 1.0,
    },
    away: {
      id: 'team2',
      name: 'Away Team',
      abbr: 'AWY',
      parkFactor: 1.0,
    },
    ...mockPitchers,
  }

  const mockOdds = [
    {
      gameId: 'test-game',
      book: 'Test Book',
      market: 'h2h',
      priceHome: -110,
      priceAway: -110,
    },
    {
      gameId: 'test-game',
      book: 'Test Book',
      market: 'totals',
      priceHome: -110,
      priceAway: -110,
      total: 9,
    },
  ]

  test('calculates edges with valid input', () => {
    const result = calculateGameEdges(mockGame, mockOdds)

    expect(result).toHaveProperty('edgeMlHome')
    expect(result).toHaveProperty('edgeMlAway')
    expect(result).toHaveProperty('edgeTotalO')
    expect(result).toHaveProperty('edgeTotalU')
    expect(result).toHaveProperty('ourTotal')
    expect(result).toHaveProperty('modelRun')
    expect(result.modelRun).toBe(MODEL_VERSION)
    expect(result.skipped).toBe(false)

    expect(typeof result.ourTotal).toBe('number')
    expect(result.ourTotal).toBeGreaterThan(0)
  })

  test('handles empty odds gracefully', () => {
    const result = calculateGameEdges(mockGame, [])

    expect(result.edgeMlHome).toBeNull()
    expect(result.edgeMlAway).toBeNull()
    expect(result.edgeTotalO).toBeNull()
    expect(result.edgeTotalU).toBeNull()
    expect(result.skipped).toBe(false)
    expect(typeof result.ourTotal).toBe('number')
  })

  test('skips when either probable pitcher is missing', () => {
    const gameWithoutPitchers = {
      ...mockGame,
      probableHomePitcher: null,
      probableAwayPitcher: null,
    }

    const result = calculateGameEdges(gameWithoutPitchers, mockOdds)
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('missing_probable_pitcher')
    expect(result.edgeMlHome).toBeNull()
    expect(result.edgeTotalO).toBeNull()
    expect(result.ourTotal).toBeNull()
    expect(result.modelRun).toBe(MODEL_VERSION)
  })

  test('skips when only the away probable pitcher is missing', () => {
    const result = calculateGameEdges({
      ...mockGame,
      probableAwayPitcher: null,
    }, mockOdds)

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('missing_probable_pitcher')
  })

  test('applies park factor correctly', () => {
    // Both clubs play in the home park. The previous model multiplied the
    // away team by 1 + (awayPark - 1) * 0.5, so this test could only
    // type-check totals. Assert the home park moves the total and the
    // away team's own park does not.
    const homeNeutralAwayHitter = calculateGameEdges({
      ...mockGame,
      home: { ...mockGame.home, parkFactor: 1.0 },
      away: { ...mockGame.away, parkFactor: 1.2 },
    }, mockOdds)
    const homeHitterAwayNeutral = calculateGameEdges({
      ...mockGame,
      home: { ...mockGame.home, parkFactor: 1.2 },
      away: { ...mockGame.away, parkFactor: 1.0 },
    }, mockOdds)
    const bothHitter = calculateGameEdges({
      ...mockGame,
      home: { ...mockGame.home, parkFactor: 1.2 },
      away: { ...mockGame.away, parkFactor: 1.2 },
    }, mockOdds)
    const bothNeutral = calculateGameEdges({
      ...mockGame,
      home: { ...mockGame.home, parkFactor: 1.0 },
      away: { ...mockGame.away, parkFactor: 1.0 },
    }, mockOdds)

    expect(homeHitterAwayNeutral.ourTotal).toBeGreaterThan(bothNeutral.ourTotal)
    expect(homeNeutralAwayHitter.ourTotal).toBeCloseTo(bothNeutral.ourTotal, 8)
    expect(homeHitterAwayNeutral.ourTotal).toBeCloseTo(bothHitter.ourTotal, 8)
  })

  test('more runs allowed raises the opponent predicted runs', () => {
    const tightDefense = calculateGameEdges({
      ...mockGame,
      away: { ...mockGame.away, avgPointsAllowedLast10: 3.0 },
    }, mockOdds)
    const leakyDefense = calculateGameEdges({
      ...mockGame,
      away: { ...mockGame.away, avgPointsAllowedLast10: 6.0 },
    }, mockOdds)

    expect(leakyDefense.ourTotal).toBeGreaterThan(tightDefense.ourTotal)
  })

  test('skips when |model total - line| is greater than 1.0 run', () => {
    const farLine = mockOdds.map((o) => (
      o.market === 'totals' ? { ...o, total: 7 } : o
    ))
    const result = calculateGameEdges(mockGame, farLine)

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('model_line_gap')
    expect(result.ourTotal).toBeGreaterThan(0)
    expect(Math.abs(result.ourTotal - 7)).toBeGreaterThan(1.0)
    expect(result.edgeTotalO).toBeNull()
    expect(result.edgeMlHome).toBeNull()
  })

  test('caps total edges at 8%', () => {
    const result = calculateGameEdges(mockGame, mockOdds)
    if (result.edgeTotalO != null) {
      expect(Math.abs(result.edgeTotalO)).toBeLessThanOrEqual(0.08)
    }
    if (result.edgeTotalU != null) {
      expect(Math.abs(result.edgeTotalU)).toBeLessThanOrEqual(0.08)
    }
    if (result.edgeMlHome != null) {
      expect(Math.abs(result.edgeMlHome)).toBeLessThanOrEqual(0.08)
    }
  })
})

describe('calculateTotalProbabilities', () => {
  test('a whole-number line excludes the push mass', () => {
    const whole = calculateTotalProbabilities(4.5, 4.5, 9)
    const half = calculateTotalProbabilities(4.5, 4.5, 9.5)

    expect(whole.push).toBeGreaterThan(0)
    expect(half.push).toBeCloseTo(0, 8)
    expect(whole.over + whole.under).toBeCloseTo(1)
    // Renormalizing after dropping P(X=9) raises over vs the 9.5 line
    // (which already treats 9 as under with no push).
    expect(whole.over).toBeGreaterThan(half.over)
  })

  test('λ > 10 still applies the 0.1/0.9 cap', () => {
    const result = calculateTotalProbabilities(6, 6.5, 5)
    expect(result.over).toBeGreaterThanOrEqual(0.1)
    expect(result.over).toBeLessThanOrEqual(0.9)
    expect(result.clamped).toBe(true)
    expect(result.over).toBe(0.9)
  })
})

describe('getBatterVsPitcherMatchup', () => {
  const mockBatter = {
    id: 'batter1',
    fullName: 'Test Batter',
    bats: 'L',
  }

  const mockPitcher = {
    id: 'pitcher1',
    fullName: 'Test Pitcher',
    throws: 'R',
  }

  test('calculates basic matchup data', () => {
    const result = getBatterVsPitcherMatchup(mockBatter, mockPitcher)

    expect(result).toHaveProperty('platoonAdvantage')
    expect(result).toHaveProperty('pitchMixFit')
    expect(result).toHaveProperty('formFactor')
    expect(result).toHaveProperty('projectedOPS')
    expect(result).toHaveProperty('confidence')

    expect(typeof result.platoonAdvantage).toBe('number')
    expect(typeof result.projectedOPS).toBe('number')
  })

  test('calculates platoon advantage correctly', () => {
    // Left batter vs Right pitcher should have advantage
    const lVsR = getBatterVsPitcherMatchup(
      { ...mockBatter, bats: 'L' },
      { ...mockPitcher, throws: 'R' }
    )
    expect(lVsR.platoonAdvantage).toBeGreaterThan(0)

    // Same-handed should have disadvantage
    const lVsL = getBatterVsPitcherMatchup(
      { ...mockBatter, bats: 'L' },
      { ...mockPitcher, throws: 'L' }
    )
    expect(lVsL.platoonAdvantage).toBeLessThan(0)

    // Switch hitter should have slight advantage
    const sVsR = getBatterVsPitcherMatchup(
      { ...mockBatter, bats: 'S' },
      { ...mockPitcher, throws: 'R' }
    )
    expect(sVsR.platoonAdvantage).toBeGreaterThan(0)
  })

  test('handles missing handedness data', () => {
    const result = getBatterVsPitcherMatchup(
      { ...mockBatter, bats: null },
      { ...mockPitcher, throws: null }
    )

    expect(result.platoonAdvantage).toBe(0)
  })
})
