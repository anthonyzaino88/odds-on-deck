import {
  appearanceGradeContext,
  isVerifiedPlayerStatGameId,
  planPlayerAppearanceGrade,
} from '../../lib/player-stat-grade.js'

const FINAL_MLB = {
  id: 'KC_at_HOU_2026-09-17',
  sport: 'mlb',
  status: 'final',
  homeScore: 4,
  awayScore: 2,
  mlbGameId: '824141',
  espnGameId: '401581234',
}

describe('isVerifiedPlayerStatGameId', () => {
  test('MLB is verified when mlbGameId matches the used id and a schedule/ESPN id is present', () => {
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', '824141')).toBe(true)
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', FINAL_MLB.id)).toBe(true)
    expect(isVerifiedPlayerStatGameId({ ...FINAL_MLB, mlbGameId: null }, 'mlb', '824141')).toBe(false)
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', '999999')).toBe(false)
  })

  test('NHL is verified from ESPN id or schedule id', () => {
    const nhl = { id: 'NJD_at_NYR_2026-10-01', sport: 'nhl', espnGameId: '401802001' }
    expect(isVerifiedPlayerStatGameId(nhl, 'nhl', '401802001')).toBe(true)
    expect(isVerifiedPlayerStatGameId({ id: 'NJD_at_NYR_2026-10-01', sport: 'nhl' }, 'nhl')).toBe(true)
    expect(isVerifiedPlayerStatGameId({ id: 'nope', sport: 'nhl' }, 'nhl')).toBe(false)
  })
})

describe('planPlayerAppearanceGrade DNP voids', () => {
  test('MLB/NHL missing from a final verified box become void', () => {
    expect(planPlayerAppearanceGrade(
      { reason: 'not_in_box', matchStatus: 'unmatched', value: null },
      { sport: 'mlb', gameFinal: true, gameIdVerified: true },
    )).toEqual({ action: 'void', reason: 'not_in_box' })
    expect(planPlayerAppearanceGrade(
      { matchStatus: 'unmatched', value: null, gameFinal: true },
      { sport: 'nhl', gameFinal: true, gameIdVerified: true },
    )).toEqual({ action: 'void', reason: 'not_in_box' })
  })

  test('keeps needs_review when the game is not final or the id is unverified', () => {
    expect(planPlayerAppearanceGrade(
      { reason: 'not_in_box', matchStatus: 'unmatched', value: null, gameFinal: false },
      { sport: 'nhl', gameFinal: true, gameIdVerified: true },
    )).toEqual({ action: 'needs_review', reason: 'not_in_box' })
    expect(planPlayerAppearanceGrade(
      { reason: 'not_in_box', matchStatus: 'unmatched', value: null },
      { sport: 'mlb', gameFinal: true, gameIdVerified: false },
    )).toEqual({ action: 'needs_review', reason: 'not_in_box' })
  })

  test('NFL players missing from the box stay needs_review', () => {
    expect(planPlayerAppearanceGrade(
      { reason: 'not_in_box', matchStatus: 'unmatched', value: null },
      { sport: 'nfl', gameFinal: true, gameIdVerified: true },
    )).toEqual({ action: 'needs_review', reason: 'not_in_box' })
  })

  test('in-box 0 PA / 0 TOI still void without the not-in-box gate', () => {
    expect(planPlayerAppearanceGrade({
      didNotPlay: true,
      reason: 'no_plate_appearances',
      value: null,
    })).toEqual({ action: 'void', reason: 'no_plate_appearances' })
    expect(planPlayerAppearanceGrade({
      didNotPlay: true,
      reason: 'zero_toi',
      value: null,
      matchStatus: 'matched',
    })).toEqual({ action: 'void', reason: 'zero_toi' })
  })

  test('appearanceGradeContext uses a real final + matching vendor id', () => {
    expect(appearanceGradeContext(FINAL_MLB, 'mlb', '824141')).toEqual({
      sport: 'mlb',
      gameFinal: true,
      gameIdVerified: true,
    })
    expect(appearanceGradeContext({
      ...FINAL_MLB,
      status: 'in_progress',
    }, 'mlb', '824141')).toMatchObject({
      gameFinal: false,
      gameIdVerified: true,
    })
  })
})
