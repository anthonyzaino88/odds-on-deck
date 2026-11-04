import {
  isPublishedPick,
  isPublishedEligibleProp,
  isEditorsBoardFill,
  isPublishedTrackSource,
  filterPublishedPicks,
  summarizePublishedPicks,
  selectTodaysBoardRows,
  rankEditorsPicks,
  summarizeSidesTotals,
  isSidesTotalsPick,
  summarizeYesterdayPublished,
  selectLastNightPublished,
  todaysBoardSlateState,
  getEtCalendarDayRange,
  pickWhyChip,
  boardRowKey,
  matchesPublishedStatsPrefilter,
  toPublishedValidationFields,
  publishedPropId,
  filterOppositePlayerPropSides,
  hasOppositePublishedBlocker,
  isHomepageYesterdayPublished,
  isPublishedOppositeBlocker,
  selectAutoSaveValidationProps,
  publishedEligibleAutoSaveCacheQuery,
  loadPublishedEligibleForAutoSave,
  skipAutoSaveAfterPublishedPrefetchError,
  AUTO_SAVE_PUBLISHED_PREFETCH_MAX_PAGES,
  publishedSlateInstant,
  publishedValidationWritePlan,
  PUBLISHED_COHORT_TAG,
  PUBLISHED_SPORTS,
  PUBLISHED_SOURCE,
  PUBLISHED_MIN_QUALITY,
  PUBLISHED_STATS_PREFILTER,
  PUBLISHED_STATS_SELECT_FIELDS,
  PUBLISHED_PIPELINE_START,
  SHADOW_PUBLISHED_COHORT_TAG,
  SHADOW_PUBLISHED_SPORTS,
  SHADOW_PUBLISHED_STATS_PREFILTER,
  CLOSE_CAPTURE_SPORTS,
  isShadowPublishedEligibleProp,
  isShadowPublishedCohort,
  isPublishedCohort,
  isPublicPropSport,
  isShadowPublishedPick,
  isCloseCaptureEligiblePick,
  filterShadowPublishedPicks,
  summarizeShadowPublishedPicks,
  withPreservedCohortNotes,
  withAppendedCohortTag,
  withAppendedOddsMarketTag,
  notesHasExactTag,
  oddsMarketNotesTag,
  sourceMarketFromPick,
  publishedPersistNotes,
  publishedValidationUpdateFields,
  shouldLockPublishedRecordedPrice,
  withoutShadowPublished,
  withoutPrivateShadowPublished,
  isPrivateShadowPublished,
  applyShadowPublishedNotesExclusion,
  applyPrivateShadowPublishedNotesExclusion,
  toPublicValidationRecord,
  SHADOW_PUBLISHED_NOTES_OR_FILTER,
  PRIVATE_SHADOW_PUBLISHED_NOTES_OR_FILTER,
  AUTO_SAVED_NOTES_TOKEN,
  TODAYS_BOARD_CAP,
  TODAYS_BOARD_MIN_PUBLISHED,
  isLegacyNflPublishedRow,
  publishedRecordedAt,
  legacyNflPublishedFingerprint,
  comparePublishedLegacyNfl,
} from '../../lib/published-picks.js'
import { unitsFromResult } from '../../lib/odds-units.js'
import { paginateSupabaseSelect } from '../../lib/unplayed-game-grades.js'

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
    source: PUBLISHED_SOURCE,
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

  test('holds untagged NHL archive off the public published card', () => {
    expect(isPublishedPick(publishedBase({ sport: 'nhl' }))).toBe(false)
    expect(isPublishedPick(publishedBase({
      sport: 'nhl',
      notes: PUBLISHED_COHORT_TAG,
    }))).toBe(true)
    expect(isPublishedPick(publishedBase({
      sport: 'nfl',
      timestamp: '2026-09-10T16:00:00.000Z',
    }))).toBe(true)
  })

  test('excludes user_saved and other non-system sources from the public record', () => {
    expect(isPublishedPick(publishedBase({
      sport: 'nfl',
      timestamp: '2025-11-02T18:00:00.000Z',
      probability: 0.508,
      edge: 0.24,
      odds: 150,
    }))).toBe(false)
    expect(isPublishedPick(publishedBase({
      sport: 'nfl',
      timestamp: '2026-09-10T18:00:00.000Z',
      probability: 0.49,
      edge: 0.014,
      odds: -110,
    }))).toBe(true)
    expect(isPublishedPick(publishedBase({ source: 'user_saved' }))).toBe(false)
    expect(isPublishedPick(publishedBase({ source: 'parlay_leg' }))).toBe(false)
    expect(isPublishedPick(publishedBase({ source: 'api_generated' }))).toBe(false)
    expect(isPublishedPick(publishedBase({ source: '' }))).toBe(false)
    expect(isPublishedTrackSource(publishedBase())).toBe(true)
    expect(isPublishedTrackSource({ source: 'user_saved' })).toBe(false)
  })

  test('excludes moneyline and game totals even when they look Published-shaped', () => {
    expect(isPublishedPick(publishedBase({
      propType: 'moneyline',
      prediction: 'NYY',
      qualityScore: 80,
      edge: 0.12,
    }))).toBe(false)
    expect(isPublishedPick(publishedBase({
      propType: 'total',
      prediction: 'over',
      threshold: 8.5,
      source: 'game_line',
    }))).toBe(false)
    expect(isPublishedEligibleProp(publishedBase({
      type: 'moneyline',
      pick: 'NYY',
      qualityScore: 80,
      edge: 0.10,
    }))).toBe(false)
  })
})

describe('matchesPublishedStatsPrefilter', () => {
  test('mirrors the SQL prefilter used by getPublishedPicksStats', () => {
    expect(PUBLISHED_STATS_PREFILTER.sports).toEqual(['mlb', 'nfl', 'nhl'])
    expect(PUBLISHED_STATS_PREFILTER.minQuality).toBe(PUBLISHED_MIN_QUALITY)
    expect(PUBLISHED_STATS_PREFILTER.edgeGreaterThan).toBe(0)
    expect(PUBLISHED_STATS_PREFILTER.source).toBe(PUBLISHED_SOURCE)

    expect(matchesPublishedStatsPrefilter(publishedBase())).toBe(true)
    expect(matchesPublishedStatsPrefilter(publishedBase({ sport: 'nhl' }))).toBe(true)
    expect(matchesPublishedStatsPrefilter(publishedBase({ sport: 'nba' }))).toBe(false)
    expect(matchesPublishedStatsPrefilter(publishedBase({ edge: 0 }))).toBe(false)
    expect(matchesPublishedStatsPrefilter(publishedBase({ qualityScore: 39.9 }))).toBe(false)
    expect(matchesPublishedStatsPrefilter(publishedBase({ source: 'user_saved' }))).toBe(false)
  })

  test('does not replace juice-trap or odds-band checks — those stay in JS', () => {
    expect(matchesPublishedStatsPrefilter(publishedBase({
      prediction: 'under',
      threshold: 0.5,
      propType: 'batter_hits',
    }))).toBe(true)
    expect(matchesPublishedStatsPrefilter(publishedBase({ odds: -250 }))).toBe(true)
  })

  test('Published stats select only real PropValidation columns', () => {
    expect(PUBLISHED_STATS_SELECT_FIELDS).not.toContain('pick')
    expect(PUBLISHED_STATS_SELECT_FIELDS).not.toContain('type')
    expect(PUBLISHED_STATS_SELECT_FIELDS).toEqual(expect.arrayContaining([
      'prediction',
      'propType',
      'odds',
      'edge',
      'qualityScore',
      'sport',
      'source',
      'status',
      'result',
      'timestamp',
      'completedAt',
      'playerName',
    ]))
  })
})

describe('legacy NFL Published exclusion', () => {
  test('PUBLISHED_PIPELINE_START is midnight ET on 2026-03-01', () => {
    expect(PUBLISHED_PIPELINE_START).toBe('2026-03-01T05:00:00.000Z')
  })

  test('flags NFL rows recorded before the current persist path', () => {
    const legacy = publishedBase({
      sport: 'nfl',
      timestamp: '2025-11-02T16:00:00.000Z',
      completedAt: '2025-11-03T12:00:00.000Z',
      probability: 0.508,
      edge: 0.24,
      odds: 150,
    })
    expect(isLegacyNflPublishedRow(legacy)).toBe(true)
    expect(publishedRecordedAt(legacy).toISOString()).toBe('2025-11-02T16:00:00.000Z')
    expect(isPublishedPick(legacy)).toBe(false)
    expect(isPublishedPick(legacy, { includeLegacyNfl: true })).toBe(true)
    expect(isPublishedEligibleProp(legacy)).toBe(true)
  })

  test('keeps 2026 NFL and all MLB, even with a large edge', () => {
    expect(isLegacyNflPublishedRow(publishedBase({
      sport: 'nfl',
      timestamp: '2026-09-10T16:00:00.000Z',
      edge: 0.20,
      odds: 150,
    }))).toBe(false)
    expect(isLegacyNflPublishedRow(publishedBase({
      sport: 'mlb',
      timestamp: '2025-11-02T16:00:00.000Z',
      edge: 0.24,
    }))).toBe(false)
    expect(isPublishedPick(publishedBase({
      sport: 'nfl',
      timestamp: '2026-03-01T05:00:00.000Z',
    }))).toBe(true)
  })

  test('does not exclude an NFL row we cannot date', () => {
    expect(isLegacyNflPublishedRow(publishedBase({
      sport: 'nfl',
      timestamp: null,
      completedAt: null,
    }))).toBe(false)
  })

  test('falls back to completedAt when timestamp is omitted or null', () => {
    const viaCompletedAt = publishedBase({
      sport: 'nfl',
      completedAt: '2025-11-03T12:00:00.000Z',
    })
    delete viaCompletedAt.timestamp
    expect(isLegacyNflPublishedRow(viaCompletedAt)).toBe(true)
    expect(publishedRecordedAt(viaCompletedAt).toISOString()).toBe('2025-11-03T12:00:00.000Z')

    expect(isLegacyNflPublishedRow(publishedBase({
      sport: 'nfl',
      timestamp: null,
      completedAt: '2025-11-03T12:00:00.000Z',
    }))).toBe(true)
  })

  test('throws when a narrower select omits both timestamp and completedAt', () => {
    const narrow = publishedBase({ sport: 'nfl' })
    delete narrow.timestamp
    delete narrow.completedAt
    expect(() => isLegacyNflPublishedRow(narrow)).toThrow(/PUBLISHED_STATS_SELECT/)
    expect(() => isPublishedPick(narrow)).toThrow(/timestamp or completedAt/)
  })

  test('old-generator fingerprint is corroboration, not the gate', () => {
    const fp = legacyNflPublishedFingerprint(publishedBase({
      probability: 0.508,
      edge: 0.24,
      odds: 150,
    }))
    expect(fp).toEqual({
      probabilityInOldBand: true,
      edgeInOldBand: true,
      americanInOldBand: true,
    })
    expect(isLegacyNflPublishedRow(publishedBase({
      sport: 'nfl',
      timestamp: '2025-11-02T16:00:00.000Z',
      probability: 0.62,
      edge: 0.03,
      odds: -110,
    }))).toBe(true)
  })

  test('comparePublishedLegacyNfl reports before / after / excluded', () => {
    const legacyWin = publishedBase({
      sport: 'nfl',
      result: 'correct',
      odds: 150,
      timestamp: '2025-11-02T16:00:00.000Z',
      playerName: 'Legacy WR',
    })
    const modernLoss = publishedBase({
      sport: 'nfl',
      result: 'incorrect',
      odds: -110,
      timestamp: '2026-09-10T16:00:00.000Z',
      playerName: 'Modern WR',
    })
    const mlbWin = publishedBase({
      result: 'correct',
      odds: 110,
      timestamp: '2026-04-01T16:00:00.000Z',
    })
    const comparison = comparePublishedLegacyNfl([legacyWin, modernLoss, mlbWin])
    expect(comparison.excluded).toHaveLength(1)
    expect(comparison.excluded[0].playerName).toBe('Legacy WR')
    expect(comparison.before.correct).toBe(2)
    expect(comparison.before.incorrect).toBe(1)
    expect(comparison.after.correct).toBe(1)
    expect(comparison.after.incorrect).toBe(1)
    expect(comparison.after.units).toBeLessThan(comparison.before.units)
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
      publishedBase({ result: 'correct', odds: 150, source: 'user_saved' }), // visitor save — excluded
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

  test('does not fold graded sides & totals into Published ROI', () => {
    const propsWin = publishedBase({ result: 'correct', odds: 110 })
    const mlWin = publishedBase({
      result: 'correct',
      odds: 150,
      propType: 'moneyline',
      prediction: 'NYY',
      source: 'game_line',
      qualityScore: 80,
      edge: 0.10,
    })
    const summary = summarizePublishedPicks([propsWin, mlWin])
    expect(summary.correct).toBe(1)
    expect(summary.graded).toBe(1)
  })
})

describe('summarizeSidesTotals', () => {
  test('tracks graded ML / totals separately and stays honest at zero', () => {
    expect(summarizeSidesTotals([]).graded).toBe(0)
    expect(summarizeSidesTotals([]).record).toBe('0–0')

    const summary = summarizeSidesTotals([
      publishedBase({
        result: 'correct',
        odds: 110,
        propType: 'moneyline',
        prediction: 'NYY',
        source: 'game_line',
      }),
      publishedBase({
        result: 'incorrect',
        odds: -110,
        propType: 'total',
        prediction: 'over',
        source: 'game_line',
      }),
      publishedBase({ result: 'correct', odds: 110 }),
    ])
    expect(summary.correct).toBe(1)
    expect(summary.incorrect).toBe(1)
    expect(summary.graded).toBe(2)
  })

  test('user_saved moneyline does not enter sides & totals even with edge', () => {
    const summary = summarizeSidesTotals([
      publishedBase({
        result: 'correct',
        odds: 110,
        propType: 'moneyline',
        prediction: 'NYY',
        source: 'user_saved',
      }),
    ])
    expect(summary.graded).toBe(0)
  })

  test('ignores NHL game-line rows from the retired nfl-nhl-v0.1.0 model', () => {
    const legacyNhl = publishedBase({
      sport: 'nhl',
      result: 'correct',
      odds: 110,
      propType: 'moneyline',
      prediction: 'EDM',
      source: 'game_line',
      modelRun: 'nfl-nhl-v0.1.0',
    })
    const currentNhl = {
      ...legacyNhl,
      modelRun: 'nhl-gd-v0.2.0',
    }
    expect(isSidesTotalsPick(legacyNhl, { sports: ['nhl'] })).toBe(false)
    expect(isSidesTotalsPick(currentNhl, { sports: ['nhl'] })).toBe(true)
    expect(summarizeSidesTotals([legacyNhl, currentNhl], { sports: ['nhl'] }).graded).toBe(1)

    const legacyNfl = publishedBase({
      sport: 'nfl',
      result: 'correct',
      odds: 110,
      propType: 'moneyline',
      prediction: 'KC',
      source: 'game_line',
      modelRun: 'nfl-nhl-v0.1.0',
    })
    expect(isSidesTotalsPick(legacyNfl)).toBe(true)
  })
})

describe('filterPublishedPicks', () => {
  test('keeps only the locked cohort', () => {
    const rows = [
      publishedBase({ playerName: 'keep' }),
      publishedBase({ playerName: 'trap', prediction: 'under', threshold: 0.5 }),
      publishedBase({ playerName: 'visitor', source: 'user_saved' }),
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

  test('cache rows without source still clear the live board bar', () => {
    const cacheRow = {
      pick: 'over',
      type: 'batter_hits',
      threshold: 1.5,
      odds: -110,
      edge: 0.04,
      qualityScore: 42,
      sport: 'mlb',
    }
    expect(isPublishedEligibleProp(cacheRow)).toBe(true)
    expect(isPublishedPick({ ...cacheRow, status: 'completed', result: 'correct' })).toBe(false)
  })

  test('still drops juice traps, juice prices, flat edge, low QS, and unlisted sports', () => {
    expect(isPublishedEligibleProp(publishedBase({ prediction: 'under', threshold: 0.5 }))).toBe(false)
    expect(isPublishedEligibleProp(publishedBase({ odds: -250 }))).toBe(false)
    expect(isPublishedEligibleProp(publishedBase({ edge: 0 }))).toBe(false)
    expect(isPublishedEligibleProp(publishedBase({ qualityScore: 39 }))).toBe(false)
    expect(isPublishedEligibleProp(publishedBase({ sport: 'nhl' }))).toBe(true)
    expect(isPublishedEligibleProp(publishedBase({ sport: 'nba' }))).toBe(false)
  })
})

describe('isEditorsBoardFill', () => {
  test('matches isPublishedEligibleProp — same Pile B bar, not a looser fill list', () => {
    const keep = {
      pick: 'over',
      type: 'batter_hits',
      threshold: 1.5,
      odds: -110,
      edge: 0.04,
      qualityScore: 42,
      sport: 'nfl',
    }
    expect(isEditorsBoardFill(keep)).toBe(true)
    expect(isEditorsBoardFill(keep)).toBe(isPublishedEligibleProp(keep))

    expect(isEditorsBoardFill({ ...keep, edge: 0, qualityScore: 20 })).toBe(false)
    expect(isEditorsBoardFill(publishedBase({ prediction: 'under', threshold: 0.5 }))).toBe(false)
    expect(isEditorsBoardFill(publishedBase({ odds: 300 }))).toBe(false)
    expect(isEditorsBoardFill(publishedBase({ odds: 1.40 }))).toBe(false)
    expect(isEditorsBoardFill(publishedBase({ sport: 'nhl' }))).toBe(true)
    expect(isEditorsBoardFill(publishedBase({ sport: 'nba' }))).toBe(false)
    expect(isEditorsBoardFill(publishedBase({ qualityScore: 39 }))).toBe(false)
  })
})

describe('rankEditorsPicks', () => {
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

  test('keeps only Pile B and ranks by edge then qualityScore', () => {
    const rows = [
      prop('Low edge', { edge: 0.02, qualityScore: 80 }),
      prop('High edge', { edge: 0.12, qualityScore: 41 }),
      prop('Tie edge better QS', { edge: 0.08, qualityScore: 70 }),
      prop('Tie edge worse QS', { edge: 0.08, qualityScore: 45 }),
      prop('Juice trap', { pick: 'under', threshold: 0.5, edge: 0.20 }),
      prop('Juice price', { odds: -250, edge: 0.18, qualityScore: 90 }),
      prop('Decimal juice', { odds: 1.40, edge: 0.15, qualityScore: 70 }),
      prop('No edge', { edge: 0, qualityScore: 80 }),
      prop('Low QS', { edge: 0.10, qualityScore: 22 }),
      prop('NBA', { sport: 'nba', edge: 0.14, qualityScore: 60 }),
      prop('NHL', { sport: 'nhl', edge: 0.14, qualityScore: 60 }),
    ]

    const ranked = rankEditorsPicks(rows)
    expect(ranked.map((row) => row.playerName)).toEqual([
      'NHL',
      'High edge',
      'Tie edge better QS',
      'Tie edge worse QS',
      'Low edge',
    ])
  })

  test('never pads empty or short Pile B', () => {
    expect(rankEditorsPicks([
      prop('Juice Fav', { odds: -250 }),
      prop('No Edge', { edge: 0 }),
    ])).toEqual([])

    const one = rankEditorsPicks([prop('Only'), prop('NBA', { sport: 'nba' })])
    expect(one).toHaveLength(1)
    expect(one[0].playerName).toBe('Only')
  })

  test('keeps decimal odds that convert into the American band', () => {
    const ranked = rankEditorsPicks([
      prop('Keep', { odds: 1.50 }),
      prop('Out', { odds: 1.40 }),
    ])
    expect(ranked).toHaveLength(1)
    expect(ranked[0].playerName).toBe('Keep')
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

  test('keeps Published-eligible rows and caps at 5', () => {
    const publishedEligible = [1, 2, 3, 4, 5, 6].map((n) =>
      prop(`P${n}`, { edge: 0.10 - n * 0.01 }),
    )
    const rows = selectTodaysBoardRows({ publishedEligible })
    expect(rows).toHaveLength(TODAYS_BOARD_CAP)
    expect(rows.every((row) => row.source === 'published')).toBe(true)
    expect(rows.map((row) => row.prop.playerName)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5'])
  })

  test('never pads an empty or short Pile B with juice / no-edge / Editor fill', () => {
    const juiceFavorite = prop('Juice Fav', { odds: -250, edge: 0.20, qualityScore: 80 })
    const juiceTrap = prop('Trap', { pick: 'under', threshold: 0.5, edge: 0.20 })
    const noEdge = prop('No Edge', { edge: 0, qualityScore: 55 })
    const lowQs = prop('Low QS', { edge: 0.08, qualityScore: 22 })
    const decimalJuice = prop('Dec Juice', { odds: 1.40, edge: 0.15, qualityScore: 70 })
    const nba = prop('NBA', { sport: 'nba', edge: 0.12, qualityScore: 60 })

    expect(selectTodaysBoardRows({
      publishedEligible: [juiceFavorite, juiceTrap, noEdge, lowQs, decimalJuice, nba],
    })).toEqual([])

    const keep = prop('Keep', { edge: 0.12, odds: 1.91 })
    const rows = selectTodaysBoardRows({
      publishedEligible: [keep, juiceFavorite, noEdge, lowQs],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ prop: keep, source: 'published' })
    expect(todaysBoardSlateState(rows.length)).toBe('short')
  })

  test('returns 1–2 Published rows honestly instead of padding to 3+', () => {
    const one = [prop('Only')]
    expect(selectTodaysBoardRows({ publishedEligible: one })).toHaveLength(1)
    expect(todaysBoardSlateState(1)).toBe('short')

    const two = [prop('A', { edge: 0.09 }), prop('B', { edge: 0.04 })]
    const rows = selectTodaysBoardRows({ publishedEligible: two })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.source === 'published')).toBe(true)
    expect(todaysBoardSlateState(rows.length)).toBe('short')
    expect(todaysBoardSlateState(TODAYS_BOARD_MIN_PUBLISHED)).toBe('full')
    expect(todaysBoardSlateState(0)).toBe('empty')
  })

  test('dedupes the same Published prop and keeps American band after decimal convert', () => {
    const same = prop('Same Player', { odds: 1.50 })
    const rows = selectTodaysBoardRows({
      publishedEligible: [same, { ...same }, prop('Out of band', { odds: 1.40 })],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('published')
    expect(boardRowKey(rows[0].prop)).toBe(boardRowKey(same))
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
        notes: PUBLISHED_COHORT_TAG,
        completedAt: '2026-09-04T18:00:00.000Z',
      }),
      publishedBase({
        result: 'correct',
        odds: -110,
        notes: PUBLISHED_COHORT_TAG,
        completedAt: '2026-09-04T20:00:00.000Z',
      }),
      publishedBase({
        result: 'incorrect',
        odds: 1.91,
        notes: PUBLISHED_COHORT_TAG,
        completedAt: '2026-09-04T22:00:00.000Z',
      }),
      publishedBase({
        result: 'push',
        odds: -110,
        notes: PUBLISHED_COHORT_TAG,
        completedAt: '2026-09-04T23:00:00.000Z',
      }),
      publishedBase({
        result: 'correct',
        odds: 150,
        notes: PUBLISHED_COHORT_TAG,
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
      publishedBase({ notes: PUBLISHED_COHORT_TAG, result: 'push', completedAt: '2026-09-04T18:00:00.000Z' }),
      publishedBase({ notes: PUBLISHED_COHORT_TAG, result: 'correct', completedAt: '2026-09-03T18:00:00.000Z' }),
    ], now)
    expect(yesterday.empty).toBe(true)
    expect(yesterday.decided).toBe(0)
    expect(yesterday.line).toBe('No Published grades yesterday.')
  })

  test('morning-graded Sep 8 slate still counts as yesterday on Sep 9', () => {
    const wedAfternoonEt = new Date('2026-09-09T20:12:00.000Z') // 4:12pm ET
    const { start, end } = getEtCalendarDayRange(-1, wedAfternoonEt)
    expect(start.toISOString()).toBe('2026-09-08T04:00:00.000Z')
    expect(end.toISOString()).toBe('2026-09-09T04:00:00.000Z')

    const yesterday = summarizeYesterdayPublished([
      publishedBase({
        result: 'correct',
        odds: 110,
        notes: PUBLISHED_COHORT_TAG,
        gameDate: '2026-09-08T23:05:00.000Z', // first pitch Tue ET
        timestamp: '2026-09-08T15:00:00.000Z',
        completedAt: '2026-09-09T11:10:00.000Z', // morning validate:all
      }),
      publishedBase({
        result: 'incorrect',
        odds: -110,
        notes: PUBLISHED_COHORT_TAG,
        gameDate: '2026-09-08T17:10:00.000Z',
        completedAt: '2026-09-09T11:12:00.000Z',
      }),
      publishedBase({
        result: 'correct',
        odds: 150,
        notes: PUBLISHED_COHORT_TAG,
        gameDate: '2026-09-09T17:05:00.000Z', // today's slate
        completedAt: '2026-09-09T18:00:00.000Z',
      }),
    ], wedAfternoonEt)

    expect(yesterday.empty).toBe(false)
    expect(yesterday.correct).toBe(1)
    expect(yesterday.incorrect).toBe(1)
    expect(yesterday.decided).toBe(2)
    expect(yesterday.line).toMatch(/^Yesterday: 1–1, /)
  })

  test('does not fold a graded game line into yesterday Published', () => {
    const yesterday = summarizeYesterdayPublished([
      publishedBase({
        result: 'correct',
        odds: 150,
        propType: 'moneyline',
        prediction: 'NYY',
        source: 'game_line',
        gameDate: '2026-09-04T23:00:00.000Z',
        completedAt: '2026-09-05T11:00:00.000Z',
      }),
    ], now)
    expect(yesterday.empty).toBe(true)
    expect(yesterday.line).toBe('No Published grades yesterday.')
  })
})

describe('selectLastNightPublished', () => {
  // Tuesday Nov 3, 2026 16:00 UTC = 11:00am EST. Prior ET day is Mon Nov 2.
  const now = new Date('2026-11-03T16:00:00.000Z')

  test('uses prior ET slate via publishedSlateInstant, not completedAt', () => {
    const lastNight = publishedBase({
      playerName: 'Aaron Judge',
      notes: PUBLISHED_COHORT_TAG,
      gameDate: '2026-11-02T23:05:00.000Z',
      timestamp: '2026-11-02T15:00:00.000Z',
      completedAt: '2026-11-03T11:10:00.000Z',
    })
    const regradedJune = publishedBase({
      playerName: 'Miguel Vargas',
      notes: PUBLISHED_COHORT_TAG,
      gameDate: '2026-06-11T23:10:00.000Z',
      gameIdRef: 'ATL_at_CHW_2026-06-11',
      timestamp: '2026-06-11T15:00:00.000Z',
      completedAt: '2026-11-03T04:00:00.000Z',
    })
    const rows = selectLastNightPublished([lastNight, regradedJune], now)
    expect(rows).toHaveLength(1)
    expect(rows[0].playerName).toBe('Aaron Judge')
  })

  test('requires the cohort:published notes tag — eligibility alone is not enough', () => {
    const tagged = publishedBase({
      playerName: 'Tagged',
      notes: `${PUBLISHED_COHORT_TAG} | oddsMarket:batter_hits`,
      gameDate: '2026-11-02T23:05:00.000Z',
      completedAt: '2026-11-03T11:10:00.000Z',
    })
    const untagged = publishedBase({
      playerName: 'Miguel Vargas',
      notes: 'tier:elite,auto-saved',
      gameDate: '2026-11-02T23:10:00.000Z',
      gameIdRef: 'ATL_at_CHW_2026-06-11',
      completedAt: '2026-11-03T04:00:00.000Z',
    })
    expect(isPublishedPick(untagged)).toBe(true)
    expect(isPublishedCohort(untagged)).toBe(false)
    expect(selectLastNightPublished([tagged, untagged], now).map((row) => row.playerName))
      .toEqual(['Tagged'])
  })

  test('yesterday W–L and last-night list use the same cohort:published membership', () => {
    const taggedWin = publishedBase({
      playerName: 'Tagged Win',
      notes: PUBLISHED_COHORT_TAG,
      gameDate: '2026-11-02T23:05:00.000Z',
      completedAt: '2026-11-03T11:10:00.000Z',
    })
    const taggedLoss = publishedBase({
      playerName: 'Tagged Loss',
      result: 'incorrect',
      notes: PUBLISHED_COHORT_TAG,
      gameDate: '2026-11-02T23:10:00.000Z',
      completedAt: '2026-11-03T11:12:00.000Z',
    })
    const untagged = publishedBase({
      playerName: 'Untagged archive',
      notes: 'tier:elite,auto-saved',
      gameDate: '2026-11-02T23:15:00.000Z',
      completedAt: '2026-11-03T11:14:00.000Z',
    })
    const records = [taggedWin, taggedLoss, untagged]
    expect(isPublishedPick(untagged)).toBe(true)
    expect(isHomepageYesterdayPublished(untagged, now)).toBe(false)
    expect(isHomepageYesterdayPublished(taggedWin, now)).toBe(true)

    const lastNight = selectLastNightPublished(records, now)
    const yesterday = summarizeYesterdayPublished(records, now)
    expect(lastNight.map((row) => row.playerName).sort()).toEqual(['Tagged Loss', 'Tagged Win'])
    expect(yesterday.correct).toBe(1)
    expect(yesterday.incorrect).toBe(1)
    expect(yesterday.decided).toBe(2)
    expect(lastNight.every((row) => isHomepageYesterdayPublished(row, now))).toBe(true)
  })

  test('does not treat cohort:shadow-published as the Published tag', () => {
    expect(isPublishedCohort(publishedBase({ notes: PUBLISHED_COHORT_TAG }))).toBe(true)
    expect(isPublishedCohort(publishedBase({ notes: SHADOW_PUBLISHED_COHORT_TAG }))).toBe(false)
    expect(isPublishedCohort(publishedBase({ notes: 'tier:elite' }))).toBe(false)
    expect(isPublicPropSport('mlb')).toBe(true)
    expect(isPublicPropSport('nfl')).toBe(true)
    expect(isPublicPropSport('nhl')).toBe(true)
    expect(isPublicPropSport('nba')).toBe(false)
  })
})

describe('publishedSlateInstant', () => {
  test('prefers gameDate over completedAt so next-morning grades stay on the slate day', () => {
    const at = publishedSlateInstant({
      gameDate: '2026-09-08T23:05:00.000Z',
      timestamp: '2026-09-08T15:00:00.000Z',
      completedAt: '2026-09-09T11:10:00.000Z',
    })
    expect(at.toISOString()).toBe('2026-09-08T23:05:00.000Z')
  })

  test('falls back to timestamp, then completedAt', () => {
    expect(publishedSlateInstant({
      timestamp: '2026-09-08T15:00:00.000Z',
      completedAt: '2026-09-09T11:10:00.000Z',
    }).toISOString()).toBe('2026-09-08T15:00:00.000Z')
    expect(publishedSlateInstant({
      completedAt: '2026-09-09T11:10:00.000Z',
    }).toISOString()).toBe('2026-09-09T11:10:00.000Z')
    expect(publishedSlateInstant({})).toBeNull()
  })
})

describe('toPublishedValidationFields', () => {
  test('keeps cache qualityScore / edge / odds and tags the Published cohort', () => {
    const fields = toPublishedValidationFields({
      propId: 'yelich-tb-15',
      gameId: 'game-1',
      playerName: 'Christian Yelich',
      type: 'batter_total_bases',
      pick: 'over',
      threshold: 1.5,
      odds: 188,
      edge: 0.06,
      qualityScore: 42,
      sport: 'mlb',
      numBooks: 4,
      projection: 1.8,
      bookmaker: 'DraftKings',
    })
    expect(fields).toMatchObject({
      propId: 'yelich-tb-15',
      gameIdRef: 'game-1',
      playerName: 'Christian Yelich',
      propType: 'batter_total_bases',
      prediction: 'over',
      threshold: 1.5,
      odds: 188,
      edge: 0.06,
      qualityScore: 42,
      source: PUBLISHED_SOURCE,
      notes: PUBLISHED_COHORT_TAG,
      status: 'pending',
      sport: 'mlb',
      numBooks: 4,
      entryBook: 'DraftKings',
    })
    expect(fields.source).not.toBe('game_line')
    expect(publishedPropId({ propId: 'yelich-tb-15' })).toBe('yelich-tb-15')
  })

  test('appends availability flags onto Published notes without changing the cohort', () => {
    const fields = toPublishedValidationFields({
      propId: 'kelce-1',
      gameId: 'game-kc',
      playerName: 'Travis Kelce',
      type: 'receiving_yards',
      pick: 'over',
      threshold: 54.5,
      odds: -110,
      edge: 0.05,
      qualityScore: 44,
      sport: 'nfl',
      availabilityFlags: ['injury:questionable'],
    })
    expect(fields.notes).toBe('cohort:published | injury:questionable')
  })

  test('rejects edge-0 juice, juice traps, game lines, unlisted sports, and low QS', () => {
    const keep = {
      propId: 'p1',
      gameId: 'g1',
      playerName: 'A',
      type: 'batter_hits',
      pick: 'over',
      threshold: 0.5,
      odds: -110,
      edge: 0.04,
      qualityScore: 42,
      sport: 'mlb',
    }
    expect(toPublishedValidationFields({ ...keep, edge: 0 })).toBeNull()
    expect(toPublishedValidationFields({ ...keep, pick: 'under', threshold: 0.5 })).toBeNull()
    expect(toPublishedValidationFields({
      ...keep,
      type: 'moneyline',
      pick: 'NYY',
      source: 'game_line',
    })).toBeNull()
    expect(toPublishedValidationFields({ ...keep, sport: 'nba' })).toBeNull()
    expect(toPublishedValidationFields({ ...keep, sport: 'nhl' })).toMatchObject({
      sport: 'nhl',
      notes: PUBLISHED_COHORT_TAG,
    })
    expect(toPublishedValidationFields({ ...keep, qualityScore: 39 })).toBeNull()
    expect(toPublishedValidationFields({ ...keep, odds: -250 })).toBeNull()
  })

  test('maps Editor desk player_prop wraps back to the market type', () => {
    const fields = toPublishedValidationFields({
      propId: 'stowers-1',
      gameId: 'g2',
      playerName: 'Kyle Stowers',
      type: 'player_prop',
      propType: 'batter_total_bases',
      pick: 'over',
      threshold: 1.5,
      odds: 125,
      edge: 0.05,
      qualityScore: 44,
      sport: 'mlb',
    })
    expect(fields.propType).toBe('batter_total_bases')
  })

  test('records sourceMarket on notes without a schema change', () => {
    expect(oddsMarketNotesTag('player_pass_yds_alternate')).toBe('oddsMarket:player_pass_yds_alternate')
    expect(sourceMarketFromPick({
      notes: 'cohort:published | oddsMarket:player_pass_yds_alternate',
    })).toBe('player_pass_yds_alternate')
    expect(withAppendedOddsMarketTag('cohort:published', 'player_pass_yds_alternate'))
      .toBe('cohort:published | oddsMarket:player_pass_yds_alternate')
    expect(notesHasExactTag('oddsMarket:player_pass_yds_alternate', 'oddsMarket:player_pass_yds')).toBe(false)
    expect(notesHasExactTag('oddsMarket:player_pass_yds_alternate', 'oddsMarket:player_pass_yds_alternate')).toBe(true)
    expect(withAppendedOddsMarketTag('oddsMarket:player_pass_yds_alternate', 'player_pass_yds'))
      .toBe('oddsMarket:player_pass_yds_alternate | oddsMarket:player_pass_yds')
    expect(withAppendedOddsMarketTag('oddsMarket:player_pass_yds', 'player_pass_yds'))
      .toBe('oddsMarket:player_pass_yds')
    const fields = toPublishedValidationFields({
      propId: 'stafford-1',
      gameId: 'g3',
      playerName: 'Matthew Stafford',
      type: 'passing_yards',
      pick: 'over',
      threshold: 219.5,
      odds: -110,
      edge: 0.05,
      qualityScore: 50,
      sport: 'nfl',
      sourceMarket: 'player_pass_yds_alternate',
    })
    expect(fields.notes).toBe('cohort:published | oddsMarket:player_pass_yds_alternate')
    expect(sourceMarketFromPick(fields)).toBe('player_pass_yds_alternate')
  })
})

describe('publishedValidationWritePlan', () => {
  test('inserts new, updates pending system rows, skips completed, needs_review, and manual_closed', () => {
    expect(publishedValidationWritePlan(null)).toBe('insert')
    expect(publishedValidationWritePlan({ status: 'pending', source: PUBLISHED_SOURCE })).toBe('update')
    expect(publishedValidationWritePlan({ status: 'completed', result: 'correct', source: PUBLISHED_SOURCE })).toBe('skip')
    expect(publishedValidationWritePlan({ status: 'needs_review', source: PUBLISHED_SOURCE })).toBe('skip')
    expect(publishedValidationWritePlan({ status: 'manual_closed', source: PUBLISHED_SOURCE })).toBe('skip')
  })

  test('never adopts a pending row whose source is not system_generated', () => {
    expect(publishedValidationWritePlan({
      status: 'pending',
      source: 'user_saved',
      propId: 'pub-mlb-g1-aaron judge-batter_hits-over-1.5',
      gameIdRef: 'other-game',
      playerName: 'Planted',
    })).toBe('skip_foreign')
    expect(publishedValidationWritePlan({
      status: 'pending',
      source: PUBLISHED_SOURCE,
      notes: SHADOW_PUBLISHED_COHORT_TAG,
    })).toBe('skip_shadow')
    expect(publishedValidationWritePlan({
      status: 'pending',
      source: PUBLISHED_SOURCE,
      notes: SHADOW_PUBLISHED_COHORT_TAG,
    }, { shadow: true })).toBe('update')
    expect(publishedValidationWritePlan({ status: 'pending', source: 'parlay_leg' })).toBe('skip_foreign')
    expect(publishedValidationWritePlan({ status: 'pending', source: 'api_generated' })).toBe('skip_foreign')
    expect(publishedValidationWritePlan({ status: 'pending' })).toBe('skip_foreign')
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

describe('shadow published NHL cohort', () => {
  const nhlKeep = {
    status: 'completed',
    result: 'correct',
    prediction: 'over',
    propType: 'player_shots_on_goal',
    threshold: 2.5,
    odds: -110,
    edge: 0.05,
    qualityScore: 44,
    sport: 'nhl',
    source: PUBLISHED_SOURCE,
    notes: SHADOW_PUBLISHED_COHORT_TAG,
    playerName: 'Auston Matthews',
    gameId: 'TOR_at_BOS_2026-10-29',
    propId: 'matthews-sog-25',
  }

  test('keeps NHL on the public sport list and a distinct historical shadow list', () => {
    expect(PUBLISHED_SPORTS).toEqual(['mlb', 'nfl', 'nhl'])
    expect(SHADOW_PUBLISHED_SPORTS).toEqual(['nhl'])
    expect(CLOSE_CAPTURE_SPORTS).toEqual(['mlb', 'nfl', 'nhl'])
    expect(SHADOW_PUBLISHED_COHORT_TAG).toBe('cohort:shadow-published')
    expect(SHADOW_PUBLISHED_COHORT_TAG).not.toBe(PUBLISHED_COHORT_TAG)
    expect(SHADOW_PUBLISHED_STATS_PREFILTER.sports).toEqual(['nhl'])
    expect(SHADOW_PUBLISHED_STATS_PREFILTER.source).toBe(PUBLISHED_SOURCE)
    expect(SHADOW_PUBLISHED_STATS_PREFILTER.minQuality).toBe(PUBLISHED_MIN_QUALITY)
  })

  test('applies the identical Published bar to NHL; shadow tag stays off the public card', () => {
    expect(isPublishedEligibleProp(nhlKeep)).toBe(true)
    expect(isPublishedPick(nhlKeep)).toBe(false)
    expect(isPublishedPick({ ...nhlKeep, notes: PUBLISHED_COHORT_TAG })).toBe(true)
    expect(isShadowPublishedEligibleProp(nhlKeep)).toBe(true)
    expect(isShadowPublishedPick(nhlKeep)).toBe(true)
    expect(isShadowPublishedEligibleProp({ ...nhlKeep, edge: 0 })).toBe(false)
    expect(isShadowPublishedEligibleProp({ ...nhlKeep, qualityScore: 39 })).toBe(false)
    expect(isShadowPublishedEligibleProp({ ...nhlKeep, odds: -250 })).toBe(false)
    expect(isShadowPublishedEligibleProp({
      ...nhlKeep,
      prediction: 'under',
      threshold: 0.5,
    })).toBe(false)
    expect(isShadowPublishedEligibleProp({ ...nhlKeep, sport: 'mlb' })).toBe(false)
  })

  test('shadow record/ROI drops rows tagged with nfl-nhl-v0.1.0 and keeps current props', () => {
    const legacyTagged = {
      ...nhlKeep,
      modelRun: 'nfl-nhl-v0.1.0',
    }
    expect(isShadowPublishedPick(legacyTagged)).toBe(false)
    expect(isPublishedPick(legacyTagged, { includeShadowPublished: true, sports: ['nhl'] })).toBe(false)
    expect(isShadowPublishedPick(nhlKeep)).toBe(true)
    expect(summarizeShadowPublishedPicks([legacyTagged, nhlKeep]).graded).toBe(1)
  })

  test('public Published helpers never admit a shadow-tagged row', () => {
    const taggedMlb = publishedBase({ notes: SHADOW_PUBLISHED_COHORT_TAG })
    expect(isPublishedPick(taggedMlb)).toBe(false)
    expect(filterPublishedPicks([taggedMlb, publishedBase()])).toHaveLength(1)
    expect(withoutShadowPublished([taggedMlb, publishedBase()])).toHaveLength(1)
    expect(isShadowPublishedCohort(nhlKeep)).toBe(true)
    expect(isShadowPublishedCohort(publishedBase({ notes: PUBLISHED_COHORT_TAG }))).toBe(false)
  })

  test('new NHL persist payload uses the public Published tag', () => {
    expect(toPublishedValidationFields(nhlKeep)).toMatchObject({
      sport: 'nhl',
      source: PUBLISHED_SOURCE,
      notes: PUBLISHED_COHORT_TAG,
      qualityScore: 44,
      edge: 0.05,
      status: 'pending',
    })
    const shadowFields = toPublishedValidationFields(nhlKeep, {
      notes: SHADOW_PUBLISHED_COHORT_TAG,
    })
    expect(shadowFields).toMatchObject({
      sport: 'nhl',
      notes: SHADOW_PUBLISHED_COHORT_TAG,
    })
  })

  test('close capture includes published NHL and tagged shadow, not untagged NHL archive', () => {
    expect(isCloseCaptureEligiblePick(publishedBase({ status: 'pending' }))).toBe(true)
    expect(isCloseCaptureEligiblePick(nhlKeep)).toBe(true)
    expect(isCloseCaptureEligiblePick({
      ...nhlKeep,
      notes: PUBLISHED_COHORT_TAG,
    })).toBe(true)
    expect(isCloseCaptureEligiblePick({
      ...nhlKeep,
      notes: 'tier:elite',
    })).toBe(false)
    expect(isCloseCaptureEligiblePick({ ...nhlKeep, source: 'user_saved' })).toBe(false)
  })

  test('grading preserves the shadow tag so Published SQL can keep excluding it', () => {
    expect(withPreservedCohortNotes(
      SHADOW_PUBLISHED_COHORT_TAG,
      'Validated: OVER 2.5 → Actual: 3',
    )).toBe('cohort:shadow-published | Validated: OVER 2.5 → Actual: 3')
    expect(withPreservedCohortNotes(
      'cohort:shadow-published | Validated: OVER 2.5 → Actual: 3',
      'Validated: OVER 2.5 → Actual: 4',
    )).toBe('cohort:shadow-published | Validated: OVER 2.5 → Actual: 4')
    expect(withPreservedCohortNotes(null, 'Validated: OVER 2.5 → Actual: 3'))
      .toBe('Validated: OVER 2.5 → Actual: 3')
    expect(withPreservedCohortNotes(SHADOW_PUBLISHED_COHORT_TAG, null))
      .toBe(SHADOW_PUBLISHED_COHORT_TAG)
    expect(withPreservedCohortNotes(SHADOW_PUBLISHED_COHORT_TAG, undefined))
      .toBe(SHADOW_PUBLISHED_COHORT_TAG)
    expect(withPreservedCohortNotes(SHADOW_PUBLISHED_COHORT_TAG, ''))
      .toBe(SHADOW_PUBLISHED_COHORT_TAG)
    expect(withPreservedCohortNotes(SHADOW_PUBLISHED_COHORT_TAG, null))
      .not.toMatch(/ \| $/)
  })

  test('shadow persist appends the tag onto auto-saved NHL notes instead of replacing them', () => {
    expect(withAppendedCohortTag('tier:elite,auto-saved', SHADOW_PUBLISHED_COHORT_TAG))
      .toBe('tier:elite,auto-saved | cohort:shadow-published')
    expect(withAppendedCohortTag(
      'tier:elite,auto-saved | cohort:shadow-published',
      SHADOW_PUBLISHED_COHORT_TAG,
    )).toBe('tier:elite,auto-saved | cohort:shadow-published')
    expect(publishedPersistNotes('tier:elite,auto-saved', SHADOW_PUBLISHED_COHORT_TAG, { shadow: true }))
      .toBe('tier:elite,auto-saved | cohort:shadow-published')
    expect(publishedPersistNotes(null, SHADOW_PUBLISHED_COHORT_TAG, { shadow: true }))
      .toBe(SHADOW_PUBLISHED_COHORT_TAG)
    expect(publishedPersistNotes('keep-me', PUBLISHED_COHORT_TAG, { shadow: false }))
      .toBe(PUBLISHED_COHORT_TAG)
  })

  test('update path locks recorded odds/line after a close or once the game has started', () => {
    const fields = toPublishedValidationFields({
      ...nhlKeep,
      threshold: 3.5,
      odds: -125,
      pick: 'under',
      prediction: 'under',
      probability: 0.55,
      edge: 0.06,
      qualityScore: 50,
      bookmaker: 'FanDuel',
    }, {
      notes: SHADOW_PUBLISHED_COHORT_TAG,
    })
    expect(fields.entryBook).toBe('FanDuel')
    expect(shouldLockPublishedRecordedPrice({ closeOdds: -108 }, { status: 'scheduled' })).toBe(true)
    expect(shouldLockPublishedRecordedPrice({ closeCapturedAt: '2026-10-29T00:00:00Z' }, {})).toBe(true)
    expect(shouldLockPublishedRecordedPrice({ odds: -110 }, { status: 'in_progress' })).toBe(true)
    expect(shouldLockPublishedRecordedPrice({ odds: -110 }, { status: 'halftime' })).toBe(true)
    expect(shouldLockPublishedRecordedPrice({ odds: -110 }, { status: 'STATUS_HALFTIME' })).toBe(true)
    expect(shouldLockPublishedRecordedPrice({ odds: -110 }, { status: 'scheduled' })).toBe(false)
    expect(shouldLockPublishedRecordedPrice({ odds: -110 }, {})).toBe(false)
    expect(shouldLockPublishedRecordedPrice(
      { odds: -110 },
      { status: 'scheduled', date: '2026-10-01T00:00:00Z' },
      new Date('2026-10-29T18:00:00Z'),
    )).toBe(true)
    expect(shouldLockPublishedRecordedPrice(
      { odds: -110 },
      { status: 'scheduled', date: '2026-11-01T00:00:00Z' },
      new Date('2026-10-29T18:00:00Z'),
    )).toBe(false)

    const existing = {
      ...nhlKeep,
      status: 'pending',
      notes: 'tier:elite,auto-saved',
      threshold: 2.5,
      odds: -110,
      prediction: 'over',
      probability: 0.52,
      closeOdds: -108,
    }
    const locked = publishedValidationUpdateFields(existing, fields, { status: 'scheduled' }, { shadow: true })
    expect(locked.odds).toBeUndefined()
    expect(locked.entryBook).toBeUndefined()
    expect(locked.threshold).toBeUndefined()
    expect(locked.prediction).toBeUndefined()
    expect(locked.probability).toBeUndefined()
    expect(locked.edge).toBe(0.06)
    expect(locked.qualityScore).toBe(50)
    expect(locked.notes).toBe('tier:elite,auto-saved | cohort:shadow-published')

    const unlocked = publishedValidationUpdateFields(
      { ...existing, closeOdds: null, closeCapturedAt: null },
      fields,
      { status: 'scheduled' },
      { shadow: true },
    )
    expect(unlocked.odds).toBe(-125)
    expect(unlocked.entryBook).toBe('FanDuel')
    expect(unlocked.threshold).toBe(3.5)
    expect(unlocked.notes).toBe('tier:elite,auto-saved | cohort:shadow-published')
  })

  test('clears entryBook when unlocked odds change and the new snapshot has no book', () => {
    const existing = {
      ...nhlKeep,
      status: 'pending',
      notes: PUBLISHED_COHORT_TAG,
      odds: -110,
      entryBook: 'DraftKings',
      closeOdds: null,
      closeCapturedAt: null,
    }
    const withBook = toPublishedValidationFields({
      ...nhlKeep,
      pick: 'over',
      odds: -125,
      bookmaker: 'FanDuel',
    })
    const withoutBook = toPublishedValidationFields({
      ...nhlKeep,
      pick: 'over',
      odds: -125,
    })
    expect(withoutBook.entryBook).toBeUndefined()

    const cleared = publishedValidationUpdateFields(existing, withoutBook, { status: 'scheduled' })
    expect(cleared.odds).toBe(-125)
    expect(cleared.entryBook).toBeNull()

    const retagged = publishedValidationUpdateFields(existing, withBook, { status: 'scheduled' })
    expect(retagged.entryBook).toBe('FanDuel')

    const sameOdds = publishedValidationUpdateFields(
      existing,
      toPublishedValidationFields({ ...nhlKeep, pick: 'over', odds: -110 }),
      { status: 'scheduled' },
    )
    expect(sameOdds.odds).toBe(-110)
    expect(sameOdds.entryBook).toBeUndefined()

    const locked = publishedValidationUpdateFields(
      { ...existing, closeOdds: -108 },
      withoutBook,
      { status: 'scheduled' },
    )
    expect(locked.odds).toBeUndefined()
    expect(locked.entryBook).toBeUndefined()
  })

  test('auto-saved+tagged NHL stays in the archive; shadow-only rows do not', () => {
    const tagged = {
      ...nhlKeep,
      notes: 'tier:elite,auto-saved | cohort:shadow-published',
    }
    const untagged = { ...nhlKeep, notes: 'tier:elite,auto-saved' }
    const shadowOnly = { ...nhlKeep, notes: SHADOW_PUBLISHED_COHORT_TAG }
    const archive = [untagged, tagged, shadowOnly]
    expect(withoutShadowPublished(archive)).toEqual([untagged])
    expect(withoutPrivateShadowPublished(archive)).toEqual([untagged, tagged])
    expect(isPrivateShadowPublished(shadowOnly)).toBe(true)
    expect(isPrivateShadowPublished(tagged)).toBe(false)
    expect(isPublishedPick(tagged)).toBe(false)
    expect(isPublishedPick(untagged)).toBe(false)
    expect(isShadowPublishedPick(tagged)).toBe(true)
    expect(isShadowPublishedPick(untagged)).toBe(false)
  })

  test('public validation records omit notes so the cohort tag cannot leak', () => {
    const publicRow = toPublicValidationRecord({
      ...nhlKeep,
      notes: 'tier:elite,auto-saved | cohort:shadow-published',
      id: 'pv-1',
    })
    expect(publicRow.notes).toBeUndefined()
    expect(publicRow).not.toHaveProperty('notes')
    expect(publicRow.playerName).toBe('Auston Matthews')
    expect(JSON.stringify(publicRow)).not.toMatch(/shadow-published/)
  })

  test('public query helper uses a NULL-safe notes exclusion', () => {
    const or = jest.fn((filter) => ({ or, filter }))
    const result = applyShadowPublishedNotesExclusion({ or })
    expect(or).toHaveBeenCalledWith(SHADOW_PUBLISHED_NOTES_OR_FILTER)
    expect(SHADOW_PUBLISHED_NOTES_OR_FILTER).toMatch(/notes\.is\.null/)
    expect(SHADOW_PUBLISHED_NOTES_OR_FILTER).toMatch(/shadow-published/)
    expect(result.filter).toBe(SHADOW_PUBLISHED_NOTES_OR_FILTER)
  })

  test('archive/insights SQL keeps auto-saved rows and drops shadow-only', () => {
    const or = jest.fn((filter) => ({ or, filter }))
    const result = applyPrivateShadowPublishedNotesExclusion({ or })
    expect(or).toHaveBeenCalledWith(PRIVATE_SHADOW_PUBLISHED_NOTES_OR_FILTER)
    expect(PRIVATE_SHADOW_PUBLISHED_NOTES_OR_FILTER).toMatch(/notes\.is\.null/)
    expect(PRIVATE_SHADOW_PUBLISHED_NOTES_OR_FILTER).toMatch(/shadow-published/)
    expect(PRIVATE_SHADOW_PUBLISHED_NOTES_OR_FILTER).toMatch(AUTO_SAVED_NOTES_TOKEN)
    expect(result.filter).toBe(PRIVATE_SHADOW_PUBLISHED_NOTES_OR_FILTER)
  })

  test('shadow ROI uses the same units math and ignores untagged NHL archive', () => {
    const win = nhlKeep
    const loss = {
      ...nhlKeep,
      id: '2',
      result: 'incorrect',
      odds: -110,
    }
    const archive = { ...nhlKeep, notes: 'tier:elite' }
    const summary = summarizeShadowPublishedPicks([win, loss, archive])
    expect(filterShadowPublishedPicks([win, loss, archive])).toHaveLength(2)
    expect(summary.record).toBe('1–1')
    expect(summary.decided).toBe(2)
  })
})

describe('filterOppositePlayerPropSides', () => {
  function boeser(side, extras = {}) {
    return {
      playerName: 'Brock Boeser',
      gameId: 'VAN_at_NYR_2026-11-02',
      sport: 'nhl',
      type: 'player_shots_on_goal',
      pick: side,
      threshold: 2.5,
      odds: -110,
      edge: 0.05,
      qualityScore: 44,
      ...extras,
    }
  }

  test('keeps the stronger Over/Under of the same player+market+line', () => {
    const kept = filterOppositePlayerPropSides([
      boeser('under', { edge: 0.04, qualityScore: 41 }),
      boeser('over', { edge: 0.08, qualityScore: 55 }),
    ])
    expect(kept).toHaveLength(1)
    expect(kept[0].pick).toBe('over')
  })

  test('Published eligible Over beats a higher-edge auto-save Under', () => {
    const publishedOver = boeser('over', {
      edge: 0.04,
      qualityScore: 42,
      notes: PUBLISHED_COHORT_TAG,
      propId: 'pub-boeser-over',
    })
    const tierUnder = boeser('under', {
      edge: 0.12,
      qualityScore: 48,
      odds: -250,
      notes: 'tier:elite,auto-saved',
      propId: 'tier-boeser-under',
    })
    expect(isPublishedEligibleProp(publishedOver)).toBe(true)
    expect(isPublishedEligibleProp(tierUnder)).toBe(false)
    const kept = filterOppositePlayerPropSides([tierUnder, publishedOver])
    expect(kept).toHaveLength(1)
    expect(kept[0].pick).toBe('over')
    expect(kept[0].propId).toBe('pub-boeser-over')
  })

  test('exact tie prefers Published, then a stable propId tiebreak', () => {
    const tagged = boeser('over', {
      notes: PUBLISHED_COHORT_TAG,
      propId: 'z-over',
    })
    const untagged = boeser('under', { propId: 'a-under' })
    expect(filterOppositePlayerPropSides([untagged, tagged]).map((row) => row.pick))
      .toEqual(['over'])

    const over = boeser('over', { propId: 'b-over' })
    const under = boeser('under', { propId: 'a-under' })
    expect(filterOppositePlayerPropSides([over, under]).map((row) => row.propId))
      .toEqual(['a-under'])
  })

  test('keeps every distinct-propId row on the winning side', () => {
    const kept = filterOppositePlayerPropSides([
      boeser('under', { edge: 0.03, propId: 'under-1' }),
      boeser('over', { edge: 0.08, propId: 'over-fd' }),
      boeser('over', { edge: 0.06, propId: 'over-dk' }),
    ])
    expect(kept.map((row) => row.propId).sort()).toEqual(['over-dk', 'over-fd'])
  })

  test('collapses winning-side rows that share a book-less propId', () => {
    const kept = filterOppositePlayerPropSides([
      boeser('under', { edge: 0.03 }),
      boeser('over', { edge: 0.08, bookmaker: 'FanDuel' }),
      boeser('over', { edge: 0.06, bookmaker: 'DraftKings' }),
    ])
    expect(kept).toHaveLength(1)
    expect(kept[0].pick).toBe('over')
    expect(kept[0].edge).toBe(0.08)
  })

  test('leaves a single side and a different line alone', () => {
    const other = boeser('over', { threshold: 3.5, playerName: 'Quinn Hughes' })
    const kept = filterOppositePlayerPropSides([boeser('over'), other])
    expect(kept).toHaveLength(2)
  })
})

describe('auto-save opposite Published guard', () => {
  function boeser(side, extras = {}) {
    return {
      playerName: 'Brock Boeser',
      gameId: 'VAN_at_NYR_2026-11-02',
      sport: 'nhl',
      type: 'player_shots_on_goal',
      pick: side,
      threshold: 2.5,
      odds: extras.odds ?? -110,
      edge: extras.edge ?? 0.05,
      qualityScore: extras.qualityScore ?? 44,
      ...extras,
    }
  }

  test('auto-saved Under does not count as a Published opposite blocker', () => {
    const autoSaved = {
      ...boeser('under'),
      gameIdRef: 'VAN_at_NYR_2026-11-02',
      propType: 'player_shots_on_goal',
      prediction: 'under',
      source: 'system_generated',
      notes: 'tier:elite,auto-saved',
    }
    const publishedOver = boeser('over', { notes: PUBLISHED_COHORT_TAG })
    expect(isPublishedOppositeBlocker(autoSaved)).toBe(false)
    expect(isPublishedOppositeBlocker({
      ...autoSaved,
      notes: SHADOW_PUBLISHED_COHORT_TAG,
    })).toBe(false)
    expect(isPublishedOppositeBlocker(publishedOver)).toBe(true)
    expect(hasOppositePublishedBlocker(publishedOver, [autoSaved])).toBe(false)
    expect(hasOppositePublishedBlocker(boeser('under'), [publishedOver])).toBe(true)
  })

  test('selectAutoSaveValidationProps drops a tier Under when Published Over is upcoming', () => {
    const publishedOver = boeser('over', { notes: PUBLISHED_COHORT_TAG, probability: 0.52 })
    const tierUnder = boeser('under', {
      edge: 0.12,
      qualityScore: 48,
      probability: 0.62,
      odds: -250,
      notes: 'tier:elite,auto-saved',
    })
    const kept = selectAutoSaveValidationProps([tierUnder], [publishedOver])
    expect(kept).toEqual([])
  })

  test('eligible prefetch orders by qualityScore then propId and paginates past 200', async () => {
    const calls = []
    const chain = {
      select(...args) { calls.push(['select', args]); return chain },
      eq(...args) { calls.push(['eq', args]); return chain },
      gte(...args) { calls.push(['gte', args]); return chain },
      gt(...args) { calls.push(['gt', args]); return chain },
      order(...args) { calls.push(['order', args]); return chain },
      limit(...args) { calls.push(['limit', args]); return chain },
    }
    const client = { from(table) { calls.push(['from', [table]]); return chain } }

    publishedEligibleAutoSaveCacheQuery(client, {
      sport: 'nhl',
      now: '2026-11-03T15:00:00.000Z',
    })
    expect(calls.filter((call) => call[0] === 'order')).toEqual([
      ['order', ['qualityScore', { ascending: false }]],
      ['order', ['propId', { ascending: true }]],
    ])
    expect(calls.some((call) => call[0] === 'limit')).toBe(false)

    const pageOne = Array.from({ length: 200 }, (_, i) => boeser('over', {
      playerName: `PageOne ${i}`,
      propId: `p1-${String(i).padStart(3, '0')}`,
      qualityScore: 50,
    }))
    const latePublishedOver = boeser('over', {
      propId: 'p2-boeser-over',
      qualityScore: 41,
      notes: PUBLISHED_COHORT_TAG,
    })
    const { rows } = await loadPublishedEligibleForAutoSave(client, {
      sport: 'nhl',
      now: '2026-11-03T15:00:00.000Z',
      paginate: async () => ({ rows: [...pageOne, latePublishedOver], error: null }),
    })
    expect(rows).toHaveLength(201)
    expect(rows[200].propId).toBe('p2-boeser-over')

    const tierUnder = boeser('under', {
      edge: 0.12,
      qualityScore: 48,
      probability: 0.62,
      odds: -250,
      notes: 'tier:elite,auto-saved',
    })
    expect(selectAutoSaveValidationProps([tierUnder], rows)).toEqual([])
  })

  test('prefetch error fails closed: empty rows plus skip auto-save', async () => {
    const logs = []
    const result = await loadPublishedEligibleForAutoSave({}, {
      sport: 'nhl',
      paginate: async () => ({
        rows: [boeser('over', { propId: 'should-not-use' })],
        error: { message: 'timeout' },
      }),
      log: (msg) => logs.push(msg),
    })
    expect(result.rows).toEqual([])
    expect(result.error).toEqual({ message: 'timeout' })
    expect(skipAutoSaveAfterPublishedPrefetchError(result.error, 'nhl', (msg) => logs.push(msg))).toBe(true)
    expect(skipAutoSaveAfterPublishedPrefetchError(null, 'nhl', (msg) => logs.push(msg))).toBe(false)
    expect(logs.join('\n')).toMatch(/Skipping auto-save for NHL/)
    expect(logs.join('\n')).toMatch(/timeout/)
  })

  test('prefetch cap fails closed: empty rows plus skip auto-save', async () => {
    const logs = []
    const paginateOpts = []
    const row = boeser('over', { propId: 'p-over' })
    const result = await loadPublishedEligibleForAutoSave({}, {
      sport: 'nfl',
      paginate: async (_makeQuery, opts) => {
        paginateOpts.push(opts)
        return { rows: [row], error: null, capped: true }
      },
      log: (msg) => logs.push(msg),
    })
    expect(AUTO_SAVE_PUBLISHED_PREFETCH_MAX_PAGES).toBe(20)
    expect(paginateOpts[0].maxPages).toBe(20)
    expect(result.capped).toBe(true)
    expect(result.rows).toEqual([])
    expect(result.error).toMatchObject({ message: expect.stringMatching(/20-page cap/) })
    expect(skipAutoSaveAfterPublishedPrefetchError(result.error, 'nfl', (msg) => logs.push(msg))).toBe(true)
    expect(logs.join('\n')).toMatch(/NFL/)
    expect(logs.join('\n')).toMatch(/20-page cap/)
    expect(logs.join('\n')).toMatch(/Skipping auto-save for NFL/)
  })

  test('paginateSupabaseSelect reports capped only when a row remains past maxPages', async () => {
    const ranges = []
    const result = await paginateSupabaseSelect(() => ({
      range: async (from, to) => {
        ranges.push([from, to])
        return { data: [{ id: from }, { id: `${from}b` }], error: null }
      },
    }), { pageSize: 2, maxPages: 3 })
    expect(ranges).toEqual([[0, 1], [2, 3], [4, 5], [6, 6]])
    expect(result.rows).toHaveLength(6)
    expect(result.capped).toBe(true)
    expect(result.error).toBeNull()
  })

  test('paginateSupabaseSelect does not report capped when the last allowed page is exact', async () => {
    const ranges = []
    const result = await paginateSupabaseSelect(() => ({
      range: async (from, to) => {
        ranges.push([from, to])
        if (from >= 6) return { data: [], error: null }
        return { data: [{ id: from }, { id: from + 1 }], error: null }
      },
    }), { pageSize: 2, maxPages: 3 })
    expect(ranges).toEqual([[0, 1], [2, 3], [4, 5], [6, 6]])
    expect(result.rows).toEqual([
      { id: 0 }, { id: 1 },
      { id: 2 }, { id: 3 },
      { id: 4 }, { id: 5 },
    ])
    expect(result.capped).toBe(false)
    expect(result.error).toBeNull()
  })

  test('paginateSupabaseSelect skips the extra-row probe when a page is short', async () => {
    const ranges = []
    const result = await paginateSupabaseSelect(() => ({
      range: async (from, to) => {
        ranges.push([from, to])
        if (from === 2) return { data: [{ id: 2 }], error: null }
        return { data: [{ id: from }, { id: from + 1 }], error: null }
      },
    }), { pageSize: 2, maxPages: 3 })
    expect(ranges).toEqual([[0, 1], [2, 3]])
    expect(result.rows).toHaveLength(3)
    expect(result.capped).toBe(false)
  })
})
