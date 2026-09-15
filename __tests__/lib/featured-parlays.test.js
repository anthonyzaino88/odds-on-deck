jest.mock('../../lib/supabase-admin.js', () => ({
  supabaseAdmin: {},
}))

import {
  FEATURED_COHORT_TAG,
  aggregateFeaturedParlayOutcome,
  featuredLegGradePatch,
  featuredParlayGradePatch,
  featuredPersistClaim,
  featuredPersistWritePlan,
  attachFeaturedHistoryLegDisplay,
  featuredRegradeParlayPatch,
  featuredRowToDisplayParlay,
  featuredSnapshotKey,
  featuredSnapshotWinner,
  filterFeaturedCohortRows,
  gradeFeaturedParlayFromValidations,
  gradePropLegFromActual,
  gradePropLegFromValidation,
  isFeaturedClearedParlay,
  isFeaturedCohortRow,
  isNumericFeaturedActual,
  isUsablePropValidation,
  planFeaturedDuplicateCleanup,
  resolveFeaturedHistoryLegOutcome,
  summarizeFeaturedParlays,
  toFeaturedParlayRow,
  dedupeFeaturedCohortRows,
  dedupeFeaturedPageCards,
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
      findSnapshots: async () => [],
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
      findSnapshots: async () => { calls.find += 1; return [] },
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
      findSnapshots: async () => [existing],
      insertParlay: async () => { throw new Error('should not insert') },
      insertLegs: async () => { throw new Error('should not insert legs') },
    })
    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('already_snapped')
    expect(result.parlay.id).toBe('snap-1')
  })

  test('retracts a later insert when another row already won the slot', async () => {
    const sgp = featuredParlay({
      sport: 'mlb',
      type: 'single_game',
      legs: [
        publishedLeg('Ernie Clement', { gameId: 'tor-1', sport: 'mlb', propType: 'batter_hits', type: 'batter_hits', threshold: 0.5 }),
        publishedLeg('Vladimir Guerrero Jr.', { gameId: 'tor-1', sport: 'mlb', propType: 'batter_total_bases', type: 'batter_total_bases', threshold: 1.5 }),
        publishedLeg('Nathan Lukes', { gameId: 'tor-1', sport: 'mlb', propType: 'batter_hits', type: 'batter_hits', threshold: 1.5 }),
      ],
    })
    const winner = {
      id: '05ca0083de8e42fe',
      createdAt: '2026-09-15T14:50:41.123Z',
      notes: `${FEATURED_COHORT_TAG} snapshot:featured:mlb:sgp:2026-09-15`,
      status: 'pending',
    }
    let inserted = null
    const deleted = []
    const result = await persistCard(sgp, {
      now: new Date('2026-09-15T14:50:42.673Z'),
      findSnapshots: async () => (inserted ? [winner, inserted] : []),
      insertParlay: async (row) => {
        inserted = row
        return row
      },
      insertLegs: async (legs) => legs,
      deleteParlay: async (id) => { deleted.push(id) },
    })
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('already_snapped')
    expect(result.parlay.id).toBe(winner.id)
    expect(deleted).toContain(inserted.id)
  })

  test('winner of a race retracts the other pending copy', async () => {
    const sgp = featuredParlay({
      sport: 'mlb',
      type: 'single_game',
      legs: [
        publishedLeg('Ernie Clement', { gameId: 'tor-1', sport: 'mlb', propType: 'batter_hits', type: 'batter_hits', threshold: 0.5 }),
        publishedLeg('Vladimir Guerrero Jr.', { gameId: 'tor-1', sport: 'mlb', propType: 'batter_total_bases', type: 'batter_total_bases', threshold: 1.5 }),
        publishedLeg('Nathan Lukes', { gameId: 'tor-1', sport: 'mlb', propType: 'batter_hits', type: 'batter_hits', threshold: 1.5 }),
      ],
    })
    const later = {
      id: '82fb29664d654a6e',
      createdAt: '2026-09-15T14:50:42.673Z',
      notes: `${FEATURED_COHORT_TAG} snapshot:featured:mlb:sgp:2026-09-15`,
      status: 'pending',
    }
    let inserted = null
    const deleted = []
    const now = new Date('2026-09-15T14:50:41.123Z')
    const result = await persistCard(sgp, {
      now,
      findSnapshots: async () => (inserted ? [inserted, later] : []),
      insertParlay: async (row) => {
        inserted = row
        return row
      },
      insertLegs: async (legs) => legs,
      deleteParlay: async (id) => { deleted.push(id) },
    })
    expect(result.reason).toBe('inserted')
    expect(result.parlay.id).toBe(inserted.id)
    expect(deleted).toEqual([later.id])
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

  test('pending PropValidation keeps the parlay pending and does not assume 0', () => {
    const validations = legs.map((leg) => ({
      playerName: leg.playerName,
      propType: leg.propType,
      threshold: leg.threshold,
      status: 'pending',
      result: null,
      actualValue: null,
      gameIdRef: leg.gameIdRef,
    }))
    const grade = gradeFeaturedParlayFromValidations(legs, validations)
    expect(grade.parlayOutcome).toBe('pending')
    expect(grade.legOutcomes.every((row) => row.outcome == null)).toBe(true)
    expect(grade.legOutcomes.every((row) => row.actualValue == null)).toBe(true)
    expect(grade.legOutcomes.some((row) => row.actualValue === 0)).toBe(false)
    expect(featuredParlayGradePatch(grade)).toBeNull()
    expect(grade.legOutcomes.every((row) => featuredLegGradePatch(row) == null)).toBe(true)
    expect(isUsablePropValidation(validations[0])).toBe(false)
    expect(gradePropLegFromValidation(legs[0], validations[0])).toBeNull()
  })

  test('needs_review or pending-with-leftover-number is still not actual 0', () => {
    expect(gradePropLegFromValidation(legs[0], {
      status: 'needs_review',
      actualValue: null,
      result: null,
    })).toBeNull()
    expect(isUsablePropValidation({ status: 'needs_review', actualValue: 0 })).toBe(false)

    const leftover = {
      playerName: legs[0].playerName,
      propType: legs[0].propType,
      status: 'pending',
      actualValue: 0,
      result: null,
      gameIdRef: legs[0].gameIdRef,
    }
    const grade = gradeFeaturedParlayFromValidations([legs[0]], [leftover])
    expect(grade.parlayOutcome).toBe('pending')
    expect(grade.legOutcomes[0].outcome).toBeNull()
    expect(grade.legOutcomes[0].actualValue).toBeNull()
    expect(featuredLegGradePatch(grade.legOutcomes[0])).toBeNull()
  })

  test('completed numeric actual grades over/under vs threshold', () => {
    expect(gradePropLegFromActual({ threshold: 3.5, selection: 'over' }, 4)).toBe('won')
    expect(gradePropLegFromActual({ threshold: 3.5, selection: 'over' }, 3)).toBe('lost')
    expect(gradePropLegFromActual({ threshold: 1.5, selection: 'under' }, 0)).toBe('won')
    expect(gradePropLegFromActual({ threshold: 1.5, selection: 'under' }, 2)).toBe('lost')
    expect(gradePropLegFromActual({ threshold: 3.5, selection: 'over' }, 3.5)).toBe('push')

    const schultz = { playerName: 'Dalton Schultz', propType: 'player_receptions', selection: 'over', threshold: 3.5, parlayId: 'ed1be445a5284504' }
    const murray = { playerName: 'Kyler Murray', propType: 'player_pass_tds', selection: 'under', threshold: 1.5, parlayId: 'ed1be445a5284504' }
    const goff = { playerName: 'Jared Goff', propType: 'player_pass_tds', selection: 'over', threshold: 1.5, parlayId: 'ed1be445a5284504' }
    const sundayLegs = [schultz, murray, goff]
    const sundayActuals = [
      { playerName: 'Dalton Schultz', propType: 'player_receptions', status: 'completed', actualValue: 4, result: 'correct' },
      { playerName: 'Kyler Murray', propType: 'player_pass_tds', status: 'completed', actualValue: 0, result: 'correct' },
      { playerName: 'Jared Goff', propType: 'player_pass_tds', status: 'completed', actualValue: 2, result: 'correct' },
    ]
    const hit = gradeFeaturedParlayFromValidations(sundayLegs, sundayActuals)
    expect(hit.parlayOutcome).toBe('won')
    expect(hit.legOutcomes.map((row) => row.outcome)).toEqual(['won', 'won', 'won'])
    expect(hit.legOutcomes.map((row) => row.actualValue)).toEqual([4, 0, 2])

    const pendingSunday = gradeFeaturedParlayFromValidations(sundayLegs, sundayLegs.map((leg) => ({
      playerName: leg.playerName,
      propType: leg.propType,
      status: 'pending',
      actualValue: null,
    })))
    expect(pendingSunday.parlayOutcome).toBe('pending')
    expect(pendingSunday.legOutcomes.every((row) => row.actualValue == null)).toBe(true)

    expect(gradePropLegFromActual({ threshold: 3.5, selection: 'over' }, 3)).toBe('lost') // Cade Otton
    expect(gradePropLegFromActual({ threshold: 3.5, selection: 'over' }, 5)).toBe('won') // Chase Brown
    expect(gradePropLegFromActual({ threshold: 1.5, selection: 'under' }, 2)).toBe('lost') // Iosivas
  })

  test('numeric actual beats a stale result on the same PropValidation row', () => {
    const grade = gradeFeaturedParlayFromValidations(legs, [{
      playerName: legs[0].playerName,
      propType: legs[0].propType,
      status: 'completed',
      result: 'incorrect',
      actualValue: Number(legs[0].threshold) + 5,
      gameIdRef: legs[0].gameIdRef,
    }])
    expect(grade.legOutcomes[0].outcome).toBe('won')
    expect(grade.parlayOutcome).toBe('pending')
  })

  test('regrade patch resets a false settle when props are still pending', () => {
    const pendingGrade = {
      parlayOutcome: 'pending',
      legOutcomes: [],
    }
    expect(featuredRegradeParlayPatch(pendingGrade, 'lost').status).toBe('pending')
    expect(featuredRegradeParlayPatch(pendingGrade, 'pending')).toBeNull()
    const wonGrade = gradeFeaturedParlayFromValidations(legs, legs.map((leg) => ({
      playerName: leg.playerName,
      propType: leg.propType,
      status: 'completed',
      actualValue: Number(leg.threshold) + 1,
      result: 'correct',
    })))
    expect(featuredRegradeParlayPatch(wonGrade, 'lost').status).toBe('won')
  })
})

describe('Featured history leg display', () => {
  test('0 is a real actual — null / empty are missing', () => {
    expect(isNumericFeaturedActual(0)).toBe(true)
    expect(isNumericFeaturedActual('0')).toBe(true)
    expect(isNumericFeaturedActual(null)).toBe(false)
    expect(isNumericFeaturedActual(undefined)).toBe(false)
    expect(isNumericFeaturedActual('')).toBe(false)
  })

  test('OVER below the line is a miss even when validationResult is stale correct', () => {
    // Live: Otton o3.5 rec actual 3 — card LOST, dots were green
    expect(resolveFeaturedHistoryLegOutcome({
      playerName: 'Cade Otton',
      selection: 'over',
      threshold: 3.5,
      actualValue: 3,
      validationResult: 'correct',
      outcome: 'lost',
    }, 'lost')).toBe('lost')

    // Live: Pasquantino / Sogard o1.5 TB actual 0
    expect(resolveFeaturedHistoryLegOutcome({
      playerName: 'Vinnie Pasquantino',
      selection: 'over',
      threshold: 1.5,
      actualValue: 0,
      validationResult: 'correct',
      outcome: 'lost',
    }, 'lost')).toBe('lost')

    expect(resolveFeaturedHistoryLegOutcome({
      playerName: 'Nick Sogard',
      selection: 'over',
      threshold: 1.5,
      actualValue: 0,
      validationResult: 'correct',
    }, 'lost')).toBe('lost')
  })

  test('regraded ParlayLeg.outcome wins over a disagreeing PropValidation join', () => {
    // Otton: PV correct + actual 2 vs leg lost / Actual 3
    expect(resolveFeaturedHistoryLegOutcome({
      playerName: 'Cade Otton',
      selection: 'over',
      threshold: 3.5,
      actualValue: 2,
      actualResult: 'Actual: 3',
      validationResult: 'correct',
      outcome: 'lost',
    }, 'lost')).toBe('lost')

    // Goff: PV incorrect on a cashed o1.5
    expect(resolveFeaturedHistoryLegOutcome({
      playerName: 'Jared Goff',
      selection: 'over',
      threshold: 1.5,
      actualValue: 1,
      actualResult: 'Actual: 2',
      validationResult: 'incorrect',
      outcome: 'won',
    }, 'won')).toBe('won')
  })

  test('UNDER above the line is a miss; push and void stay honest', () => {
    expect(resolveFeaturedHistoryLegOutcome({
      selection: 'under',
      threshold: 1.5,
      actualValue: 2,
      validationResult: 'correct',
    }, 'lost')).toBe('lost')

    expect(resolveFeaturedHistoryLegOutcome({
      selection: 'over',
      threshold: 3.5,
      actualValue: 3.5,
      validationResult: 'incorrect',
    })).toBe('push')

    expect(resolveFeaturedHistoryLegOutcome({
      selection: 'over',
      threshold: 3.5,
      validationResult: 'void',
    })).toBe('push')
  })

  test('Schultz / Murray / Goff hits stay green and match a WON card', () => {
    expect(resolveFeaturedHistoryLegOutcome({
      playerName: 'Dalton Schultz',
      selection: 'over',
      threshold: 3.5,
      actualValue: 4,
    }, 'won')).toBe('won')
    expect(resolveFeaturedHistoryLegOutcome({
      playerName: 'Kyler Murray',
      selection: 'under',
      threshold: 1.5,
      actualValue: 0,
    }, 'won')).toBe('won')
    expect(resolveFeaturedHistoryLegOutcome({
      playerName: 'Jared Goff',
      selection: 'over',
      threshold: 1.5,
      actualValue: 2,
    }, 'won')).toBe('won')
  })

  test('missing actual does not invent 0; stored outcome still wins', () => {
    expect(resolveFeaturedHistoryLegOutcome({
      selection: 'over',
      threshold: 3.5,
      actualValue: null,
      outcome: 'pending',
    }, 'pending')).toBeNull()

    expect(resolveFeaturedHistoryLegOutcome({
      selection: 'over',
      threshold: 3.5,
      actualResult: 'Actual: 0',
      validationResult: 'correct',
    }, 'lost')).toBe('lost')

    expect(resolveFeaturedHistoryLegOutcome({
      selection: 'over',
      threshold: 3.5,
      outcome: 'lost',
      validationResult: 'correct',
    }, 'lost')).toBe('lost')
  })

  test('history attach follows ParlayLeg.outcome and stored Actual, not the PV join', () => {
    const otton = attachFeaturedHistoryLegDisplay({
      playerName: 'Cade Otton',
      propType: 'player_receptions',
      selection: 'over',
      threshold: 3.5,
      parlayId: 'feat-otton',
      gameIdRef: 'tb-game',
      outcome: 'lost',
      actualResult: 'Actual: 3',
    }, [{
      playerName: 'Cade Otton',
      propType: 'player_receptions',
      status: 'completed',
      result: 'correct',
      actualValue: 2,
      parlayId: 'other-card',
    }])
    expect(otton.actualValue).toBe(3)
    expect(otton.displayOutcome).toBe('lost')
    expect(otton.validationResult).toBe('incorrect')

    const goff = attachFeaturedHistoryLegDisplay({
      playerName: 'Jared Goff',
      propType: 'player_pass_tds',
      selection: 'over',
      threshold: 1.5,
      outcome: 'won',
      actualResult: 'Actual: 2',
    }, [{
      playerName: 'Jared Goff',
      propType: 'player_pass_tds',
      status: 'completed',
      result: 'incorrect',
      actualValue: 1,
    }])
    expect(goff.actualValue).toBe(2)
    expect(goff.displayOutcome).toBe('won')
    expect(goff.validationResult).toBe('correct')

    const pasquantino = attachFeaturedHistoryLegDisplay({
      playerName: 'Vinnie Pasquantino',
      propType: 'batter_total_bases',
      selection: 'over',
      threshold: 1.5,
      outcome: 'lost',
      actualResult: 'Actual: 0',
    }, [{
      playerName: 'Vinnie Pasquantino',
      propType: 'batter_total_bases',
      status: 'completed',
      result: 'correct',
      actualValue: 0,
    }])
    expect(pasquantino.actualValue).toBe(0)
    expect(pasquantino.displayOutcome).toBe('lost')
    expect(pasquantino.validationResult).toBe('incorrect')
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

  test('duplicate snapshot-key rows count once for ROI and history', () => {
    const first = {
      id: '05ca0083de8e42fe',
      notes: `${FEATURED_COHORT_TAG} snapshot:featured:mlb:sgp:2026-09-15`,
      outcome: 'lost',
      status: 'lost',
      createdAt: '2026-09-15T14:50:41.123Z',
      edge: 0.1,
      expectedValue: 0.2,
      totalOdds: 24.05135,
    }
    const copy = {
      ...first,
      id: '82fb29664d654a6e',
      createdAt: '2026-09-15T14:50:42.673Z',
    }
    const unique = {
      id: 'afbdf49c1128438c',
      notes: `${FEATURED_COHORT_TAG} snapshot:featured:mlb:multi:2026-09-15`,
      outcome: 'pending',
      status: 'pending',
      createdAt: '2026-09-15T14:51:00.000Z',
      edge: 0.1,
      expectedValue: 0.2,
      totalOdds: 8,
    }
    expect(dedupeFeaturedCohortRows([copy, first, unique]).map((row) => row.id)).toEqual([
      first.id,
      unique.id,
    ])
    const summary = summarizeFeaturedParlays([first, copy, unique])
    expect(summary.totalParlays).toBe(2)
    expect(summary.lostParlays).toBe(1)
    expect(summary.pendingParlays).toBe(1)
  })

  test('page cards drop a multi request that is the same SGP legs', () => {
    const sgp = featuredParlay({ sport: 'mlb', type: 'single_game' })
    const cards = dedupeFeaturedPageCards([
      { sport: 'mlb', type: 'multi', parlay: { ...sgp, notes: `${FEATURED_COHORT_TAG} snapshot:featured:mlb:sgp:2026-09-15` } },
      { sport: 'mlb', type: 'sgp', parlay: { ...sgp, notes: `${FEATURED_COHORT_TAG} snapshot:featured:mlb:sgp:2026-09-15` } },
    ])
    expect(cards).toHaveLength(1)
    expect(cards[0].type).toBe('sgp')
  })

  test('snapshot claim keeps the earliest createdAt row', () => {
    const first = { id: 'a', createdAt: '2026-09-15T14:50:41.123Z', status: 'pending' }
    const second = { id: 'b', createdAt: '2026-09-15T14:50:42.673Z', status: 'pending' }
    expect(featuredSnapshotWinner([second, first]).id).toBe('a')
    const lost = featuredPersistClaim('b', [first, second])
    expect(lost.keepInserted).toBe(false)
    expect(lost.retract.map((row) => row.id)).toEqual(['b'])
    expect(planFeaturedDuplicateCleanup([
      { ...first, notes: `${FEATURED_COHORT_TAG} snapshot:featured:mlb:sgp:2026-09-15` },
      { ...second, notes: `${FEATURED_COHORT_TAG} snapshot:featured:mlb:sgp:2026-09-15` },
    ]).retract.map((row) => row.row.id)).toEqual(['b'])
  })

  test('display hydrate maps gameIdRef and keeps stored decimal totalOdds', () => {
    const card = featuredRowToDisplayParlay({
      id: '05ca',
      totalOdds: 24.05135,
      notes: `${FEATURED_COHORT_TAG} snapshot:featured:mlb:sgp:2026-09-15`,
      type: 'single_game',
      legs: [
        { gameIdRef: 'tor-game', playerName: 'Ernie Clement', selection: 'over', threshold: 1.5, odds: -110, legOrder: 2 },
        { gameIdRef: 'tor-game', playerName: 'Vladimir Guerrero Jr.', selection: 'over', threshold: 1.5, odds: 1.91, legOrder: 1 },
      ],
    })
    expect(card.snapshotKey).toBe('featured:mlb:sgp:2026-09-15')
    expect(card.totalOdds).toBeCloseTo(24.05135)
    expect(card.legs[0].playerName).toBe('Vladimir Guerrero Jr.')
    expect(card.legs[0].gameId).toBe('tor-game')
    expect(card.legs[1].gameId).toBe('tor-game')
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
