import {
  aggregateParlayOutcomes,
  canGradeFromGame,
  classifyEspnCompetition,
  classifyGameForGrading,
  isEspnCompetitionGradeable,
  isImpossibleMlbFinal,
  parlayOddsForUnits,
  planStatLookupFromGame,
  settledParlayDecimalOdds,
  shouldVoidFromGame,
  voidPropValidationPatch,
} from '../../lib/game-grade-eligibility.js'
import { planGameLineSettlement, shouldGradeGameLine } from '../../lib/game-lines.js'
import { unitsFromResult } from '../../lib/odds-units.js'
import { planPlayerStatValidation } from '../../lib/pending-props.js'
import {
  applyUnplayedGradeRepairs,
  describeLegRepairWrite,
  describePropRepairWrite,
  parseUnplayedGradeArgs,
  planUnplayedGameGradeRepair,
  requireUnplayedGradeApplyKey,
} from '../../lib/unplayed-game-grades.js'
import {
  aggregateFeaturedParlayOutcome,
  gradeFeaturedParlayFromValidations,
  gradePropLegFromValidation,
  isUsablePropValidation,
  resolveFeaturedHistoryLegOutcome,
} from '../../lib/featured-parlays.js'

const BAL_NYY_RAINOUT = {
  id: 'BAL_at_NYY_2026-09-27',
  sport: 'mlb',
  status: 'cancelled',
  homeScore: 0,
  awayScore: 0,
  date: '2026-09-27T23:05:00.000Z',
  home: { abbr: 'NYY' },
  away: { abbr: 'BAL' },
}

function mlbGame(overrides = {}) {
  return {
    id: 'BOS_at_NYY_2026-09-26',
    sport: 'mlb',
    status: 'final',
    homeScore: 5,
    awayScore: 3,
    date: '2026-09-26T23:05:00.000Z',
    home: { abbr: 'NYY' },
    away: { abbr: 'BOS' },
    ...overrides,
  }
}

describe('classifyGameForGrading', () => {
  test('postponed 0-0 is held, never graded', () => {
    const game = mlbGame({ status: 'postponed', homeScore: 0, awayScore: 0 })
    expect(classifyGameForGrading(game)).toEqual({ action: 'hold', reason: 'postponed' })
    expect(canGradeFromGame(game)).toBe(false)
    expect(shouldVoidFromGame(game)).toBe(false)
    expect(shouldGradeGameLine(game)).toBe(false)
  })

  test('cancelled BAL@NYY rainout is void, not a 0-0 push', () => {
    expect(classifyGameForGrading(BAL_NYY_RAINOUT)).toEqual({ action: 'void', reason: 'cancelled' })
    expect(canGradeFromGame(BAL_NYY_RAINOUT)).toBe(false)
    expect(shouldVoidFromGame(BAL_NYY_RAINOUT)).toBe(true)
    expect(shouldGradeGameLine(BAL_NYY_RAINOUT)).toBe(false)
    expect(voidPropValidationPatch(new Date('2026-10-01T00:00:00Z'), BAL_NYY_RAINOUT)).toMatchObject({
      result: 'void',
      status: 'manual_closed',
      actualValue: null,
    })
  })

  test('suspended and delayed stay pending', () => {
    expect(classifyGameForGrading(mlbGame({ status: 'suspended', homeScore: 3, awayScore: 2 })).action).toBe('hold')
    expect(classifyGameForGrading(mlbGame({ status: 'delayed', homeScore: 0, awayScore: 0 })).action).toBe('hold')
  })

  test('in-progress is held even with scores', () => {
    const live = mlbGame({ status: 'in_progress', homeScore: 2, awayScore: 1 })
    expect(classifyGameForGrading(live)).toEqual({ action: 'hold', reason: 'in_progress' })
    expect(canGradeFromGame(live)).toBe(false)
    expect(shouldGradeGameLine(live)).toBe(false)
  })

  test('genuine MLB final still grades', () => {
    const final = mlbGame()
    expect(classifyGameForGrading(final)).toEqual({ action: 'grade', reason: 'final' })
    expect(canGradeFromGame(final)).toBe(true)
    expect(shouldGradeGameLine(final)).toBe(true)
  })

  test('MLB 0-0 marked final is held — not a possible result', () => {
    const fake = mlbGame({ status: 'final', homeScore: 0, awayScore: 0 })
    expect(isImpossibleMlbFinal(fake)).toBe(true)
    expect(classifyGameForGrading(fake)).toEqual({ action: 'hold', reason: 'mlb_unplayed_0_0' })
    expect(canGradeFromGame(fake)).toBe(false)
    expect(shouldGradeGameLine(fake)).toBe(false)
  })

  test('NHL / NFL 0-0 finals remain gradeable', () => {
    const nhl = { sport: 'nhl', status: 'final', homeScore: 0, awayScore: 0 }
    const nfl = { sport: 'nfl', status: 'final', homeScore: 0, awayScore: 0 }
    expect(canGradeFromGame(nhl)).toBe(true)
    expect(canGradeFromGame(nfl)).toBe(true)
    expect(shouldGradeGameLine(nhl)).toBe(true)
    expect(shouldGradeGameLine(nfl)).toBe(true)
    expect(canGradeFromGame({ ...nhl, status: 'postponed' })).toBe(false)
    expect(canGradeFromGame({ ...nfl, status: 'cancelled' })).toBe(false)
  })
})

describe('planStatLookupFromGame / player props', () => {
  const yesterday = new Date('2026-10-01T16:00:00.000Z')

  test('date-before-yesterday does not grade a postponed rainout', () => {
    const plan = planStatLookupFromGame({
      ...BAL_NYY_RAINOUT,
      status: 'postponed',
    }, { now: yesterday })
    expect(plan).toEqual({ action: 'hold', reason: 'postponed' })
  })

  test('cancelled rainout is voided instead of looking up actual=0', () => {
    expect(planStatLookupFromGame(BAL_NYY_RAINOUT, { now: yesterday })).toEqual({
      action: 'void',
      reason: 'cancelled',
    })
    expect(planPlayerStatValidation(
      { source: 'system_generated', propType: 'batter_hits' },
      BAL_NYY_RAINOUT,
      { now: yesterday },
    ).action).toBe('void')
  })

  test('genuine final looks up stats', () => {
    expect(planStatLookupFromGame(mlbGame(), { now: yesterday }).action).toBe('lookup')
  })

  test('in-progress does not use the past-date shortcut', () => {
    expect(planStatLookupFromGame(
      mlbGame({ status: 'in_progress', date: '2026-09-28T23:00:00.000Z' }),
      { now: yesterday },
    )).toEqual({ action: 'hold', reason: 'in_progress' })
  })

  test('stuck scheduled row with a real score can still look up', () => {
    expect(planStatLookupFromGame(
      mlbGame({ status: 'scheduled', homeScore: 7, awayScore: 2, date: '2026-09-28T23:00:00.000Z' }),
      { now: yesterday },
    )).toEqual({ action: 'lookup', reason: 'past_with_scores' })
  })

  test('unknown stuck status with a real score can still look up', () => {
    expect(planStatLookupFromGame(
      mlbGame({ status: 'mystery', homeScore: 7, awayScore: 2, date: '2026-09-28T23:00:00.000Z' }),
      { now: yesterday },
    )).toEqual({ action: 'lookup', reason: 'past_with_scores' })
  })

  test('postponed older than 7 days moves to needs_review', () => {
    expect(planStatLookupFromGame(
      mlbGame({
        status: 'postponed',
        homeScore: 0,
        awayScore: 0,
        date: '2026-09-20T23:00:00.000Z',
      }),
      { now: new Date('2026-10-01T16:00:00.000Z') },
    )).toEqual({ action: 'needs_review', reason: 'hold_timeout' })
  })

  test('suspended inside the 7-day window stays pending', () => {
    expect(planStatLookupFromGame(
      mlbGame({
        status: 'suspended',
        homeScore: 3,
        awayScore: 2,
        date: '2026-09-29T23:00:00.000Z',
      }),
      { now: new Date('2026-10-01T16:00:00.000Z') },
    )).toEqual({ action: 'hold', reason: 'suspended' })
  })

  test('stuck scheduled MLB 0-0 is not a shortcut to actual=0', () => {
    expect(planStatLookupFromGame(
      mlbGame({ status: 'scheduled', homeScore: 0, awayScore: 0, date: '2026-09-27T23:00:00.000Z' }),
      { now: yesterday },
    ).action).toBe('hold')
  })

  test('game_line rows still skip player-stat validation', () => {
    expect(planPlayerStatValidation(
      { source: 'game_line', propType: 'moneyline' },
      mlbGame(),
    )).toEqual({ action: 'skip_game_line', reason: 'source_game_line' })
  })
})

describe('ESPN completeness', () => {
  test('STATUS_POSTPONED / cancelled are not gradeable even when state=post', () => {
    expect(isEspnCompetitionGradeable({
      status: { type: { completed: false, state: 'post', name: 'STATUS_POSTPONED', detail: 'Postponed' } },
    })).toBe(false)
    expect(classifyEspnCompetition({
      status: { type: { state: 'post', name: 'STATUS_CANCELED', detail: 'Cancelled' } },
    }).action).toBe('void')
  })

  test('true finals still grade', () => {
    expect(isEspnCompetitionGradeable({
      status: { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } },
    })).toBe(true)
  })

  test('in-progress is not complete', () => {
    expect(isEspnCompetitionGradeable({
      status: { type: { completed: false, state: 'in', name: 'STATUS_IN_PROGRESS' } },
    })).toBe(false)
  })
})

describe('aggregateParlayOutcomes voids drop out', () => {
  test('void + two wins is a win', () => {
    expect(aggregateParlayOutcomes(['won', 'void', 'won'])).toBe('won')
    expect(aggregateFeaturedParlayOutcome(['won', 'void', 'won'])).toBe('won')
  })

  test('void + loss is a loss', () => {
    expect(aggregateParlayOutcomes(['void', 'lost', 'won'])).toBe('lost')
  })

  test('all void is a refunded push', () => {
    expect(aggregateParlayOutcomes(['void', 'void'])).toBe('push')
  })

  test('unresolved remaining legs stay pending', () => {
    expect(aggregateParlayOutcomes(['void', 'won', null])).toBe('pending')
  })

  test('genuine push still pushes the card', () => {
    expect(aggregateParlayOutcomes(['won', 'push'])).toBe('push')
  })

  test('normal 3-leg finals are unchanged', () => {
    expect(aggregateParlayOutcomes(['won', 'won', 'won'])).toBe('won')
    expect(aggregateParlayOutcomes(['won', 'lost', 'won'])).toBe('lost')
    expect(aggregateParlayOutcomes(['won', null, 'won'])).toBe('pending')
  })

  test('a known loss settles before remaining legs (builder and Featured)', () => {
    expect(aggregateParlayOutcomes(['won', 'lost', null])).toBe('lost')
  })
})

describe('settled odds after a void', () => {
  test('3-leg +100 card with one void books +3u not +7u', () => {
    const legs = [
      { odds: 100, outcome: 'won' },
      { odds: 100, outcome: 'void' },
      { odds: 100, outcome: 'won' },
    ]
    expect(settledParlayDecimalOdds(legs)).toBe(4)
    expect(unitsFromResult(settledParlayDecimalOdds(legs), 'won')).toBe(3)
    expect(unitsFromResult(8, 'won')).toBe(7)
    expect(parlayOddsForUnits({ totalOdds: 8, legs })).toBe(4)
  })
})

describe('planGameLineSettlement', () => {
  test('voids cancelled, grades real finals, skips postponed', () => {
    expect(planGameLineSettlement(BAL_NYY_RAINOUT)).toEqual({ action: 'void' })
    expect(planGameLineSettlement(mlbGame())).toEqual({ action: 'grade' })
    expect(planGameLineSettlement(mlbGame({ status: 'postponed', homeScore: 0, awayScore: 0 }))).toEqual({
      action: 'skip',
    })
    expect(planGameLineSettlement(mlbGame({ status: 'in_progress', homeScore: 2, awayScore: 1 }))).toEqual({
      action: 'skip',
    })
  })
})

describe('featured void from cancelled PropValidation', () => {
  test('void result wins over leftover actual=0', () => {
    expect(gradePropLegFromValidation(
      { threshold: 1.5, selection: 'over' },
      { status: 'manual_closed', result: 'void', actualValue: 0 },
    )).toBe('void')
    expect(resolveFeaturedHistoryLegOutcome({
      selection: 'over',
      threshold: 1.5,
      validationResult: 'void',
    })).toBe('void')
  })

  test('manual_closed with null actual and null result is not a Featured loss', () => {
    expect(isUsablePropValidation({
      status: 'manual_closed',
      result: null,
      actualValue: null,
    })).toBe(false)
    expect(gradePropLegFromValidation(
      { threshold: 1.5, selection: 'over' },
      { status: 'manual_closed', result: null, actualValue: null },
    )).toBeNull()
  })

  test('a cancelled-game void drops out of a Featured card', () => {
    const legs = [
      { playerName: 'A', propType: 'hits', selection: 'over', threshold: 0.5, gameIdRef: 'g1' },
      { playerName: 'B', propType: 'hits', selection: 'over', threshold: 0.5, gameIdRef: 'g2' },
      { playerName: 'C', propType: 'hits', selection: 'over', threshold: 0.5, gameIdRef: BAL_NYY_RAINOUT.id },
    ]
    const validations = [
      { playerName: 'A', propType: 'hits', status: 'completed', actualValue: 1, result: 'correct', gameIdRef: 'g1' },
      { playerName: 'B', propType: 'hits', status: 'completed', actualValue: 2, result: 'correct', gameIdRef: 'g2' },
      { playerName: 'C', propType: 'hits', status: 'manual_closed', actualValue: 0, result: 'void', gameIdRef: BAL_NYY_RAINOUT.id },
    ]
    const grade = gradeFeaturedParlayFromValidations(legs, validations)
    expect(grade.legOutcomes.map((row) => row.outcome)).toEqual(['won', 'won', 'void'])
    expect(grade.parlayOutcome).toBe('won')
  })
})

describe('unplayed-game grade report planner', () => {
  test('dry-run is default; --apply is explicit', () => {
    expect(parseUnplayedGradeArgs([])).toEqual({
      apply: false,
      help: false,
      game: null,
      sport: null,
      from: null,
      to: null,
    })
    expect(parseUnplayedGradeArgs(['--apply', '--sport', 'mlb', '--game', 'BAL_at_NYY_2026-09-27'])).toEqual({
      apply: true,
      help: false,
      game: 'BAL_at_NYY_2026-09-27',
      sport: 'mlb',
      from: null,
      to: null,
    })
  })

  test('--apply refuses anon / missing secret key', () => {
    expect(() => requireUnplayedGradeApplyKey({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    })).toThrow(/SUPABASE_SECRET_KEY/)
    expect(requireUnplayedGradeApplyKey({ SUPABASE_SECRET_KEY: 'secret' })).toBe('secret')
  })

  test('delayed games are not flagged', () => {
    const plan = planUnplayedGameGradeRepair({
      games: [mlbGame({ id: 'delayed-1', status: 'delayed', homeScore: 0, awayScore: 0 })],
      validations: [{
        id: 'pv-delay',
        status: 'completed',
        result: 'incorrect',
        actualValue: 0,
        gameIdRef: 'delayed-1',
      }],
    })
    expect(plan.games).toHaveLength(0)
    expect(plan.props).toHaveLength(0)
  })

  test('rerun after a partial abort still resets the settled parlay', () => {
    const plan = planUnplayedGameGradeRepair({
      games: [BAL_NYY_RAINOUT],
      validations: [],
      parlays: [{
        id: 'parlay-partial',
        status: 'lost',
        outcome: 'lost',
        legs: [
          { id: 'leg-voided', parlayId: 'parlay-partial', outcome: 'void', gameIdRef: BAL_NYY_RAINOUT.id },
          { id: 'leg-ok', parlayId: 'parlay-partial', outcome: 'won', gameIdRef: mlbGame().id },
        ],
      }],
    })
    expect(plan.legs).toHaveLength(0)
    expect(plan.parlays).toEqual([expect.objectContaining({ id: 'parlay-partial' })])
  })

  test('apply throws on 0 rows affected so a partial abort can retry', async () => {
    const plan = {
      props: [{ id: 'pv-1', action: 'void', gameStatus: 'cancelled' }],
      legs: [],
      parlays: [],
    }
    await expect(applyUnplayedGradeRepairs(plan, {
      writeProp: async () => ({ data: [], error: null, count: 0 }),
      writeLeg: async () => ({ data: [], error: null, count: 0 }),
      writeParlay: async () => ({ data: [], error: null, count: 0 }),
    })).rejects.toThrow(/affected 0 rows/)
  })

  test('flags settled props and legs on the BAL@NYY rainout', () => {
    const plan = planUnplayedGameGradeRepair({
      games: [BAL_NYY_RAINOUT, mlbGame()],
      validations: [
        {
          id: 'pv-bad',
          playerName: 'Aaron Judge',
          propType: 'batter_hits',
          status: 'completed',
          result: 'incorrect',
          actualValue: 0,
          gameIdRef: BAL_NYY_RAINOUT.id,
        },
        {
          id: 'pv-ok',
          playerName: 'Other',
          propType: 'batter_hits',
          status: 'completed',
          result: 'correct',
          actualValue: 2,
          gameIdRef: mlbGame().id,
        },
      ],
      parlays: [{
        id: 'parlay-1',
        status: 'lost',
        outcome: 'lost',
        legs: [
          { id: 'leg-1', parlayId: 'parlay-1', selection: 'NYY', betType: 'moneyline', outcome: 'push', gameIdRef: BAL_NYY_RAINOUT.id },
          { id: 'leg-2', parlayId: 'parlay-1', selection: 'BOS', betType: 'moneyline', outcome: 'won', gameIdRef: mlbGame().id },
        ],
      }],
    })

    expect(plan.props).toHaveLength(1)
    expect(plan.props[0].id).toBe('pv-bad')
    expect(plan.props[0].action).toBe('void')
    expect(plan.legs).toHaveLength(1)
    expect(plan.legs[0].id).toBe('leg-1')
    expect(plan.parlays).toHaveLength(1)
    expect(describePropRepairWrite(plan.props[0]).result).toBe('void')
    expect(describeLegRepairWrite(plan.legs[0]).outcome).toBe('void')
  })

  test('already-voided rows and genuine finals are left alone', () => {
    const plan = planUnplayedGameGradeRepair({
      games: [BAL_NYY_RAINOUT, mlbGame()],
      validations: [{
        id: 'pv-void',
        status: 'manual_closed',
        result: 'void',
        actualValue: null,
        gameIdRef: BAL_NYY_RAINOUT.id,
      }],
      parlays: [{
        id: 'ok',
        status: 'won',
        legs: [{ id: 'leg-ok', outcome: 'won', gameIdRef: mlbGame().id }],
      }],
    })
    expect(plan.props).toHaveLength(0)
    expect(plan.legs).toHaveLength(0)
    expect(plan.parlays).toHaveLength(0)
  })

  test('postponed grades requeue to pending instead of void', () => {
    const postponed = mlbGame({
      id: 'CHW_at_HOU_2026-09-29',
      status: 'postponed',
      homeScore: 0,
      awayScore: 0,
    })
    const plan = planUnplayedGameGradeRepair({
      games: [postponed],
      validations: [{
        id: 'pv-post',
        status: 'completed',
        result: 'incorrect',
        actualValue: 0,
        gameIdRef: postponed.id,
      }],
      parlays: [],
    })
    expect(plan.props[0].action).toBe('hold')
    expect(describePropRepairWrite(plan.props[0])).toMatchObject({
      status: 'pending',
      result: null,
      actualValue: null,
    })
  })
})
