import {
  aggregateParlayOutcomes,
  canGradeFromGame,
  classifyEspnCompetition,
  classifyGameForGrading,
  isEspnCompetitionGradeable,
  isImpossibleMlbFinal,
  planStatLookupFromGame,
  shouldVoidFromGame,
  voidPropValidationPatch,
} from '../../lib/game-grade-eligibility.js'
import { shouldGradeGameLine } from '../../lib/game-lines.js'
import { planPlayerStatValidation } from '../../lib/pending-props.js'
import {
  describeLegRepairWrite,
  describePropRepairWrite,
  parseUnplayedGradeArgs,
  planUnplayedGameGradeRepair,
} from '../../lib/unplayed-game-grades.js'
import {
  aggregateFeaturedParlayOutcome,
  gradeFeaturedParlayFromValidations,
  gradePropLegFromValidation,
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
      mlbGame({ status: 'mystery', homeScore: 7, awayScore: 2, date: '2026-09-28T23:00:00.000Z' }),
      { now: yesterday },
    )).toEqual({ action: 'lookup', reason: 'past_with_scores' })
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
    expect(parseUnplayedGradeArgs([])).toEqual({ apply: false, help: false })
    expect(parseUnplayedGradeArgs(['--apply'])).toEqual({ apply: true, help: false })
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
