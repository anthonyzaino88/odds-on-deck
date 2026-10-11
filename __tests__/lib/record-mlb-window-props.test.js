import {
  parseRecordMlbWindowArgs,
  runRecordMlbWindowProps,
} from '../../scripts/record-mlb-window-props.js'

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
  }
}

function fakeClient({ games = [], props = [] } = {}) {
  return {
    from(table) {
      const result = table === 'Game'
        ? { data: games, error: null }
        : { data: props, error: null }
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        gte: () => query,
        gt: () => query,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      }
      return query
    },
  }
}

const FIRST_PITCH = '2026-10-11T23:10:00.000Z'

describe('record-mlb-window-props CLI', () => {
  test('parses help and postseason', () => {
    expect(parseRecordMlbWindowArgs(['--help']).help).toBe(true)
    expect(parseRecordMlbWindowArgs(['--postseason']).postseason).toBe(true)
    expect(parseRecordMlbWindowArgs([]).postseason).toBe(false)
  })

  test('no-ops during :05–:15 ET without writing', async () => {
    const log = memoryLog()
    const result = await runRecordMlbWindowProps({
      argv: [],
      now: new Date('2026-10-11T16:09:00.000Z'),
      createClient: () => { throw new Error('should not connect') },
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.skippedQuiet).toBe(true)
    expect(log.lines.join('\n')).toMatch(/quiet period/)
  })

  test('no-ops outside 11–22 ET recording hours', async () => {
    const result = await runRecordMlbWindowProps({
      argv: [],
      now: new Date('2026-07-15T14:16:00.000Z'), // 10:16 ET
      createClient: () => { throw new Error('should not connect') },
      log: memoryLog(),
    })
    expect(result.exitCode).toBe(0)
    expect(result.skippedHours).toBe(true)
  })

  test('--help does not connect', async () => {
    const result = await runRecordMlbWindowProps({
      argv: ['--help'],
      createClient: () => { throw new Error('should not connect') },
      log: memoryLog(),
    })
    expect(result.exitCode).toBe(0)
  })

  test('records only lineup-confirmed props in the window', async () => {
    const games = [{
      id: 'NYY_at_BOS_2026-10-11',
      sport: 'mlb',
      date: FIRST_PITCH,
      status: 'scheduled',
      mlbGameId: '778899',
    }]
    const props = [
      {
        sport: 'mlb',
        playerName: 'Aaron Judge',
        type: 'batter_hits',
        pick: 'over',
        threshold: 0.5,
        odds: -110,
        edge: 0.04,
        qualityScore: 42,
        gameId: 'NYY_at_BOS_2026-10-11',
      },
      {
        sport: 'mlb',
        playerName: 'Bench Bat',
        type: 'batter_hits',
        pick: 'over',
        threshold: 0.5,
        odds: -110,
        edge: 0.05,
        qualityScore: 44,
        gameId: 'NYY_at_BOS_2026-10-11',
      },
    ]
    const saved = []
    const log = memoryLog()
    const result = await runRecordMlbWindowProps({
      argv: [],
      now: new Date('2026-10-11T22:20:00.000Z'),
      createClient: () => fakeClient({ games, props }),
      fetchLineup: async () => ({
        batters: [{ fullName: 'Aaron Judge' }],
        pitchers: [],
        probableHome: { fullName: 'Gerrit Cole' },
        probableAway: null,
      }),
      persistPublished: async (rows) => {
        saved.push(...rows)
        return rows
      },
      generateFeatured: async () => [],
      persistFeatured: async () => [],
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(saved).toHaveLength(1)
    expect(saved[0].playerName).toBe('Aaron Judge')
    expect(result.recordable).toHaveLength(1)
  })

  test('skips both games of a same-day doubleheader', async () => {
    const games = [
      {
        id: 'NYY_at_BOS_2026-10-11',
        sport: 'mlb',
        date: FIRST_PITCH,
        status: 'scheduled',
        mlbGameId: '778801',
      },
      {
        id: 'NYY_at_BOS_2026-10-11_g2',
        sport: 'mlb',
        date: '2026-10-11T23:40:00.000Z',
        status: 'scheduled',
        mlbGameId: '778802',
      },
    ]
    const persistPublished = jest.fn(async (rows) => rows)
    const generateFeatured = jest.fn(async () => [])
    const log = memoryLog()
    const result = await runRecordMlbWindowProps({
      argv: [],
      now: new Date('2026-10-11T22:20:00.000Z'),
      createClient: () => fakeClient({
        games,
        props: [{
          sport: 'mlb',
          playerName: 'Aaron Judge',
          type: 'batter_hits',
          pick: 'over',
          threshold: 0.5,
          odds: -110,
          edge: 0.04,
          qualityScore: 42,
          gameId: 'NYY_at_BOS_2026-10-11',
        }],
      }),
      fetchLineup: async () => ({ batters: [{ fullName: 'Aaron Judge' }], pitchers: [] }),
      persistPublished,
      generateFeatured,
      persistFeatured: async () => [],
      log,
    })
    expect(result.windowGames).toHaveLength(0)
    expect(result.skippedDoubleheaders).toHaveLength(2)
    expect(persistPublished).not.toHaveBeenCalled()
    expect(generateFeatured).not.toHaveBeenCalled()
    expect(log.lines.join('\n')).toMatch(/doubleheader/)
  })

  test('asks Featured for one single-game card per in-window game', async () => {
    const games = [
      {
        id: 'NYY_at_BOS_2026-10-11',
        sport: 'mlb',
        date: FIRST_PITCH,
        status: 'scheduled',
        mlbGameId: '778899',
      },
      {
        id: 'TOR_at_BAL_2026-10-11',
        sport: 'mlb',
        date: FIRST_PITCH,
        status: 'scheduled',
        mlbGameId: '778900',
      },
    ]
    const featuredCalls = []
    await runRecordMlbWindowProps({
      argv: [],
      now: new Date('2026-10-11T22:20:00.000Z'),
      createClient: () => fakeClient({ games, props: [] }),
      fetchLineup: async () => ({ batters: [{ fullName: 'Aaron Judge' }], pitchers: [] }),
      persistPublished: async (rows) => rows,
      generateFeatured: async (opts) => {
        featuredCalls.push(opts)
        return []
      },
      persistFeatured: async () => [],
      log: memoryLog(),
    })
    expect(featuredCalls).toEqual([
      expect.objectContaining({
        type: 'single_game',
        gameId: 'NYY_at_BOS_2026-10-11',
        gameIds: ['NYY_at_BOS_2026-10-11'],
      }),
      expect.objectContaining({
        type: 'single_game',
        gameId: 'TOR_at_BAL_2026-10-11',
        gameIds: ['TOR_at_BAL_2026-10-11'],
      }),
      expect.objectContaining({
        type: 'multi_game',
        gameIds: ['NYY_at_BOS_2026-10-11', 'TOR_at_BAL_2026-10-11'],
      }),
    ])
  })
})
