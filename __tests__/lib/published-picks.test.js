import {
  isPublishedPick,
  filterPublishedPicks,
  summarizePublishedPicks,
  PUBLISHED_MIN_QUALITY,
} from '../../lib/published-picks.js'
import { unitsFromResult } from '../../lib/odds-units.js'

function publishedBase(overrides = {}) {
  return {
    status: 'completed',
    result: 'correct',
    prediction: 'over',
    propType: 'batter_hits',
    threshold: 1.5,
    odds: -110,
    edge: 0.04,
    qualityScore: 42,
    sport: 'mlb',
    ...overrides,
  }
}

describe('isPublishedPick', () => {
  test('accepts a graded MLB pick that meets every locked rule', () => {
    expect(isPublishedPick(publishedBase())).toBe(true)
  })

  test('excludes pending — ROI is graded only', () => {
    expect(isPublishedPick(publishedBase({ status: 'pending', result: null }))).toBe(false)
  })

  test('excludes juice traps via isJuiceTrap', () => {
    expect(isPublishedPick(publishedBase({
      prediction: 'under',
      threshold: 0.5,
      propType: 'batter_hits',
    }))).toBe(false)
  })

  test('excludes odds outside American −200 to +250 after honest parse', () => {
    expect(isPublishedPick(publishedBase({ odds: -250 }))).toBe(false)
    expect(isPublishedPick(publishedBase({ odds: 300 }))).toBe(false)
    expect(isPublishedPick(publishedBase({ odds: 1.40 }))).toBe(false)
    expect(isPublishedPick(publishedBase({ odds: 1.91 }))).toBe(true)
  })

  test('requires line-shop edge > 0', () => {
    expect(isPublishedPick(publishedBase({ edge: 0 }))).toBe(false)
    expect(isPublishedPick(publishedBase({ edge: -0.02 }))).toBe(false)
    expect(isPublishedPick(publishedBase({ edge: 0.01 }))).toBe(true)
  })

  test('requires qualityScore ≥ 40', () => {
    expect(isPublishedPick(publishedBase({ qualityScore: 39.9 }))).toBe(false)
    expect(isPublishedPick(publishedBase({ qualityScore: PUBLISHED_MIN_QUALITY }))).toBe(true)
  })

  test('holds NHL off the public published card', () => {
    expect(isPublishedPick(publishedBase({ sport: 'nhl' }))).toBe(false)
    expect(isPublishedPick(publishedBase({ sport: 'nfl' }))).toBe(true)
  })
})

describe('summarizePublishedPicks', () => {
  test('leads ROI math with odds-units — no American/decimal mixup', () => {
    const records = [
      publishedBase({ result: 'correct', odds: 110 }),
      publishedBase({ result: 'incorrect', odds: 1.91 }),
      publishedBase({ result: 'push', odds: -110 }),
      publishedBase({ result: 'correct', odds: -250, qualityScore: 80 }), // juice price — excluded
      publishedBase({ sport: 'nhl', result: 'correct', odds: -110 }),
      publishedBase({ status: 'pending', result: null }),
    ]

    const summary = summarizePublishedPicks(records)
    expect(summary.correct).toBe(1)
    expect(summary.incorrect).toBe(1)
    expect(summary.pushes).toBe(1)
    expect(summary.graded).toBe(3)
    expect(summary.decided).toBe(2)
    expect(summary.units).toBeCloseTo(unitsFromResult(110, 'correct') + unitsFromResult(1.91, 'incorrect'), 5)
    expect(summary.roi).toBeCloseTo(summary.units / 2, 5)
    expect(summary.avgAmerican).not.toBeNull()
  })

  test('returns empty zeros when the cohort is still empty', () => {
    const summary = summarizePublishedPicks([])
    expect(summary.sample).toBe(0)
    expect(summary.roi).toBe(0)
    expect(summary.avgAmerican).toBeNull()
  })
})

describe('filterPublishedPicks', () => {
  test('keeps only the locked cohort', () => {
    const rows = [
      publishedBase({ playerName: 'keep' }),
      publishedBase({ playerName: 'trap', prediction: 'under', threshold: 0.5 }),
    ]
    const kept = filterPublishedPicks(rows)
    expect(kept).toHaveLength(1)
    expect(kept[0].playerName).toBe('keep')
  })
})
