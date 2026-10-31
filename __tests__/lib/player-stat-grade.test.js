import {
  appearanceGradeContext,
  bothBoxRostersPresent,
  boxTeamsMatchGame,
  canonicalTeamCode,
  isVerifiedPlayerStatGameId,
  MLB_MIN_BOX_ROSTER,
  NHL_MIN_BOX_ROSTER,
  planPlayerAppearanceGrade,
} from '../../lib/player-stat-grade.js'
import { isNearMissPlayerName } from '../../lib/player-name-match.js'

const FINAL_MLB = {
  id: 'KC_at_HOU_2026-09-17',
  sport: 'mlb',
  status: 'final',
  homeScore: 4,
  awayScore: 2,
  mlbGameId: '824141',
  espnGameId: '401581234',
  homeId: 'MLB_117',
  awayId: 'MLB_118',
  home: { abbr: 'HOU' },
  away: { abbr: 'KC' },
}

const KC_HOU_BOX = {
  homeAbbr: 'HOU',
  awayAbbr: 'KC',
  homeRosterCount: 26,
  awayRosterCount: 26,
  playerNames: ['Jose Altuve', 'Bobby Witt Jr.'],
}

const NHL_GAME = {
  id: 'NJD_at_NYR_2026-10-01',
  sport: 'nhl',
  status: 'final',
  homeScore: 3,
  awayScore: 2,
  espnGameId: '401802001',
  homeId: 'NHL_3',
  awayId: 'NHL_1',
  home: { abbr: 'NYR' },
  away: { abbr: 'NJD' },
}

const NJD_NYR_BOX = {
  homeAbbr: 'NYR',
  awayAbbr: 'NJD',
  homeRosterCount: 20,
  awayRosterCount: 20,
  playerNames: ['Artemi Panarin', 'Jack Hughes'],
}

describe('isVerifiedPlayerStatGameId', () => {
  test('MLB is verified only with a real vendor id, both rosters, and matching teams', () => {
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', {
      usedId: '824141',
      box: KC_HOU_BOX,
    })).toBe(true)
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', '824141')).toBe(false)
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', FINAL_MLB.id)).toBe(false)
    expect(isVerifiedPlayerStatGameId({ ...FINAL_MLB, mlbGameId: null }, 'mlb', {
      usedId: '824141',
      box: KC_HOU_BOX,
    })).toBe(false)
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', {
      usedId: '999999',
      box: KC_HOU_BOX,
    })).toBe(false)
  })

  test('empty or partial box is not verified', () => {
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', {
      usedId: '824141',
      box: { ...KC_HOU_BOX, homeRosterCount: 0, awayRosterCount: 0, playerNames: [] },
    })).toBe(false)
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', {
      usedId: '824141',
      box: { ...KC_HOU_BOX, awayRosterCount: 0 },
    })).toBe(false)
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', {
      usedId: '824141',
      box: { ...KC_HOU_BOX, homeRosterCount: 0 },
    })).toBe(false)
  })

  test('stub MLB/NHL boxes below the roster floor are not verified', () => {
    const mlbStub = { ...KC_HOU_BOX, homeRosterCount: 2, awayRosterCount: 2 }
    const nhlStub = { ...NJD_NYR_BOX, homeRosterCount: 5, awayRosterCount: 5 }
    expect(MLB_MIN_BOX_ROSTER).toBe(9)
    expect(NHL_MIN_BOX_ROSTER).toBe(15)
    expect(bothBoxRostersPresent(mlbStub, 'mlb')).toBe(false)
    expect(bothBoxRostersPresent({ ...KC_HOU_BOX, homeRosterCount: 8, awayRosterCount: 26 }, 'mlb')).toBe(false)
    expect(bothBoxRostersPresent(KC_HOU_BOX, 'mlb')).toBe(true)
    expect(bothBoxRostersPresent(nhlStub, 'nhl')).toBe(false)
    expect(bothBoxRostersPresent({ ...NJD_NYR_BOX, homeRosterCount: 14, awayRosterCount: 20 }, 'nhl')).toBe(false)
    expect(bothBoxRostersPresent(NJD_NYR_BOX, 'nhl')).toBe(true)
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', {
      usedId: '824141',
      box: mlbStub,
    })).toBe(false)
    expect(isVerifiedPlayerStatGameId(NHL_GAME, 'nhl', {
      usedId: '401802001',
      box: nhlStub,
    })).toBe(false)
  })

  test('ATH and OAK are the same MLB team', () => {
    expect(canonicalTeamCode('mlb', 'ATH')).toBe('ATH')
    expect(canonicalTeamCode('mlb', 'OAK')).toBe('ATH')
    const game = {
      id: 'LAA_at_ATH_2026-09-23',
      sport: 'mlb',
      status: 'final',
      mlbGameId: '824951',
      home: { abbr: 'ATH' },
      away: { abbr: 'LAA' },
    }
    const oakBox = {
      homeAbbr: 'OAK',
      awayAbbr: 'LAA',
      homeRosterCount: 26,
      awayRosterCount: 26,
      playerNames: ['Brent Rooker', 'Mike Trout'],
    }
    expect(boxTeamsMatchGame(game, 'mlb', oakBox)).toBe(true)
    expect(isVerifiedPlayerStatGameId(game, 'mlb', {
      usedId: '824951',
      box: oakBox,
    })).toBe(true)
    expect(boxTeamsMatchGame({
      ...game,
      home: { abbr: 'OAK' },
      id: 'LAA_at_OAK_2026-09-23',
    }, 'mlb', {
      ...oakBox,
      homeAbbr: 'ATH',
    })).toBe(true)
  })

  test('wrong-team box is not verified', () => {
    expect(isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', {
      usedId: '824141',
      box: {
        homeAbbr: 'NYY',
        awayAbbr: 'BOS',
        homeRosterCount: 26,
        awayRosterCount: 26,
        playerNames: ['Aaron Judge', 'Rafael Devers'],
      },
    })).toBe(false)
  })

  test('NHL requires a real ESPN id plus a matching full box', () => {
    expect(isVerifiedPlayerStatGameId(NHL_GAME, 'nhl', {
      usedId: '401802001',
      box: NJD_NYR_BOX,
    })).toBe(true)
    expect(isVerifiedPlayerStatGameId({
      id: 'NJD_at_NYR_2026-10-01',
      sport: 'nhl',
    }, 'nhl', { box: NJD_NYR_BOX })).toBe(false)
    expect(isVerifiedPlayerStatGameId({
      id: 'NJD_at_NYR_2026-10-01',
      sport: 'nhl',
    }, 'nhl')).toBe(false)
    expect(isVerifiedPlayerStatGameId({ id: 'nope', sport: 'nhl' }, 'nhl')).toBe(false)
  })
})

describe('near-miss names stay needs_review', () => {
  test('Zach/Zack Wheeler, Kiké Hernández, and J. Crawford are near-misses', () => {
    expect(isNearMissPlayerName('Zach Wheeler', ['Zack Wheeler', 'Bryce Harper'])).toBe(true)
    expect(isNearMissPlayerName('Kiké Hernández', ['Enrique Hernandez', 'Mookie Betts'])).toBe(true)
    expect(isNearMissPlayerName('J. Crawford', ['J.P. Crawford', 'Cal Raleigh'])).toBe(true)
    expect(isNearMissPlayerName('Nobody Fake', KC_HOU_BOX.playerNames)).toBe(false)
  })

  test('near-miss on a final verified box is needs_review, not void', () => {
    expect(planPlayerAppearanceGrade(
      { reason: 'not_in_box', matchStatus: 'unmatched', value: null },
      {
        sport: 'mlb',
        gameFinal: true,
        gameIdVerified: true,
        playerName: 'Zach Wheeler',
        box: { ...KC_HOU_BOX, playerNames: ['Zack Wheeler', 'Bryce Harper'] },
      },
    )).toEqual({ action: 'needs_review', reason: 'near_miss' })
    expect(planPlayerAppearanceGrade(
      { reason: 'not_in_box', matchStatus: 'unmatched', value: null },
      {
        sport: 'mlb',
        gameFinal: true,
        gameIdVerified: true,
        playerName: 'Kiké Hernández',
        box: { playerNames: ['Enrique Hernandez'] },
      },
    )).toEqual({ action: 'needs_review', reason: 'near_miss' })
    expect(planPlayerAppearanceGrade(
      { reason: 'not_in_box', matchStatus: 'unmatched', value: null },
      {
        sport: 'mlb',
        gameFinal: true,
        gameIdVerified: true,
        playerName: 'J. Crawford',
        box: { playerNames: ['J.P. Crawford'] },
      },
    )).toEqual({ action: 'needs_review', reason: 'near_miss' })
  })
})

describe('planPlayerAppearanceGrade DNP voids', () => {
  test('MLB/NHL missing from a final verified box become void', () => {
    expect(planPlayerAppearanceGrade(
      { reason: 'not_in_box', matchStatus: 'unmatched', value: null },
      { sport: 'mlb', gameFinal: true, gameIdVerified: true, playerName: 'Nobody Fake', box: KC_HOU_BOX },
    )).toEqual({ action: 'void', reason: 'not_in_box' })
    expect(planPlayerAppearanceGrade(
      { matchStatus: 'unmatched', value: null, gameFinal: true },
      { sport: 'nhl', gameFinal: true, gameIdVerified: true, playerName: 'Nobody Fake', box: NJD_NYR_BOX },
    )).toEqual({ action: 'void', reason: 'not_in_box' })
  })

  test('empty, partial, or wrong-team boxes stay needs_review', () => {
    const unmatched = { reason: 'not_in_box', matchStatus: 'unmatched', value: null }
    expect(planPlayerAppearanceGrade(unmatched, {
      sport: 'mlb',
      gameFinal: true,
      gameIdVerified: isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', {
        usedId: '824141',
        box: { ...KC_HOU_BOX, homeRosterCount: 0, awayRosterCount: 0, playerNames: [] },
      }),
      playerName: 'Nobody Fake',
    })).toEqual({ action: 'needs_review', reason: 'not_in_box' })
    expect(planPlayerAppearanceGrade(unmatched, {
      sport: 'mlb',
      gameFinal: true,
      gameIdVerified: isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', {
        usedId: '824141',
        box: { ...KC_HOU_BOX, awayRosterCount: 0 },
      }),
      playerName: 'Nobody Fake',
    })).toEqual({ action: 'needs_review', reason: 'not_in_box' })
    expect(planPlayerAppearanceGrade(unmatched, {
      sport: 'mlb',
      gameFinal: true,
      gameIdVerified: isVerifiedPlayerStatGameId(FINAL_MLB, 'mlb', {
        usedId: '824141',
        box: {
          homeAbbr: 'NYY',
          awayAbbr: 'BOS',
          homeRosterCount: 26,
          awayRosterCount: 26,
          playerNames: ['Aaron Judge'],
        },
      }),
      playerName: 'Nobody Fake',
    })).toEqual({ action: 'needs_review', reason: 'not_in_box' })
  })

  test('a stub box with matching teams stays needs_review, not void', () => {
    const unmatched = { reason: 'not_in_box', matchStatus: 'unmatched', value: null }
    const mlbStub = { ...KC_HOU_BOX, homeRosterCount: 2, awayRosterCount: 2 }
    const nhlStub = { ...NJD_NYR_BOX, homeRosterCount: 5, awayRosterCount: 5 }
    expect(planPlayerAppearanceGrade(unmatched, appearanceGradeContext(FINAL_MLB, 'mlb', {
      usedId: '824141',
      box: mlbStub,
      playerName: 'Nobody Fake',
    }))).toEqual({ action: 'needs_review', reason: 'not_in_box' })
    expect(planPlayerAppearanceGrade(unmatched, appearanceGradeContext(NHL_GAME, 'nhl', {
      usedId: '401802001',
      box: nhlStub,
      playerName: 'Nobody Fake',
    }))).toEqual({ action: 'needs_review', reason: 'not_in_box' })
  })

  test('NHL with no ESPN id stays needs_review even when a box is present', () => {
    const game = { id: 'NJD_at_NYR_2026-10-01', sport: 'nhl', status: 'final' }
    expect(planPlayerAppearanceGrade(
      { reason: 'not_in_box', matchStatus: 'unmatched', value: null },
      appearanceGradeContext(game, 'nhl', { box: NJD_NYR_BOX, playerName: 'Nobody Fake' }),
    )).toEqual({ action: 'needs_review', reason: 'not_in_box' })
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

  test('appearanceGradeContext verifies only a matching full box', () => {
    expect(appearanceGradeContext(FINAL_MLB, 'mlb', {
      usedId: '824141',
      box: KC_HOU_BOX,
    })).toMatchObject({
      sport: 'mlb',
      gameFinal: true,
      gameIdVerified: true,
    })
    expect(appearanceGradeContext(FINAL_MLB, 'mlb', '824141')).toMatchObject({
      gameFinal: true,
      gameIdVerified: false,
    })
    expect(appearanceGradeContext({
      ...FINAL_MLB,
      status: 'in_progress',
    }, 'mlb', { usedId: '824141', box: KC_HOU_BOX })).toMatchObject({
      gameFinal: false,
      gameIdVerified: true,
    })
  })
})
