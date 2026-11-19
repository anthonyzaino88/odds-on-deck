import {
  NFL_COMPLETED_GAME_STATUSES,
  completedNflGamesForGame,
  completedNflGamesForGames,
  loadCompletedNflGames,
  pickCompletedGamesCutoff,
} from '../../lib/nfl-completed-games.js'

const LOCK = '2025-11-16T17:00:00.000Z'
const KICKOFF = '2025-11-16T18:00:00.000Z'

function finalGame(overrides = {}) {
  return {
    id: 'g-prior',
    sport: 'nfl',
    season: '2025',
    date: '2025-11-09T18:00:00.000Z',
    status: 'final',
    home: { id: 'NFL_KC', abbr: 'KC' },
    away: { id: 'NFL_DEN', abbr: 'DEN' },
    homeScore: 27,
    awayScore: 17,
    lastUpdate: '2025-11-09T21:30:00.000Z',
    resultAvailableAt: '2025-11-09T21:30:00.000Z',
    ...overrides,
  }
}

function sundayGame(overrides = {}) {
  return {
    id: 'g-sun-1',
    sport: 'nfl',
    season: '2025',
    date: KICKOFF,
    status: 'scheduled',
    home: { id: 'NFL_KC', abbr: 'KC' },
    away: { id: 'NFL_LV', abbr: 'LV' },
    ...overrides,
  }
}

function lockQuote(gameId, overrides = {}) {
  return {
    id: `odd-h2h-${gameId}`,
    gameId,
    book: 'DraftKings',
    market: 'h2h',
    priceHome: -150,
    priceAway: 130,
    ts: LOCK,
    quotedAt: LOCK,
    ...overrides,
  }
}

function mockCompletedGamesClient(rows) {
  let gameReads = 0
  let statusFilter = null
  const client = {
    from(table) {
      if (table !== 'Game') throw new Error(`unexpected table ${table}`)
      gameReads += 1
      const chain = {
        select() { return chain },
        eq() { return chain },
        in(column, values) {
          if (column === 'status') statusFilter = values
          return chain
        },
        order() { return chain },
        limit() { return Promise.resolve({ data: rows, error: null }) },
      }
      return chain
    },
  }
  return {
    client,
    gameReads: () => gameReads,
    statusFilter: () => statusFilter,
  }
}

describe('NFL completed-game statuses', () => {
  test('the query list includes shootout and overtime finals', () => {
    expect(NFL_COMPLETED_GAME_STATUSES).toEqual(expect.arrayContaining([
      'final',
      'closed',
      'completed',
      'official',
      'final/ot',
      'final/so',
    ]))
  })
})

describe('completed NFL Game query is once per run', () => {
  test('one Game read serves every Sunday kickoff', async () => {
    const prior = finalGame()
    const soFinal = finalGame({
      id: 'g-so',
      status: 'final/so',
      date: '2025-11-09T21:00:00.000Z',
    })
    const betweenLockAndKickoff = finalGame({
      id: 'g-london',
      date: '2025-11-16T17:20:00.000Z',
      lastUpdate: '2025-11-16T17:45:00.000Z',
      resultAvailableAt: '2025-11-16T17:45:00.000Z',
    })
    const early = sundayGame({ id: 'g-sun-1', date: '2025-11-16T18:00:00.000Z' })
    const late = sundayGame({ id: 'g-sun-2', date: '2025-11-16T21:15:00.000Z' })
    const night = sundayGame({ id: 'g-sun-3', date: '2025-11-17T01:20:00.000Z' })
    const mock = mockCompletedGamesClient([prior, soFinal, betweenLockAndKickoff])

    const all = await loadCompletedNflGames(mock.client)
    expect(mock.gameReads()).toBe(1)
    expect(mock.statusFilter()).toEqual(expect.arrayContaining(['final/so', 'final/ot']))

    const earlyOdds = [lockQuote(early.id)]
    const lateOdds = [lockQuote(late.id, {
      ts: '2025-11-16T20:15:00.000Z',
      quotedAt: '2025-11-16T20:15:00.000Z',
    })]
    const nightOdds = [lockQuote(night.id, {
      ts: '2025-11-17T00:20:00.000Z',
      quotedAt: '2025-11-17T00:20:00.000Z',
    })]

    const forEarly = completedNflGamesForGame(all, early, earlyOdds)
    const forLate = completedNflGamesForGame(all, late, lateOdds)
    const forNight = completedNflGamesForGame(all, night, nightOdds)
    expect(mock.gameReads()).toBe(1)

    expect(forEarly.map((game) => game.id)).toEqual(expect.arrayContaining(['g-prior', 'g-so']))
    expect(forEarly.map((game) => game.id)).not.toContain('g-london')
    expect(forLate.map((game) => game.id)).toEqual(expect.arrayContaining(['g-prior', 'g-so', 'g-london']))
    expect(forNight.map((game) => game.id)).toEqual(expect.arrayContaining(['g-prior', 'g-so', 'g-london']))
  })

  test('completedNflGamesForGames still hits Game once for a three-game slate', async () => {
    const prior = finalGame()
    const early = sundayGame({ id: 'g-sun-1' })
    const late = sundayGame({ id: 'g-sun-2', date: '2025-11-16T21:15:00.000Z' })
    const night = sundayGame({ id: 'g-sun-3', date: '2025-11-17T01:20:00.000Z' })
    const mock = mockCompletedGamesClient([prior])
    const batch = await completedNflGamesForGames(mock.client, [early, late, night], {
      [early.id]: [lockQuote(early.id)],
      [late.id]: [lockQuote(late.id, {
        ts: '2025-11-16T20:15:00.000Z',
        quotedAt: '2025-11-16T20:15:00.000Z',
      })],
      [night.id]: [lockQuote(night.id, {
        ts: '2025-11-17T00:20:00.000Z',
        quotedAt: '2025-11-17T00:20:00.000Z',
      })],
    })
    expect(mock.gameReads()).toBe(1)
    expect(batch.byId[early.id].map((game) => game.id)).toEqual(['g-prior'])
    expect(batch.byId[late.id].map((game) => game.id)).toEqual(['g-prior'])
    expect(batch.byId[night.id].map((game) => game.id)).toEqual(['g-prior'])
  })
})

describe('completed-games cutoff is lock, then kickoff', () => {
  test('a final between lock and kickoff is excluded when a lock quote exists', () => {
    const game = sundayGame()
    const odds = [lockQuote(game.id)]
    const london = finalGame({
      id: 'g-london',
      date: '2025-11-16T17:20:00.000Z',
      lastUpdate: '2025-11-16T17:45:00.000Z',
      resultAvailableAt: '2025-11-16T17:45:00.000Z',
    })
    expect(pickCompletedGamesCutoff(game, odds)).toBe(LOCK)
    expect(completedNflGamesForGame([london], game, odds).map((row) => row.id)).toEqual([])
  })

  test('without a lock quote the cutoff is kickoff, so that same final is eligible', () => {
    const game = sundayGame()
    const london = finalGame({
      id: 'g-london',
      date: '2025-11-16T17:20:00.000Z',
      lastUpdate: '2025-11-16T17:45:00.000Z',
      resultAvailableAt: '2025-11-16T17:45:00.000Z',
    })
    expect(pickCompletedGamesCutoff(game, [])).toBe(KICKOFF)
    expect(completedNflGamesForGame([london], game, []).map((row) => row.id)).toEqual(['g-london'])
  })
})
