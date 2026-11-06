jest.mock('../../lib/supabase-admin.js', () => ({
  supabaseAdmin: { from: jest.fn() },
}))

const { supabaseAdmin } = require('../../lib/supabase-admin.js')
const { getCachedProps } = require('../../lib/prop-cache-manager.js')
const { PUBLIC_PROP_FRESHNESS_MS } = require('../../lib/live-odds-landing.js')

function chain(data, captured) {
  const query = {
    select: () => query,
    eq: () => query,
    gte: (col, val) => {
      captured.push({ col, val })
      return query
    },
    gt: () => query,
    lt: () => query,
    then: (ok, err) => Promise.resolve({ data, error: null }).then(ok, err),
  }
  return query
}

describe('getCachedProps public freshness', () => {
  test('hides an unexpired pregame price fetched more than 24h ago', async () => {
    const now = Date.now()
    const gameTime = new Date()
    gameTime.setHours(12, 0, 0, 0)
    const captured = []
    const rows = [
      {
        propId: 'old',
        gameId: 'g1',
        playerName: 'Old Price',
        team: 'PHI',
        type: 'player_pass_yds',
        pick: 'over',
        threshold: 224.5,
        odds: -110,
        sport: 'nfl',
        isStale: false,
        gameTime: gameTime.toISOString(),
        expiresAt: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
        fetchedAt: new Date(now - PUBLIC_PROP_FRESHNESS_MS - 60 * 60 * 1000).toISOString(),
      },
      {
        propId: 'fresh',
        gameId: 'g1',
        playerName: 'Fresh Price',
        team: 'PHI',
        type: 'player_pass_yds',
        pick: 'over',
        threshold: 249.5,
        odds: -110,
        sport: 'nfl',
        isStale: false,
        gameTime: gameTime.toISOString(),
        expiresAt: new Date(now + 20 * 60 * 60 * 1000).toISOString(),
        fetchedAt: new Date(now - 60 * 60 * 1000).toISOString(),
      },
    ]
    supabaseAdmin.from.mockImplementation(() => chain(rows, captured))

    const result = await getCachedProps('nfl')
    expect(result.hasFreshCache).toBe(true)
    expect(result.props.map((prop) => prop.playerName)).toEqual(['Fresh Price'])
    const fetchedAt = captured.find((call) => call.col === 'fetchedAt')
    expect(fetchedAt).toBeTruthy()
    expect(Math.abs(Date.now() - Date.parse(fetchedAt.val) - PUBLIC_PROP_FRESHNESS_MS)).toBeLessThan(5000)
  })
})
