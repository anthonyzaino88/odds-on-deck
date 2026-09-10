// Tests for implied probability utilities

import {
  americanToImplied,
  impliedToAmerican,
  removeMlVig,
  removeTotalVig,
  calculateEV,
  estimatedEvAtDecimalOdds,
  formatOdds,
  formatProbability,
  formatEdge,
} from '../../lib/implied.js'

describe('americanToImplied', () => {
  test('converts positive American odds correctly', () => {
    expect(americanToImplied(100)).toBeCloseTo(0.5, 3)
    expect(americanToImplied(150)).toBeCloseTo(0.4, 3)
    expect(americanToImplied(200)).toBeCloseTo(0.333, 3)
  })

  test('converts negative American odds correctly', () => {
    expect(americanToImplied(-100)).toBeCloseTo(0.5, 3)
    expect(americanToImplied(-110)).toBeCloseTo(0.524, 3)
    expect(americanToImplied(-200)).toBeCloseTo(0.667, 3)
  })

  test('handles edge cases', () => {
    expect(americanToImplied(0)).toBe(0)
    expect(americanToImplied(null)).toBe(0)
    expect(americanToImplied(undefined)).toBe(0)
  })
})

describe('impliedToAmerican', () => {
  test('converts probabilities to positive odds', () => {
    expect(impliedToAmerican(0.4)).toBe(150)
    expect(impliedToAmerican(0.333)).toBe(200)
  })

  test('converts probabilities to negative odds', () => {
    expect(impliedToAmerican(0.6)).toBe(-150)
    expect(impliedToAmerican(0.667)).toBe(-200)
  })

  test('handles edge cases', () => {
    expect(impliedToAmerican(0)).toBe(0)
    expect(impliedToAmerican(1)).toBe(0)
    expect(impliedToAmerican(0.5)).toBe(-100)
  })
})

describe('removeMlVig', () => {
  test('removes vig from moneyline odds', () => {
    const result = removeMlVig(-110, -110)
    expect(result.homeFairProb).toBeCloseTo(0.5, 3)
    expect(result.awayFairProb).toBeCloseTo(0.5, 3)
    expect(result.vig).toBeGreaterThan(0)
  })

  test('handles no vig situation', () => {
    const result = removeMlVig(100, 100)
    expect(result.vig).toBe(0)
    expect(result.homeFairProb).toBeCloseTo(0.5, 3)
  })
})

describe('calculateEV', () => {
  test('calculates positive expected value', () => {
    const result = calculateEV(0.6, 100, 100) // 60% chance, +100 odds
    expect(result.evPercentage).toBeGreaterThan(0)
    expect(result.edge).toBeGreaterThan(0)
  })

  test('calculates negative expected value', () => {
    const result = calculateEV(0.4, 100, 100) // 40% chance, +100 odds
    expect(result.evPercentage).toBeLessThan(0)
  })
})

describe('estimatedEvAtDecimalOdds', () => {
  test('uses P(win)×(d-1) − P(loss) and ignores a refunded push', () => {
    // +100 decimal 2.00: 0.55 * 1 - 0.45 = 0.10
    expect(estimatedEvAtDecimalOdds(0.55, 0.45, 2)).toBeCloseTo(0.10, 8)
    // -110 decimal ~1.909: smaller EV than even money at the same probabilities
    const evMinus110 = estimatedEvAtDecimalOdds(0.55, 0.45, 1 + 100 / 110)
    expect(evMinus110).toBeLessThan(0.10)
    expect(evMinus110).toBeGreaterThan(0)
    // Push mass is omitted — not treated as a loss
    expect(estimatedEvAtDecimalOdds(0.50, 0.45, 2)).toBeCloseTo(0.05, 8)
  })

  test('handles American-converted decimal and rejects invalid prices', () => {
    expect(estimatedEvAtDecimalOdds(0.40, 0.60, 3)).toBeCloseTo(0.20, 8) // +200
    expect(estimatedEvAtDecimalOdds(0.50, 0.50, 1)).toBeNull()
    expect(estimatedEvAtDecimalOdds(0.50, 0.50, null)).toBeNull()
  })
})

describe('formatOdds', () => {
  test('formats positive odds with plus sign', () => {
    expect(formatOdds(150)).toBe('+150')
    expect(formatOdds(100)).toBe('+100')
  })

  test('formats negative odds without plus sign', () => {
    expect(formatOdds(-110)).toBe('-110')
    expect(formatOdds(-200)).toBe('-200')
  })

  test('handles invalid input', () => {
    expect(formatOdds(0)).toBe('N/A')
    expect(formatOdds(null)).toBe('N/A')
    expect(formatOdds(undefined)).toBe('N/A')
  })
})

describe('formatProbability', () => {
  test('formats probability as percentage', () => {
    expect(formatProbability(0.5)).toBe('50.0%')
    expect(formatProbability(0.333)).toBe('33.3%')
    expect(formatProbability(0.6667, 2)).toBe('66.67%')
  })

  test('handles invalid input', () => {
    expect(formatProbability(-0.1)).toBe('N/A')
    expect(formatProbability(1.1)).toBe('N/A')
    expect(formatProbability(null)).toBe('N/A')
  })
})

describe('formatEdge', () => {
  test('formats positive edge with positive class', () => {
    const result = formatEdge(5.0)
    expect(result.text).toBe('+5.0%')
    expect(result.className).toBe('edge-positive')
  })

  test('formats negative edge with negative class', () => {
    const result = formatEdge(-3.0)
    expect(result.text).toBe('-3.0%')
    expect(result.className).toBe('edge-negative')
  })

  test('formats small edge with neutral class', () => {
    const result = formatEdge(1.0)
    expect(result.text).toBe('+1.0%')
    expect(result.className).toBe('edge-neutral')
  })

  test('handles invalid input', () => {
    const result = formatEdge(null)
    expect(result.text).toBe('N/A')
    expect(result.className).toBe('edge-neutral')
  })
})

