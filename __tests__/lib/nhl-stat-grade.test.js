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
  getPlayerGameStat,
  lookupPlayerGameStat,
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
    expect(matchNhlBoxscorePlayer(
      [{ id: 'a', name: 'Aleksander Barkov Jr.', team: 'FLA' }],
      { name: 'Aleksander Barkov', team: 'FLA' },
    ).status).toBe('matched')
  })

  test('player id match wins without using last-name fallback', () => {
    expect(matchNhlBoxscorePlayer(njdHughes, { playerId: '8481554', name: 'Jack Hughes' }).player.name)
      .toBe('Luke Hughes')
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
