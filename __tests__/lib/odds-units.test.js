import {
  detectOddsFormat,
  toDecimalOdds,
  toAmericanOdds,
  formatAmericanOdds,
  isAmericanOddsInPublishedBand,
  unitsFromResult,
  impliedProbabilityFromOdds,
} from '../../lib/odds-units.js'

describe('detectOddsFormat', () => {
  test('treats +110 / 110 / abs >= 100 as American', () => {
    expect(detectOddsFormat(110)).toBe('american')
    expect(detectOddsFormat('+110')).toBe('american')
    expect(detectOddsFormat(150)).toBe('american')
  })

  test('treats negatives as American', () => {
    expect(detectOddsFormat(-150)).toBe('american')
    expect(detectOddsFormat('-110')).toBe('american')
  })

  test('treats 1.44-2.10 range as decimal', () => {
    expect(detectOddsFormat(1.91)).toBe('decimal')
    expect(detectOddsFormat(1.44)).toBe('decimal')
    expect(detectOddsFormat(2.10)).toBe('decimal')
  })
})

describe('unitsFromResult', () => {
  test('+110 win is +1.10 units, not +109', () => {
    expect(unitsFromResult(110, 'correct')).toBeCloseTo(1.10, 5)
    expect(unitsFromResult('+110', 'win')).toBeCloseTo(1.10, 5)
  })

  test('decimal 1.91 win is +0.91', () => {
    expect(unitsFromResult(1.91, 'correct')).toBeCloseTo(0.91, 5)
  })

  test('-150 win is +0.667', () => {
    expect(unitsFromResult(-150, 'correct')).toBeCloseTo(100 / 150, 5)
  })

  test('a loss is -1 unit', () => {
    expect(unitsFromResult(110, 'incorrect')).toBe(-1)
    expect(unitsFromResult(1.91, 'loss')).toBe(-1)
    expect(unitsFromResult(-150, 'incorrect')).toBe(-1)
  })

  test('push is 0', () => {
    expect(unitsFromResult(110, 'push')).toBe(0)
  })
})

describe('impliedProbabilityFromOdds', () => {
  test('does not treat American 110 as decimal 110', () => {
    expect(impliedProbabilityFromOdds(110)).toBeCloseTo(100 / 210, 5)
    expect(impliedProbabilityFromOdds(1.91)).toBeCloseTo(1 / 1.91, 5)
  })
})

describe('toAmericanOdds', () => {
  test('leaves American values alone', () => {
    expect(toAmericanOdds(-150)).toBe(-150)
    expect(toAmericanOdds(110)).toBe(110)
    expect(toAmericanOdds('+110')).toBe(110)
  })

  test('converts decimal without mixing formats', () => {
    expect(toAmericanOdds(1.50)).toBeCloseTo(-200, 5)
    expect(toAmericanOdds(1.91)).toBeCloseTo(-100 / 0.91, 5)
    expect(toAmericanOdds(2.0)).toBe(100)
    expect(toAmericanOdds(3.50)).toBeCloseTo(250, 5)
  })
})

describe('isAmericanOddsInPublishedBand', () => {
  test('includes −200 to +250 after honest parse', () => {
    expect(isAmericanOddsInPublishedBand(-200)).toBe(true)
    expect(isAmericanOddsInPublishedBand(250)).toBe(true)
    expect(isAmericanOddsInPublishedBand(1.50)).toBe(true)
    expect(isAmericanOddsInPublishedBand(3.50)).toBe(true)
    expect(isAmericanOddsInPublishedBand(-110)).toBe(true)
  })

  test('excludes juice and longshot prices', () => {
    expect(isAmericanOddsInPublishedBand(-250)).toBe(false)
    expect(isAmericanOddsInPublishedBand(300)).toBe(false)
    expect(isAmericanOddsInPublishedBand(1.40)).toBe(false)
    expect(isAmericanOddsInPublishedBand(4.00)).toBe(false)
    expect(isAmericanOddsInPublishedBand(null)).toBe(false)
  })
})

describe('formatAmericanOdds', () => {
  test('formats mixed storage as signed American', () => {
    expect(formatAmericanOdds(-110)).toBe('-110')
    expect(formatAmericanOdds(110)).toBe('+110')
    expect(formatAmericanOdds(1.91)).toBe('-110')
  })
})
