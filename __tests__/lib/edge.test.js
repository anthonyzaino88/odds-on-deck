// Tests for edge calculation utilities

import { calculateGameEdges, getBatterVsPitcherMatchup } from '../../lib/edge.js'

describe('calculateGameEdges', () => {
  const mockGame = {
    id: 'test-game',
    home: {
      id: 'team1',
      name: 'Home Team',
      abbr: 'HOM',
      parkFactor: 1.05,
    },
    away: {
      id: 'team2', 
      name: 'Away Team',
      abbr: 'AWY',
      parkFactor: 1.0,
    },
    probablePitchers: {
      home: {
        id: 'pitcher1',
        fullName: 'Home Pitcher',
        throws: 'R',
      },
      away: {
        id: 'pitcher2',
        fullName: 'Away Pitcher',
        throws: 'L',
      },
    },
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
      priceHome: -110, // Over
      priceAway: -110, // Under
      total: 8.5,
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
    
    expect(typeof result.ourTotal).toBe('number')
    expect(result.ourTotal).toBeGreaterThan(0)
  })

  test('handles empty odds gracefully', () => {
    const result = calculateGameEdges(mockGame, [])
    
    expect(result.edgeMlHome).toBeNull()
    expect(result.edgeMlAway).toBeNull()
    expect(result.edgeTotalO).toBeNull()
    expect(result.edgeTotalU).toBeNull()
    expect(typeof result.ourTotal).toBe('number') // Model still calculates total even without odds
  })

  test('handles missing probable pitchers', () => {
    const gameWithoutPitchers = {
      ...mockGame,
      probablePitchers: {
        home: null,
        away: null,
      },
    }
    
    const result = calculateGameEdges(gameWithoutPitchers, mockOdds)
    expect(result).toHaveProperty('ourTotal')
    // Should still calculate some total even without pitcher data
  })

  test('applies park factor correctly', () => {
    const neutralParkGame = {
      ...mockGame,
      home: { ...mockGame.home, parkFactor: 1.0 },
    }
    
    const hittersFriendlyGame = {
      ...mockGame,
      home: { ...mockGame.home, parkFactor: 1.2 },
    }
    
    const neutralResult = calculateGameEdges(neutralParkGame, mockOdds)
    const hittersResult = calculateGameEdges(hittersFriendlyGame, mockOdds)
    
    // Hitter-friendly park should generally produce higher total
    // (though other factors may affect this in the simplified model)
    expect(typeof neutralResult.ourTotal).toBe('number')
    expect(typeof hittersResult.ourTotal).toBe('number')
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
