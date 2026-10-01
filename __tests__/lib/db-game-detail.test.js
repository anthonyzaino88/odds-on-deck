import { getGameDetail } from '../../lib/db.js'

function gameRow(id, overrides = {}) {
  return {
    id,
    sport: 'mlb',
    status: 'scheduled',
    date: '2026-10-01T23:00:00.000Z',
    homeId: 'NYY',
    awayId: 'BOS',
    home: { id: 'NYY', abbr: 'NYY', name: 'Yankees' },
    away: { id: 'BOS', abbr: 'BOS', name: 'Red Sox' },
    oddsApiEventId: null,
    mlbGameId: null,
    espnGameId: null,
    ...overrides,
  }
}

function createGameDetailClient({ games = [], odds = [], edges = [], props = [] } = {}) {
  const captured = {
    gameIdIns: [],
    adjacentLookups: 0,
    sameEventLookups: [],
  }

  const tables = {
    Game: games,
    Odds: odds,
    EdgeSnapshot: edges,
    PlayerPropCache: props,
  }

  function applyFilters(rows, state) {
    return rows.filter((row) => {
      for (const [col, val] of Object.entries(state.eq)) {
        if (col === 'isStale') {
          if (Boolean(row.isStale) !== Boolean(val)) return false
          continue
        }
        if (row[col] !== val) return false
      }
      for (const [col, val] of Object.entries(state.neq)) {
        if (row[col] === val) return false
      }
      for (const [col, vals] of Object.entries(state.in)) {
        if (!vals.includes(row[col])) return false
      }
      if (state.gte.date && new Date(row.date) < new Date(state.gte.date)) return false
      if (state.lte.date && new Date(row.date) > new Date(state.lte.date)) return false
      return true
    })
  }

  return {
    captured,
    from(table) {
      const state = { table, eq: {}, neq: {}, in: {}, gte: {}, lte: {} }

      const finish = () => {
        if (table === 'Game' && (state.gte.date || state.lte.date)) {
          captured.adjacentLookups += 1
        }
        for (const key of ['oddsApiEventId', 'mlbGameId', 'espnGameId']) {
          if (table === 'Game' && state.eq[key] != null) {
            captured.sameEventLookups.push({ key, value: state.eq[key] })
          }
        }
        if (state.in.gameId) {
          captured.gameIdIns.push({ table, vals: [...state.in.gameId] })
        }
        return { data: applyFilters(tables[table] || [], state), error: null }
      }

      const chain = {
        select() { return chain },
        eq(col, val) { state.eq[col] = val; return chain },
        neq(col, val) { state.neq[col] = val; return chain },
        gte(col, val) { state.gte[col] = val; return chain },
        lte(col, val) { state.lte[col] = val; return chain },
        in(col, vals) { state.in[col] = vals; return chain },
        order() { return chain },
        limit() { return chain },
        maybeSingle() {
          const { data, error } = finish()
          return Promise.resolve({ data: data[0] || null, error })
        },
        then(resolve, reject) {
          return Promise.resolve(finish()).then(resolve, reject)
        },
      }
      return chain
    },
  }
}

describe('getGameDetail sibling resolution', () => {
  const exactId = 'NYY_at_BOS_2026-10-01'
  const nextDayId = 'NYY_at_BOS_2026-10-02'
  const aliasId = 'espn_401812345'

  const exactGame = gameRow(exactId, {
    oddsApiEventId: 'evt-game-1',
    mlbGameId: '778900',
  })
  const nextDayGame = gameRow(nextDayId, {
    date: '2026-10-02T23:00:00.000Z',
    oddsApiEventId: 'evt-game-2',
    mlbGameId: '778901',
  })
  const aliasGame = gameRow(aliasId, {
    oddsApiEventId: 'evt-game-1',
    mlbGameId: '778900',
    date: '2026-10-01T23:10:00.000Z',
  })

  test('exact game with data ignores the adjacent-day game', async () => {
    const client = createGameDetailClient({
      games: [exactGame, nextDayGame],
      odds: [
        { id: 'odds-exact', gameId: exactId, market: 'h2h', ts: '2026-10-01T20:00:00.000Z' },
        { id: 'odds-next', gameId: nextDayId, market: 'h2h', ts: '2026-10-02T20:00:00.000Z' },
      ],
      edges: [
        { id: 'edge-exact', gameId: exactId, ts: '2026-10-01T20:00:00.000Z' },
        { id: 'edge-next', gameId: nextDayId, ts: '2026-10-02T20:00:00.000Z' },
      ],
      props: [
        { id: 'prop-exact', gameId: exactId, isStale: false, qualityScore: 80 },
        { id: 'prop-next', gameId: nextDayId, isStale: false, qualityScore: 90 },
      ],
    })

    const detail = await getGameDetail(exactId, client)

    expect(detail.id).toBe(exactId)
    expect(detail.odds.map((row) => row.id)).toEqual(['odds-exact'])
    expect(detail.edges.map((row) => row.id)).toEqual(['edge-exact'])
    expect(detail.playerProps.map((row) => row.id)).toEqual(['prop-exact'])
    expect(client.captured.adjacentLookups).toBe(0)
    expect(client.captured.gameIdIns.every((call) => !call.vals.includes(nextDayId))).toBe(true)
    expect(client.captured.gameIdIns.every((call) => call.vals.includes(exactId))).toBe(true)
  })

  test('no data on the exact id falls back to the sibling', async () => {
    const client = createGameDetailClient({
      games: [exactGame, nextDayGame],
      odds: [
        { id: 'odds-next', gameId: nextDayId, market: 'h2h', ts: '2026-10-02T20:00:00.000Z' },
      ],
      edges: [
        { id: 'edge-next', gameId: nextDayId, ts: '2026-10-02T20:00:00.000Z' },
      ],
      props: [
        { id: 'prop-next', gameId: nextDayId, isStale: false, qualityScore: 70 },
      ],
    })

    const detail = await getGameDetail(exactId, client)

    expect(detail.id).toBe(exactId)
    expect(detail.odds.map((row) => row.id)).toEqual(['odds-next'])
    expect(detail.edges.map((row) => row.id)).toEqual(['edge-next'])
    expect(detail.playerProps.map((row) => row.id)).toEqual(['prop-next'])
    expect(client.captured.adjacentLookups).toBe(1)
    expect(client.captured.gameIdIns.some((call) => (
      call.vals.includes(exactId) && call.vals.includes(nextDayId)
    ))).toBe(true)
  })

  test('same-event alias still included', async () => {
    const client = createGameDetailClient({
      games: [exactGame, aliasGame, nextDayGame],
      odds: [
        { id: 'odds-alias', gameId: aliasId, market: 'h2h', ts: '2026-10-01T20:00:00.000Z' },
        { id: 'odds-next', gameId: nextDayId, market: 'h2h', ts: '2026-10-02T20:00:00.000Z' },
      ],
      edges: [
        { id: 'edge-alias', gameId: aliasId, ts: '2026-10-01T20:00:00.000Z' },
      ],
      props: [
        { id: 'prop-alias', gameId: aliasId, isStale: false, qualityScore: 60 },
      ],
    })

    const detail = await getGameDetail(exactId, client)

    expect(detail.id).toBe(exactId)
    expect(detail.odds.map((row) => row.id)).toEqual(['odds-alias'])
    expect(detail.edges.map((row) => row.id)).toEqual(['edge-alias'])
    expect(detail.playerProps.map((row) => row.id)).toEqual(['prop-alias'])
    expect(client.captured.adjacentLookups).toBe(0)
    expect(client.captured.sameEventLookups).toEqual(expect.arrayContaining([
      { key: 'oddsApiEventId', value: 'evt-game-1' },
      { key: 'mlbGameId', value: '778900' },
    ]))
    expect(client.captured.gameIdIns.every((call) => call.vals.includes(aliasId))).toBe(true)
    expect(client.captured.gameIdIns.every((call) => !call.vals.includes(nextDayId))).toBe(true)
  })
})
