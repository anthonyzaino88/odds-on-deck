import { readFileSync } from 'fs'
import { join } from 'path'
import {
  espnLabelForNhlProp,
  extractEspnStatValue,
  isGradeableNhlStatResult,
  matchNhlBoxscorePlayer,
  nhlApiStatValue,
  nhlGradeSourceFromResult,
  normalizeNhlPlayerName,
} from '../../lib/nhl-stat-grade.js'
import {
  createNhlLookupCache,
  getPlayerGameStat,
  lookupPlayerGameStat,
  nhlApiPlayerDisplayName,
} from '../../lib/vendors/nhl-game-stats.js'

const ESPN_SKATER_LABELS = ['TOI', 'G', 'A', '+/-', 'S', 'SM', 'SOG', 'SV']

function espnAthlete(id, name, stats) {
  return {
    athlete: { id, displayName: name, fullName: name },
    stats,
  }
}

function espnNhlSummary({ status = 'STATUS_FINAL', teams } = {}) {
  return {
    header: { competitions: [{ status: { type: { name: status } } }] },
    boxscore: { players: teams },
  }
}

function njdHughesEspnTeams() {
  return [
    {
      team: { abbreviation: 'NJD' },
      statistics: [{
        labels: ESPN_SKATER_LABELS,
        athletes: [
          espnAthlete('8478569', 'Jack Hughes', ['20:10', '1', '2', '1', '5', '2', '0', '0']),
          espnAthlete('8481554', 'Luke Hughes', ['18:22', '0', '1', '0', '3', '1', '0', '0']),
        ],
      }],
    },
    {
      team: { abbreviation: 'NYR' },
      statistics: [{
        labels: ESPN_SKATER_LABELS,
        athletes: [
          espnAthlete('8476459', 'Artemi Panarin', ['19:01', '0', '0', '0', '4', '0', '1', '0']),
        ],
      }],
    },
  ]
}

function jsonResponse(body, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  })
}

describe('ESPN NHL stat mapping', () => {
  test('maps shots on goal to S, never shootout-goals SOG', () => {
    expect(espnLabelForNhlProp('shots_on_goal')).toBe('S')
    expect(espnLabelForNhlProp('player_shots_on_goal')).toBe('S')
    expect(espnLabelForNhlProp('sog')).toBe('S')
    expect(espnLabelForNhlProp('shots')).toBe('S')

    const luke = espnAthlete('8481554', 'Luke Hughes', ['18:22', '0', '1', '0', '3', '1', '0', '0'])
    expect(extractEspnStatValue(luke, 'player_shots_on_goal', ESPN_SKATER_LABELS)).toEqual({
      value: 3,
      statFound: true,
    })
    expect(extractEspnStatValue(luke, 'shots_on_goal', ESPN_SKATER_LABELS).value).not.toBe(0)
  })

  test('keeps goals, assists, points, and saves on the existing ESPN columns', () => {
    expect(espnLabelForNhlProp('goals')).toBe('G')
    expect(espnLabelForNhlProp('assists')).toBe('A')
    expect(espnLabelForNhlProp('points')).toBe('POINTS')
    expect(espnLabelForNhlProp('saves')).toBe('SV')

    const jack = espnAthlete('8478569', 'Jack Hughes', ['20:10', '1', '2', '1', '5', '2', '0', '0'])
    expect(extractEspnStatValue(jack, 'goals', ESPN_SKATER_LABELS).value).toBe(1)
    expect(extractEspnStatValue(jack, 'assists', ESPN_SKATER_LABELS).value).toBe(2)
    expect(extractEspnStatValue(jack, 'points', ESPN_SKATER_LABELS).value).toBe(3)
  })

  test('NHL API shots_on_goal reads sog, then shots', () => {
    expect(nhlApiStatValue({ sog: 5, shots: 7 }, 'player_shots_on_goal')).toEqual({
      value: 5,
      statFound: true,
    })
    expect(nhlApiStatValue({ shots: 7 }, 'sog')).toEqual({
      value: 7,
      statFound: true,
    })
    expect(nhlApiStatValue({ sog: 0 }, 'shots_on_goal')).toEqual({
      value: 0,
      statFound: true,
    })
  })
})

describe('strict NHL player matching', () => {
  const njdHughes = [
    { id: '8478569', name: 'Jack Hughes', team: 'NJD' },
    { id: '8481554', name: 'Luke Hughes', team: 'NJD' },
  ]

  const tkachuks = [
    { id: '8480801', name: 'Brady Tkachuk', team: 'OTT' },
    { id: '8479314', name: 'Matthew Tkachuk', team: 'FLA' },
  ]

  test('Luke Hughes vs Jack Hughes on NJD do not cross-match', () => {
    expect(matchNhlBoxscorePlayer(njdHughes, { name: 'Luke Hughes', team: 'NJD' }).player.name)
      .toBe('Luke Hughes')
    expect(matchNhlBoxscorePlayer(njdHughes, { name: 'Jack Hughes', team: 'NJ' }).player.name)
      .toBe('Jack Hughes')
    expect(matchNhlBoxscorePlayer(njdHughes, { name: 'Hughes', team: 'NJD' }).status)
      .toBe('unmatched')
    expect(matchNhlBoxscorePlayer(njdHughes, { name: 'Luke', team: 'NJD' }).status)
      .toBe('unmatched')
  })

  test('Brady vs Matthew Tkachuk on different teams do not cross-match', () => {
    expect(matchNhlBoxscorePlayer(tkachuks, { name: 'Brady Tkachuk', team: 'OTT' }).player.name)
      .toBe('Brady Tkachuk')
    expect(matchNhlBoxscorePlayer(tkachuks, { name: 'Matthew Tkachuk', team: 'FLA' }).player.name)
      .toBe('Matthew Tkachuk')
    expect(matchNhlBoxscorePlayer(tkachuks, { name: 'Brady Tkachuk', team: 'FLA' }).status)
      .toBe('unmatched')
    expect(matchNhlBoxscorePlayer(tkachuks, { name: 'Matthew Tkachuk', team: 'OTT' }).status)
      .toBe('unmatched')
  })

  test('ambiguous or last-name-only queries stay unmatched / ambiguous', () => {
    const lastNameOnly = matchNhlBoxscorePlayer(njdHughes, { name: 'Hughes' })
    expect(['unmatched', 'ambiguous']).toContain(lastNameOnly.status)
    expect(lastNameOnly.player).toBeNull()

    const twins = [
      { id: '1', name: 'Elias Pettersson', team: 'VAN' },
      { id: '2', name: 'Elias Pettersson', team: 'VAN' },
    ]
    expect(matchNhlBoxscorePlayer(twins, { name: 'Elias Pettersson', team: 'VAN' }).status)
      .toBe('ambiguous')
  })

  test('normalizes accents, punctuation, and Jr/Sr', () => {
    expect(normalizeNhlPlayerName('Aleksander Barkov Jr.')).toBe('aleksander barkov')
    expect(normalizeNhlPlayerName('Aleksander Barkov')).toBe('aleksander barkov')
    expect(normalizeNhlPlayerName('Elias Pëttersson')).toBe(normalizeNhlPlayerName('Elias Pettersson'))
    expect(normalizeNhlPlayerName('John Smith IV')).toBe('john smith')
    expect(matchNhlBoxscorePlayer(
      [{ id: 'a', name: 'Aleksander Barkov Jr.', team: 'FLA' }],
      { name: 'Aleksander Barkov', team: 'FLA' },
    ).status).toBe('matched')
  })

  test('keeps single-letter initials such as V. Trocheck', () => {
    expect(normalizeNhlPlayerName('V. Trocheck')).toBe('v trocheck')
    expect(matchNhlBoxscorePlayer(
      [{ id: '8476389', name: 'Vincent Trocheck', team: 'NYR' }],
      { name: 'V. Trocheck', team: 'NYR' },
    ).status).toBe('unmatched')
    expect(matchNhlBoxscorePlayer(
      [{ id: '8476389', name: 'Vincent Trocheck', team: 'NYR' }],
      { name: 'Vincent Trocheck', team: 'NYR' },
    )).toMatchObject({
      status: 'matched',
      player: { id: '8476389' },
    })
  })

  test('player id match wins without using last-name fallback', () => {
    expect(matchNhlBoxscorePlayer(njdHughes, { playerId: '8481554', name: 'Jack Hughes' }).player.name)
      .toBe('Luke Hughes')
  })

  test('abbreviated C. Coyle does not match Charlie Coyle', () => {
    expect(matchNhlBoxscorePlayer(
      [{ id: '8475745', name: 'C. Coyle', team: 'BOS' }],
      { name: 'Charlie Coyle' },
    )).toEqual({
      status: 'unmatched',
      player: null,
    })
  })

  test('Jamie Benn does not match Jordie Benn when Jamie is absent', () => {
    expect(matchNhlBoxscorePlayer(
      [{ id: '8470917', name: 'Jordie Benn', team: 'DAL' }],
      { name: 'Jamie Benn', team: 'DAL' },
    )).toEqual({
      status: 'unmatched',
      player: null,
    })
    expect(matchNhlBoxscorePlayer(
      [{ id: '8481554', name: 'Luke Hughes', team: 'NJD' }],
      { name: 'Jack Hughes', team: 'NJD' },
    ).status).toBe('unmatched')
  })

  test('strips curly apostrophes in names like O’Reilly', () => {
    expect(normalizeNhlPlayerName('O\u2019Reilly')).toBe('oreilly')
    expect(normalizeNhlPlayerName("O'Reilly")).toBe('oreilly')
    expect(matchNhlBoxscorePlayer(
      [{ id: 'a', name: 'Ryan O\u2019Reilly', team: 'NSH' }],
      { name: "Ryan O'Reilly" },
    ).status).toBe('matched')
  })

  test('nickname aliases match only when unique after exact miss', () => {
    expect(matchNhlBoxscorePlayer(
      [{ id: '1', name: 'Mitchell Marner', team: 'TOR' }],
      { name: 'Mitch Marner' },
    ).player.id).toBe('1')
    expect(matchNhlBoxscorePlayer(
      [{ id: '1', name: 'Matthew Tkachuk', team: 'FLA' }],
      { name: 'Matt Tkachuk' },
    ).status).toBe('matched')
    expect(matchNhlBoxscorePlayer(
      [
        { id: '1', name: 'Mitchell Marner', team: 'TOR' },
        { id: '2', name: 'Mitchell Marner', team: 'FAKE' },
      ],
      { name: 'Mitch Marner' },
    ).status).toBe('ambiguous')
  })
})

describe('gradeable NHL lookup results', () => {
  test('fallback 0 for an unmatched player is not gradeable', () => {
    expect(isGradeableNhlStatResult({
      value: 0,
      source: 'espn-fallback',
      matchStatus: 'unmatched',
      statFound: false,
      gameFinal: true,
    })).toBe(false)
  })

  test('matched 0 in a final boxscore is gradeable and records source', () => {
    const result = {
      value: 0,
      source: 'espn-fallback',
      matchStatus: 'matched',
      statFound: true,
      gameFinal: true,
    }
    expect(isGradeableNhlStatResult(result)).toBe(true)
    expect(nhlGradeSourceFromResult(result)).toBe('espn-fallback')
    expect(nhlGradeSourceFromResult({ source: 'nhl-api' })).toBe('nhl-api')
  })

  test('does not grade when the game is not final or the column is missing', () => {
    expect(isGradeableNhlStatResult({
      value: 4,
      source: 'nhl-api',
      matchStatus: 'matched',
      statFound: true,
      gameFinal: false,
    })).toBe(false)
    expect(isGradeableNhlStatResult({
      value: null,
      source: 'espn-fallback',
      matchStatus: 'matched',
      statFound: false,
      gameFinal: true,
    })).toBe(false)
  })
})

describe('lookupPlayerGameStat ESPN fallback', () => {
  beforeEach(() => {
    global.fetch = jest.fn((url) => {
      if (String(url).includes('/summary?event=')) {
        return jsonResponse(espnNhlSummary({ teams: njdHughesEspnTeams() }))
      }
      return jsonResponse({}, false)
    })
  })

  test('reads Luke Hughes SOG from S, not shootout SOG', async () => {
    const result = await lookupPlayerGameStat('401802001', 'Luke Hughes', 'player_shots_on_goal', null, {
      team: 'NJD',
    })
    expect(result).toMatchObject({
      value: 3,
      source: 'espn-fallback',
      matchStatus: 'matched',
      statFound: true,
      gameFinal: true,
    })
    expect(await getPlayerGameStat('401802001', 'Jack Hughes', 'shots_on_goal', null, { team: 'NJD' }))
      .toBe(5)
  })

  test('does not grade an unmatched player even if SOG is 0 on the sheet', async () => {
    const result = await lookupPlayerGameStat('401802001', 'Connor Fake', 'player_shots_on_goal')
    expect(isGradeableNhlStatResult(result)).toBe(false)
    expect(result.matchStatus).toBe('unmatched')
    expect(await getPlayerGameStat('401802001', 'Connor Fake', 'player_shots_on_goal')).toBeNull()
  })

  test('does not give Brady Tkachuk Matthew Tkachuk\'s shots', async () => {
    const labels = ESPN_SKATER_LABELS
    global.fetch = jest.fn(() => jsonResponse(espnNhlSummary({
      teams: [
        {
          team: { abbreviation: 'OTT' },
          statistics: [{
            labels,
            athletes: [espnAthlete('8480801', 'Brady Tkachuk', ['19:00', '1', '0', '1', '6', '1', '0', '0'])],
          }],
        },
        {
          team: { abbreviation: 'FLA' },
          statistics: [{
            labels,
            athletes: [espnAthlete('8479314', 'Matthew Tkachuk', ['18:00', '0', '2', '0', '2', '0', '1', '0'])],
          }],
        },
      ],
    })))

    expect(await getPlayerGameStat('401802002', 'Brady Tkachuk', 'player_shots_on_goal', null, { team: 'OTT' }))
      .toBe(6)
    expect(await getPlayerGameStat('401802002', 'Brady Tkachuk', 'player_shots_on_goal', null, { team: 'FLA' }))
      .toBeNull()
    expect(await getPlayerGameStat('401802002', 'Matthew Tkachuk', 'player_shots_on_goal', null, { team: 'FLA' }))
      .toBe(2)
  })

  test('does not grade last-name-only Hughes against the NJD pair', async () => {
    const result = await lookupPlayerGameStat('401802001', 'Hughes', 'player_shots_on_goal', null, {
      team: 'NJD',
    })
    expect(isGradeableNhlStatResult(result)).toBe(false)
    expect(['unmatched', 'ambiguous']).toContain(result.matchStatus)
  })

  test('does not grade a live game', async () => {
    global.fetch = jest.fn(() => jsonResponse(espnNhlSummary({
      status: 'STATUS_IN_PROGRESS',
      teams: njdHughesEspnTeams(),
    })))
    const result = await lookupPlayerGameStat('401802001', 'Luke Hughes', 'player_shots_on_goal')
    expect(result.gameFinal).toBe(false)
    expect(isGradeableNhlStatResult(result)).toBe(false)
    expect(await getPlayerGameStat('401802001', 'Luke Hughes', 'player_shots_on_goal')).toBeNull()
  })
})

describe('NHL API display names', () => {
  test('prefers firstName/lastName over abbreviated name.default', () => {
    expect(nhlApiPlayerDisplayName({
      name: { default: 'C. Coyle' },
      firstName: { default: 'Charlie' },
      lastName: { default: 'Coyle' },
    })).toBe('Charlie Coyle')
  })

  test('grades Charlie Coyle from NHL API rosterSpots joined to boxscore SOG', async () => {
    global.fetch = jest.fn((url) => {
      const href = String(url)
      if (href.includes('/schedule/')) {
        return jsonResponse({
          gameWeek: [{
            games: [{
              id: 2026020101,
              awayTeam: { abbrev: 'NYR' },
              homeTeam: { abbrev: 'BOS' },
            }],
          }],
        })
      }
      if (href.includes('/gamecenter/2026020101/boxscore')) {
        return jsonResponse({
          gameState: 'OFF',
          homeTeam: { id: 6, abbrev: 'BOS' },
          awayTeam: { id: 3, abbrev: 'NYR' },
          playerByGameStats: {
            homeTeam: {
              forwards: [{
                playerId: 8475745,
                name: { default: 'C. Coyle' },
                sog: 4,
              }],
              defense: [],
              goalies: [],
            },
            awayTeam: { forwards: [], defense: [], goalies: [] },
          },
        })
      }
      if (href.includes('/gamecenter/2026020101/play-by-play')) {
        return jsonResponse({
          homeTeam: { id: 6, abbrev: 'BOS' },
          awayTeam: { id: 3, abbrev: 'NYR' },
          rosterSpots: [{
            playerId: 8475745,
            teamId: 6,
            firstName: { default: 'Charlie' },
            lastName: { default: 'Coyle' },
          }],
        })
      }
      return jsonResponse({}, false)
    })

    const result = await lookupPlayerGameStat(
      '401802099',
      'Charlie Coyle',
      'player_shots_on_goal',
      'NYR_at_BOS_2026-01-01',
    )
    expect(result).toMatchObject({
      value: 4,
      source: 'nhl-api',
      matchStatus: 'matched',
      gameFinal: true,
      player: 'Charlie Coyle',
    })
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/summary?event='))).toBe(false)
  })

  test('joins NHL rosterSpots full names to boxscore SOG by playerId', async () => {
    global.fetch = jest.fn((url) => {
      const href = String(url)
      if (href.includes('/schedule/')) {
        return jsonResponse({
          gameWeek: [{
            games: [{
              id: 2026020101,
              awayTeam: { abbrev: 'NYR' },
              homeTeam: { abbrev: 'OTT' },
            }],
          }],
        })
      }
      if (href.includes('/gamecenter/2026020101/boxscore')) {
        return jsonResponse({
          gameState: 'OFF',
          homeTeam: { id: 9, abbrev: 'OTT' },
          awayTeam: { id: 3, abbrev: 'NYR' },
          playerByGameStats: {
            homeTeam: {
              forwards: [{
                playerId: 8482116,
                name: { default: 'T. Stützle' },
                sog: 5,
              }],
              defense: [],
              goalies: [],
            },
            awayTeam: { forwards: [], defense: [], goalies: [] },
          },
        })
      }
      if (href.includes('/gamecenter/2026020101/play-by-play')) {
        return jsonResponse({
          homeTeam: { id: 9, abbrev: 'OTT' },
          awayTeam: { id: 3, abbrev: 'NYR' },
          rosterSpots: [{
            playerId: 8482116,
            teamId: 9,
            firstName: { default: 'Tim' },
            lastName: { default: 'Stützle' },
          }],
        })
      }
      return jsonResponse({}, false)
    })

    const result = await lookupPlayerGameStat(
      '401802099',
      'Tim Stützle',
      'player_shots_on_goal',
      'NYR_at_OTT_2026-01-01',
    )
    expect(result).toMatchObject({
      value: 5,
      source: 'nhl-api',
      matchStatus: 'matched',
      gameFinal: true,
      player: 'Tim Stützle',
    })
    expect(isGradeableNhlStatResult(result)).toBe(true)
  })

  test('does not grade Jamie Benn when only Jordie Benn is in NHL and ESPN data', async () => {
    global.fetch = jest.fn((url) => {
      const href = String(url)
      if (href.includes('/schedule/')) {
        return jsonResponse({
          gameWeek: [{
            games: [{
              id: 2026020102,
              awayTeam: { abbrev: 'DAL' },
              homeTeam: { abbrev: 'NJD' },
            }],
          }],
        })
      }
      if (href.includes('/gamecenter/2026020102/boxscore')) {
        return jsonResponse({
          gameState: 'OFF',
          homeTeam: { id: 1, abbrev: 'NJD' },
          awayTeam: { id: 25, abbrev: 'DAL' },
          playerByGameStats: {
            awayTeam: {
              forwards: [{
                playerId: 8470917,
                name: { default: 'J. Benn' },
                sog: 4,
              }],
              defense: [],
              goalies: [],
            },
            homeTeam: { forwards: [], defense: [], goalies: [] },
          },
        })
      }
      if (href.includes('/gamecenter/2026020102/play-by-play')) {
        return jsonResponse({
          homeTeam: { id: 1, abbrev: 'NJD' },
          awayTeam: { id: 25, abbrev: 'DAL' },
          rosterSpots: [{
            playerId: 8470917,
            teamId: 25,
            firstName: { default: 'Jordie' },
            lastName: { default: 'Benn' },
          }],
        })
      }
      if (href.includes('/summary?event=')) {
        return jsonResponse(espnNhlSummary({
          teams: [{
            team: { abbreviation: 'DAL' },
            statistics: [{
              labels: ESPN_SKATER_LABELS,
              athletes: [espnAthlete('8470917', 'Jordie Benn', ['18:00', '0', '1', '0', '4', '0', '0', '0'])],
            }],
          }],
        }))
      }
      return jsonResponse({}, false)
    })

    const result = await lookupPlayerGameStat(
      '401802200',
      'Jamie Benn',
      'player_shots_on_goal',
      'DAL_at_NJ_2026-01-01',
      { team: 'DAL' },
    )
    expect(isGradeableNhlStatResult(result)).toBe(false)
    expect(result.matchStatus).toBe('unmatched')
    expect(await getPlayerGameStat(
      '401802200',
      'Jamie Benn',
      'player_shots_on_goal',
      'DAL_at_NJ_2026-01-01',
      { team: 'DAL' },
    )).toBeNull()
  })

  test('caches NHL boxscore and ESPN summary per game and delays only uncached fetches', async () => {
    const sleep = jest.fn(async () => {})
    const cache = createNhlLookupCache()
    let espnCalls = 0
    global.fetch = jest.fn((url) => {
      if (String(url).includes('/summary?event=')) {
        espnCalls += 1
        return jsonResponse(espnNhlSummary({ teams: njdHughesEspnTeams() }))
      }
      return jsonResponse({}, false)
    })

    await lookupPlayerGameStat('401802001', 'Luke Hughes', 'player_shots_on_goal', null, {
      cache,
      fetchDelayMs: 150,
      sleep,
    })
    await lookupPlayerGameStat('401802001', 'Jack Hughes', 'player_shots_on_goal', null, {
      cache,
      fetchDelayMs: 150,
      sleep,
    })

    expect(espnCalls).toBe(1)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(150)
  })

  test('does not cache failed NHL/ESPN fetches so a later retry can succeed', async () => {
    const cache = createNhlLookupCache()
    let scheduleCalls = 0
    const espnAttempts = {}
    global.fetch = jest.fn((url) => {
      const href = String(url)
      if (href.includes('/schedule/')) {
        scheduleCalls += 1
        if (scheduleCalls === 1) {
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            json: async () => ({}),
          })
        }
        return jsonResponse({
          gameWeek: [{
            games: [{
              id: 2026020101,
              awayTeam: { abbrev: 'NYR' },
              homeTeam: { abbrev: 'BOS' },
            }],
          }],
        })
      }
      if (href.includes('/gamecenter/2026020101/boxscore')) {
        return jsonResponse({
          gameState: 'OFF',
          homeTeam: { id: 6, abbrev: 'BOS' },
          awayTeam: { id: 3, abbrev: 'NYR' },
          playerByGameStats: {
            homeTeam: {
              forwards: [{
                playerId: 8475745,
                name: { default: 'C. Coyle' },
                sog: 4,
              }],
              defense: [],
              goalies: [],
            },
            awayTeam: { forwards: [], defense: [], goalies: [] },
          },
        })
      }
      if (href.includes('/gamecenter/2026020101/play-by-play')) {
        return jsonResponse({
          homeTeam: { id: 6, abbrev: 'BOS' },
          awayTeam: { id: 3, abbrev: 'NYR' },
          rosterSpots: [{
            playerId: 8475745,
            teamId: 6,
            firstName: { default: 'Charlie' },
            lastName: { default: 'Coyle' },
          }],
        })
      }
      if (href.includes('/summary?event=')) {
        const eventId = href.split('event=')[1]
        espnAttempts[eventId] = (espnAttempts[eventId] || 0) + 1
        if (eventId === '401802099' || espnAttempts[eventId] === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            json: async () => ({}),
          })
        }
        if (espnAttempts[eventId] === 2) {
          return Promise.reject(new Error('socket hang up'))
        }
        return jsonResponse(espnNhlSummary({ teams: njdHughesEspnTeams() }))
      }
      return jsonResponse({}, false)
    })

    const failedSchedule = await lookupPlayerGameStat(
      '401802099',
      'Charlie Coyle',
      'player_shots_on_goal',
      'NYR_at_BOS_2026-01-01',
      { cache },
    )
    expect(isGradeableNhlStatResult(failedSchedule)).toBe(false)

    const recoveredNhl = await lookupPlayerGameStat(
      '401802099',
      'Charlie Coyle',
      'player_shots_on_goal',
      'NYR_at_BOS_2026-01-01',
      { cache },
    )
    expect(recoveredNhl).toMatchObject({
      value: 4,
      source: 'nhl-api',
      matchStatus: 'matched',
      gameFinal: true,
    })
    expect(scheduleCalls).toBe(2)

    expect(isGradeableNhlStatResult(
      await lookupPlayerGameStat('401802001', 'Luke Hughes', 'player_shots_on_goal', null, { cache }),
    )).toBe(false)
    expect(isGradeableNhlStatResult(
      await lookupPlayerGameStat('401802001', 'Luke Hughes', 'player_shots_on_goal', null, { cache }),
    )).toBe(false)

    const recoveredEspn = await lookupPlayerGameStat(
      '401802001',
      'Luke Hughes',
      'player_shots_on_goal',
      null,
      { cache },
    )
    expect(recoveredEspn).toMatchObject({
      value: 3,
      source: 'espn-fallback',
      matchStatus: 'matched',
      gameFinal: true,
    })
    expect(espnAttempts['401802001']).toBe(3)
  })
})

describe('NHL-only wiring leaves MLB/NFL graders untouched', () => {
  test('MLB and NFL vendor files do not import NHL match helpers', () => {
    const mlb = readFileSync(join(process.cwd(), 'lib/vendors/mlb-game-stats.js'), 'utf8')
    const nfl = readFileSync(join(process.cwd(), 'lib/vendors/nfl-game-stats.js'), 'utf8')
    expect(mlb).not.toMatch('nhl-stat-grade')
    expect(nfl).not.toMatch('nhl-stat-grade')
    expect(mlb).toMatch(/normalizeName\(key\) === normalizedSearchName/)
    expect(nfl).toMatch(/last === targetLast && last\.length > 3/)
  })

  test('validate-pending-props only accepts NHL zeros after a matched final stat', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/validate-pending-props.js'), 'utf8')
    expect(src).toMatch(/isGradeableNhlStatResult\(nhlLookup\)/)
    expect(src).toMatch(/nhlGradeSourceFromResult\(nhlLookup\)/)
    expect(src).toMatch(/lookupPlayerGameStat/)
  })
})
