jest.mock('../../lib/supabase-admin.js', () => ({
  supabaseAdmin: {},
}))

import {
  FEATURED_COHORT_TAG,
  aggregateFeaturedParlayOutcome,
  featuredParlayGradePatch,
  featuredPersistWritePlan,
  featuredSnapshotKey,
  filterFeaturedCohortRows,
  gradeFeaturedParlayFromValidations,
  gradePropLegFromActual,
  isFeaturedClearedParlay,
  isFeaturedCohortRow,
  summarizeFeaturedParlays,
  toFeaturedParlayRow,
} from '../../lib/featured-parlays.js'
import { persistFeaturedClearedParlay as persistCard } from '../../lib/featured-parlay-persist.js'

const FUTURE = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()

function publishedLeg(name, overrides = {}) {
  return {
    gameId: overrides.gameId || `g-${name.replace(/\s+/g, '-')}`,
    betType: 'prop',
    selection: overrides.selection || 'over',
    pick: overrides.pick || overrides.selection || 'over',
    odds: overrides.odds ?? 1.91,
    probability: overrides.probability ?? 1 / 1.91,
    edge: overrides.edge ?? 0.04,
    confidence: 'medium',
    qualityScore: overrides.qualityScore ?? 45,
    playerName: name,
    propType: overrides.propType || 'player_pass_yds',
    type: overrides.propType || 'player_pass_yds',
    threshold: overrides.threshold ?? 199.5,
    sport: overrides.sport || 'nfl',
    gameTime: overrides.gameTime || FUTURE,
    ...overrides,
  }
}

function featuredParlay(overrides = {}) {
  const legs = overrides.legs || [
    publishedLeg('Geno Smith', { gameId: 'sea-ten-1' }),
    publishedLeg('Cam Ward', { gameId: 'sea-ten-2' }),
    publishedLeg('Tony Pollard', {
      gameId: 'sea-ten-3',
      propType: 'player_rush_yds',
      type: 'player_rush_yds',
      threshold: 64.5,
    }),
  ]
  return {
    sport: 'nfl',
    type: 'multi_game',
    totalOdds: 6.97,
    probability: 0.14,
    edge: 0.12,
    expectedValue: 0.08,
    confidence: 'medium',
    ...overrides,
    legs,
  }
}

describe('Featured-cleared persist gate', () => {
  test('happy path: 3 Published-eligible props become a Featured row', () => {
    const parlay = featuredParlay()
    expect(isFeaturedClearedParlay(parlay)).toBe(true)
    const row = toFeaturedParlayRow(parlay)
    expect(row).toMatchObject({
      sport: 'nfl',
      type: 'multi_game',
      legCount: 3,
      status: 'pending',
      outcome: 'pending',
    })
    expect(row.notes).toContain(FEATURED_COHORT_TAG)
    expect(row.notes).toContain('snapshot:featured:nfl:multi:')
    expect(featuredSnapshotKey(parlay)).toMatch(/^featured:nfl:multi:\d{4}-\d{2}-\d{2}$/)
  })

  test('rejects 2-leg, juice, game lines, NHL, and edge-0 from the tracked cohort', () => {
    const keep = featuredParlay()
    expect(toFeaturedParlayRow({
      ...keep,
      legs: keep.legs.slice(0, 2),
    })).toBeNull()

    expect(toFeaturedParlayRow(featuredParlay({
      legs: [
        publishedLeg('Geno Smith', { edge: 0 }),
        publishedLeg('Cam Ward'),
        publishedLeg('Tony Pollard', { gameId: 'g-3' }),
      ],
    }))).toBeNull()

    expect(toFeaturedParlayRow(featuredParlay({
      legs: [
        publishedLeg('Juice Trap', { pick: 'under', selection: 'under', threshold: 0.5, propType: 'player_pass_tds' }),
        publishedLeg('Cam Ward'),
        publishedLeg('Tony Pollard', { gameId: 'g-3' }),
      ],
    }))).toBeNull()

    expect(toFeaturedParlayRow(featuredParlay({
      legs: [
        { ...publishedLeg('NYY ML'), betType: 'moneyline', type: 'moneyline', propType: 'moneyline', playerName: null, selection: 'NYY' },
        publishedLeg('Cam Ward'),
        publishedLeg('Tony Pollard', { gameId: 'g-3' }),
      ],
    }))).toBeNull()

    expect(toFeaturedParlayRow(featuredParlay({
      sport: 'nhl',
      legs: [
        publishedLeg('Auston Matthews', { sport: 'nhl', propType: 'player_points' }),
        publishedLeg('Jack Hughes', { sport: 'nhl', gameId: 'g-2', propType: 'player_points' }),
        publishedLeg('Connor McDavid', { sport: 'nhl', gameId: 'g-3', propType: 'player_points' }),
      ],
    }))).toBeNull()
  })

  test('first snapshot write wins — existing slot is skip, not update', () => {
    expect(featuredPersistWritePlan(null)).toBe('insert')
    expect(featuredPersistWritePlan({ id: 'already', notes: `${FEATURED_COHORT_TAG} snapshot:featured:nfl:multi:2026-09-10` })).toBe('skip')
  })
})

describe('persistFeaturedClearedParlay', () => {
  test('inserts a Featured-cleared card and records the cohort tag', async () => {
    const inserted = []
    const result = await persistCard(featuredParlay(), {
      findSnapshot: async () => null,
      insertParlay: async (row) => {
        inserted.push(row)
        return row
      },
      insertLegs: async (legs) => legs,
    })
    expect(result.ok).toBe(true)
    expect(result.rejected).toBe(false)
    expect(result.reason).toBe('inserted')
    expect(inserted[0].notes).toContain(FEATURED_COHORT_TAG)
    expect(inserted[0].legCount).toBe(3)
    expect(result.legs).toHaveLength(3)
  })

  test('rejects a non-eligible Builder card without writing', async () => {
    const calls = { find: 0, insert: 0 }
    const result = await persistCard({
      ...featuredParlay(),
      legs: featuredParlay().legs.slice(0, 2),
    }, {
      findSnapshot: async () => { calls.find += 1; return null },
      insertParlay: async (row) => { calls.insert += 1; return row },
      insertLegs: async (legs) => legs,
    })
    expect(result.ok).toBe(false)
    expect(result.rejected).toBe(true)
    expect(result.reason).toBe('not_featured_cleared')
    expect(calls.find).toBe(0)
    expect(calls.insert).toBe(0)
  })

  test('skips when the slate slot is already snapped', async () => {
    const existing = { id: 'snap-1', notes: `${FEATURED_COHORT_TAG} snapshot:featured:nfl:multi:2026-09-10` }
    const result = await persistCard(featuredParlay(), {
      findSnapshot: async () => existing,
      insertParlay: async () => { throw new Error('should not insert') },
      insertLegs: async () => { throw new Error('should not insert legs') },
    })
    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('already_snapped')
    expect(result.parlay.id).toBe('snap-1')
  })
})

describe('Featured grading', () => {
  const legs = featuredParlay().legs.map((leg, index) => ({
    ...leg,
    id: `leg-${index + 1}`,
    parlayId: 'feat-1',
    gameIdRef: leg.gameId,
    legOrder: index + 1,
  }))

  test('settled Featured parlay wins when every Published prop hits', () => {
    const validations = legs.map((leg) => ({
      playerName: leg.playerName,
      propType: leg.propType,
      threshold: leg.threshold,
      status: 'completed',
      result: 'correct',
      actualValue: Number(leg.threshold) + 1,
      gameIdRef: leg.gameIdRef,
      parlayId: 'feat-1',
    }))
    const grade = gradeFeaturedParlayFromValidations(legs, validations)
    expect(grade.parlayOutcome).toBe('won')
    expect(grade.legOutcomes.every((row) => row.outcome === 'won')).toBe(true)
    expect(featuredParlayGradePatch(grade).status).toBe('won')
    expect(featuredParlayGradePatch(grade).actualResult).toMatch(/All 3 legs won/)
  })

  test('one settled loss grades the parlay lost without waiting on other legs', () => {
    const validations = [{
      playerName: legs[0].playerName,
      propType: legs[0].propType,
      status: 'completed',
      result: 'incorrect',
      actualValue: 10,
      gameIdRef: legs[0].gameIdRef,
    }]
    const grade = gradeFeaturedParlayFromValidations(legs, validations)
    expect(grade.parlayOutcome).toBe('lost')
    expect(featuredParlayGradePatch(grade).status).toBe('lost')
  })

  test('grades a push from actualValue vs threshold when result is missing', () => {
    expect(gradePropLegFromActual(legs[0], legs[0].threshold)).toBe('push')
    expect(gradePropLegFromActual({ ...legs[0], selection: 'over' }, legs[0].threshold + 5)).toBe('won')
    expect(gradePropLegFromActual({ ...legs[0], selection: 'under' }, legs[0].threshold + 5)).toBe('lost')

    const validations = legs.map((leg) => ({
      playerName: leg.playerName,
      propType: leg.propType,
      status: 'completed',
      result: null,
      actualValue: leg.threshold,
      gameIdRef: leg.gameIdRef,
    }))
    expect(gradeFeaturedParlayFromValidations(legs, validations).parlayOutcome).toBe('push')
  })

  test('stays pending when legs have not settled', () => {
    expect(gradeFeaturedParlayFromValidations(legs, []).parlayOutcome).toBe('pending')
    expect(featuredParlayGradePatch({
      parlayOutcome: 'pending',
      legOutcomes: [],
    })).toBeNull()
    expect(aggregateFeaturedParlayOutcome(['won', null, 'won'])).toBe('pending')
  })
})

describe('Featured history cohort', () => {
  test('untagged Builder rows never enter the tracked summary', () => {
    const featured = {
      id: 'f1',
      notes: `${FEATURED_COHORT_TAG} snapshot:featured:nfl:multi:2026-09-10`,
      outcome: 'won',
      status: 'won',
      edge: 0.1,
      expectedValue: 0.2,
      totalOdds: 6.97,
    }
    const builderJunk = {
      id: 'b1',
      notes: 'User saved parlay with 4 legs',
      outcome: 'won',
      status: 'won',
      edge: 0.9,
      expectedValue: 2,
      totalOdds: 20,
    }
    expect(isFeaturedCohortRow(builderJunk)).toBe(false)
    expect(filterFeaturedCohortRows([featured, builderJunk])).toEqual([featured])
    const summary = summarizeFeaturedParlays([featured, builderJunk])
    expect(summary.totalParlays).toBe(1)
    expect(summary.wonParlays).toBe(1)
    expect(summary.winRate).toBe(100)
  })

  test('honest empty when nothing Featured-cleared exists', () => {
    expect(summarizeFeaturedParlays([])).toMatchObject({
      totalParlays: 0,
      wonParlays: 0,
      lostParlays: 0,
      winRate: 0,
      roi: 0,
    })
    expect(summarizeFeaturedParlays([
      { notes: 'User saved parlay with 3 legs', outcome: 'won', status: 'won', totalOdds: 5 },
    ]).totalParlays).toBe(0)
  })
})
