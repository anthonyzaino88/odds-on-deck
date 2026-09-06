import {
  isPublishedPick,
  isPublishedEligibleProp,
  isEditorsBoardFill,
  filterPublishedPicks,
  summarizePublishedPicks,
  selectTodaysBoardRows,
  summarizeYesterdayPublished,
  getEtCalendarDayRange,
  pickWhyChip,
  boardRowKey,
  matchesPublishedStatsPrefilter,
  PUBLISHED_MIN_QUALITY,
  PUBLISHED_STATS_PREFILTER,
  TODAYS_BOARD_CAP,
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

describe('matchesPublishedStatsPrefilter', () => {
  test('mirrors the SQL prefilter used by getPublishedPicksStats', () => {
    expect(PUBLISHED_STATS_PREFILTER.sports).toEqual(['mlb', 'nfl'])
    expect(PUBLISHED_STATS_PREFILTER.minQuality).toBe(PUBLISHED_MIN_QUALITY)
    expect(PUBLISHED_STATS_PREFILTER.edgeGreaterThan).toBe(0)

    expect(matchesPublishedStatsPrefilter(publishedBase())).toBe(true)
    expect(matchesPublishedStatsPrefilter(publishedBase({ sport: 'nhl' }))).toBe(false)
    expect(matchesPublishedStatsPrefilter(publishedBase({ edge: 0 }))).toBe(false)
    expect(matchesPublishedStatsPrefilter(publishedBase({ qualityScore: 39.9 }))).toBe(false)
  })

  test('does not replace juice-trap or odds-band checks — those stay in JS', () => {
    expect(matchesPublishedStatsPrefilter(publishedBase({
      prediction: 'under',
      threshold: 0.5,
      propType: 'batter_hits',
    }))).toBe(true)
    expect(matchesPublishedStatsPrefilter(publishedBase({ odds: -250 }))).toBe(true)
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

describe('isPublishedEligibleProp', () => {
  test('accepts an ungraded MLB/NFL prop that meets filters 2–6', () => {
    expect(isPublishedEligibleProp({
      pick: 'over',
      type: 'batter_hits',
      threshold: 1.5,
      odds: -110,
      edge: 0.04,
      qualityScore: 42,
      sport: 'mlb',
    })).toBe(true)
  })

  test('does not require a graded result — pending can sit on today’s board', () => {
    expect(isPublishedEligibleProp(publishedBase({ status: 'pending', result: null }))).toBe(true)
    expect(isPublishedPick(publishedBase({ status: 'pending', result: null }))).toBe(false)
  })

  test('still drops juice traps, juice prices, flat edge, low QS, and NHL', () => {
    expect(isPublishedEligibleProp(publishedBase({ prediction: 'under', threshold: 0.5 }))).toBe(false)
    expect(isPublishedEligibleProp(publishedBase({ odds: -250 }))).toBe(false)
    expect(isPublishedEligibleProp(publishedBase({ edge: 0 }))).toBe(false)
    expect(isPublishedEligibleProp(publishedBase({ qualityScore: 39 }))).toBe(false)
    expect(isPublishedEligibleProp(publishedBase({ sport: 'nhl' }))).toBe(false)
  })
})

describe('isEditorsBoardFill', () => {
  test('allows a no-juice MLB/NFL prop in the odds band without QS or edge floors', () => {
    expect(isEditorsBoardFill({
      pick: 'over',
      type: 'batter_hits',
      threshold: 1.5,
      odds: -110,
      edge: 0,
      qualityScore: 20,
      sport: 'nfl',
    })).toBe(true)
  })

  test('still rejects juice traps, odds outside the band, and NHL', () => {
    expect(isEditorsBoardFill(publishedBase({ prediction: 'under', threshold: 0.5 }))).toBe(false)
    expect(isEditorsBoardFill(publishedBase({ odds: 300 }))).toBe(false)
    expect(isEditorsBoardFill(publishedBase({ sport: 'nhl' }))).toBe(false)
  })
})

describe('selectTodaysBoardRows', () => {
  function prop(name, overrides = {}) {
    return {
      playerName: name,
      gameId: `g-${name}`,
      pick: 'over',
      type: 'batter_hits',
      threshold: 1.5,
      odds: -110,
      edge: 0.05,
      qualityScore: 50,
      sport: 'mlb',
      ...overrides,
    }
  }

  test('prefers Published-eligible rows and caps at 5', () => {
    const publishedEligible = [1, 2, 3, 4, 5, 6].map((n) =>
      prop(`P${n}`, { edge: 0.10 - n * 0.01 }),
    )
    const rows = selectTodaysBoardRows({ publishedEligible, editorsFill: [prop('Editor')] })
    expect(rows).toHaveLength(TODAYS_BOARD_CAP)
    expect(rows.every((row) => row.source === 'published')).toBe(true)
    expect(rows.map((row) => row.prop.playerName)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5'])
  })

  test('fills with Editor’s when fewer than 3 Published-eligible qualify', () => {
    const publishedEligible = [prop('Keep', { edge: 0.12 })]
    const editorsFill = [
      prop('Fill A', { edge: 0, qualityScore: 22 }),
      prop('Fill B', { edge: 0.01, qualityScore: 18 }),
      prop('Juice', { pick: 'under', threshold: 0.5, edge: 0.20 }),
    ]
    const rows = selectTodaysBoardRows({ publishedEligible, editorsFill })
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ prop: publishedEligible[0], source: 'published' })
    expect(rows[1].source).toBe('editors')
    expect(rows[2].source).toBe('editors')
    expect(rows.map((row) => row.prop.playerName)).toEqual(['Keep', 'Fill B', 'Fill A'])
  })

  test('does not relabel a Published-eligible prop as Editor’s', () => {
    const same = prop('Same Player')
    const rows = selectTodaysBoardRows({
      publishedEligible: [same],
      editorsFill: [same, prop('Other', { edge: 0, qualityScore: 10 })],
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].source).toBe('published')
    expect(rows[1].prop.playerName).toBe('Other')
    expect(rows[1].source).toBe('editors')
    expect(boardRowKey(rows[0].prop)).not.toBe(boardRowKey(rows[1].prop))
  })
})

describe('summarizeYesterdayPublished', () => {
  // Saturday Sep 5, 2026 16:00 UTC = noon EDT. Prior ET day is Fri Sep 4.
  const now = new Date('2026-09-05T16:00:00.000Z')

  test('uses prior ET calendar day — not rolling 24h', () => {
    const { start, end } = getEtCalendarDayRange(-1, now)
    expect(start.toISOString()).toBe('2026-09-04T04:00:00.000Z')
    expect(end.toISOString()).toBe('2026-09-05T04:00:00.000Z')
  })

  test('W–L among decided Published picks plus flat-1u units', () => {
    const records = [
      publishedBase({
        result: 'correct',
        odds: 110,
        completedAt: '2026-09-04T18:00:00.000Z',
      }),
      publishedBase({
        result: 'correct',
        odds: -110,
        completedAt: '2026-09-04T20:00:00.000Z',
      }),
      publishedBase({
        result: 'incorrect',
        odds: 1.91,
        completedAt: '2026-09-04T22:00:00.000Z',
      }),
      publishedBase({
        result: 'push',
        odds: -110,
        completedAt: '2026-09-04T23:00:00.000Z',
      }),
      publishedBase({
        result: 'correct',
        odds: 150,
        completedAt: '2026-09-05T10:00:00.000Z', // today ET — excluded
      }),
      publishedBase({
        result: 'correct',
        odds: -110,
        sport: 'nhl',
        completedAt: '2026-09-04T18:00:00.000Z',
      }),
    ]

    const yesterday = summarizeYesterdayPublished(records, now)
    expect(yesterday.empty).toBe(false)
    expect(yesterday.correct).toBe(2)
    expect(yesterday.incorrect).toBe(1)
    expect(yesterday.decided).toBe(3)
    const expectedUnits = unitsFromResult(110, 'correct')
      + unitsFromResult(-110, 'correct')
      + unitsFromResult(1.91, 'incorrect')
    expect(yesterday.units).toBeCloseTo(expectedUnits, 5)
    expect(yesterday.line).toBe(`Yesterday: 2–1, ${expectedUnits >= 0 ? '+' : ''}${expectedUnits.toFixed(1)}u`)
  })

  test('soft line when zero decided Published grades yesterday', () => {
    const yesterday = summarizeYesterdayPublished([
      publishedBase({ result: 'push', completedAt: '2026-09-04T18:00:00.000Z' }),
      publishedBase({ result: 'correct', completedAt: '2026-09-03T18:00:00.000Z' }),
    ], now)
    expect(yesterday.empty).toBe(true)
    expect(yesterday.decided).toBe(0)
    expect(yesterday.line).toBe('No Published grades yesterday.')
  })
})

describe('pickWhyChip', () => {
  test('prefers a stored book count and does not invent books', () => {
    expect(pickWhyChip({ numBooks: 3, edge: 0.078, qualityScore: 52 })).toBe('3-book edge')
    expect(pickWhyChip({ edge: 0.078, qualityScore: 52 })).toBe('+7.8% edge')
    expect(pickWhyChip({ qualityScore: 52 })).toBe('QS 52')
    expect(pickWhyChip({ edge: 0.04 })).toBe('+4.0% edge')
    expect(pickWhyChip({})).toBeNull()
  })
})
