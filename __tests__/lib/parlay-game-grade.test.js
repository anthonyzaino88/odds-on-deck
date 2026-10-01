import { gradeMoneylineFromGame, gradeTotalFromGame } from '../../lib/parlay-game-grade.js'

const rainout = {
  id: 'BAL_at_NYY_2026-09-27',
  sport: 'mlb',
  status: 'cancelled',
  homeScore: 0,
  awayScore: 0,
  home: { abbr: 'NYY' },
  away: { abbr: 'BAL' },
}

const final = {
  id: 'BOS_at_NYY_2026-09-26',
  sport: 'mlb',
  status: 'final',
  homeScore: 5,
  awayScore: 3,
  home: { abbr: 'NYY' },
  away: { abbr: 'BOS' },
}

describe('non-Featured ML / total from Game rows', () => {
  test('cancelled rainout voids moneyline instead of a 0-0 push', () => {
    expect(gradeMoneylineFromGame({ selection: 'NYY', betType: 'moneyline' }, rainout)).toMatchObject({
      outcome: 'void',
      actualValue: null,
    })
  })

  test('cancelled rainout voids a total instead of an Under', () => {
    expect(gradeTotalFromGame(
      { selection: 'under', threshold: 7.5, betType: 'total' },
      rainout,
      { line: 7.5, side: 'under' },
    )).toMatchObject({
      outcome: 'void',
      actualValue: null,
    })
  })

  test('genuine final still grades ML and total', () => {
    expect(gradeMoneylineFromGame({ selection: 'NYY', betType: 'moneyline' }, final)).toMatchObject({
      outcome: 'won',
      actualValue: 1,
    })
    expect(gradeTotalFromGame(
      { selection: 'over', betType: 'total' },
      final,
      { line: 7.5, side: 'over' },
    )).toMatchObject({
      outcome: 'won',
      actualValue: 8,
    })
  })

  test('in-progress and postponed do not grade', () => {
    expect(gradeMoneylineFromGame(
      { selection: 'NYY' },
      { ...final, status: 'in_progress' },
    ).outcome).toBeNull()
    expect(gradeTotalFromGame(
      { selection: 'under' },
      { ...rainout, status: 'postponed' },
      { line: 7.5, side: 'under' },
    ).outcome).toBeNull()
  })
})
