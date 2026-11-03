const fs = require('fs')
const path = require('path')

const { GET: getProps } = require('../../app/api/props/route.js')
const { generateSimpleParlays } = require('../../lib/simple-parlay-generator.js')
const { getTopProps } = require('../../lib/top-props.js')
const { PUBLISHED_SPORTS } = require('../../lib/published-picks.js')

jest.mock('../../lib/supabase.js', () => ({
  isSupabaseAdminConfigured: jest.fn(() => true),
  isUsableSupabase: jest.fn(() => true),
  supabase: {
    from: jest.fn(),
  },
}))

const { supabase, isSupabaseAdminConfigured } = require('../../lib/supabase.js')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

function thenableQuery(data, captured) {
  const resolved = { data, error: null }
  const chain = {}
  const self = () => chain
  Object.assign(chain, {
    select: jest.fn(self),
    in: jest.fn((col, vals) => {
      captured.ins.push({ col, vals })
      return chain
    }),
    eq: jest.fn((col, val) => {
      captured.eqs.push({ col, val })
      return chain
    }),
    order: jest.fn(self),
    limit: jest.fn(self),
    gte: jest.fn(self),
    gt: jest.fn(self),
    then: (onFulfilled, onRejected) => Promise.resolve(resolved).then(onFulfilled, onRejected),
  })
  return chain
}

describe('GET /api/props stays on public sports', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isSupabaseAdminConfigured.mockReturnValue(true)
  })

  test('sport=nhl returns nothing and does not query the cache', async () => {
    const res = await getProps(new Request('http://localhost/api/props?sport=nhl'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, props: [], count: 0 })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  test('unlisted sport returns nothing', async () => {
    const res = await getProps(new Request('http://localhost/api/props?sport=nba'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.props).toEqual([])
    expect(body.count).toBe(0)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  test('all / mlb queries only PUBLISHED_SPORTS and drops a leaked NHL row', async () => {
    const captured = { ins: [], eqs: [] }
    supabase.from.mockReturnValue(thenableQuery([
      {
        propId: 'mlb-1',
        gameId: 'NYY_at_BOS_2026-11-02',
        playerName: 'Aaron Judge',
        type: 'batter_hits',
        pick: 'over',
        threshold: 1.5,
        odds: 1.91,
        sport: 'mlb',
      },
      {
        propId: 'nhl-1',
        gameId: 'BOS_at_TOR_2026-11-02',
        playerName: 'Auston Matthews',
        type: 'player_shots_on_goal',
        pick: 'over',
        threshold: 3.5,
        odds: 1.91,
        sport: 'nhl',
      },
    ], captured))

    const res = await getProps(new Request('http://localhost/api/props'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(supabase.from).toHaveBeenCalledWith('PlayerPropCache')
    expect(captured.ins).toEqual(expect.arrayContaining([
      { col: 'sport', vals: PUBLISHED_SPORTS },
    ]))
    expect(body.success).toBe(true)
    expect(body.count).toBe(1)
    expect(body.props.map((prop) => prop.playerName)).toEqual(['Aaron Judge'])
    expect(body.props.some((prop) => prop.sport === 'nhl')).toBe(false)
  })

  test('getTopProps(nhl) returns nothing and does not query the cache', async () => {
    await expect(getTopProps('nhl')).resolves.toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('public props / parlay surfaces do not offer NHL', () => {
  test('props page filter is All + PUBLISHED_SPORTS — no NHL button', () => {
    const page = read('app/props/page.js')
    expect(page).toMatch(/PUBLISHED_SPORTS/)
    expect(page).not.toMatch(/value: 'nhl'/)
    expect(page).not.toMatch(/label: 'NHL'/)
  })

  test('PlayerPropsFilter does not render an NHL props section or keep NHL type tables', () => {
    const filter = read('components/PlayerPropsFilter.js')
    expect(filter).not.toMatch(/nhlProps/)
    expect(filter).not.toMatch(/title="NHL Props"/)
    expect(filter).not.toMatch(/key: 'nhl'/)
    expect(filter).not.toMatch(/sport: 'nhl'/)
    expect(filter).not.toMatch(/player_shots_on_goal/)
    expect(filter).not.toMatch(/player_blocked_shots/)
  })

  test('sport hubs load top props only for public sports', () => {
    const hub = read('components/SportHub.js')
    const top = read('lib/top-props.js')
    expect(hub).toMatch(/getTopProps\(sport/)
    expect(top).toMatch(/isPublicPropSport/)
    expect(top).not.toMatch(/VALID_SPORTS/)
    expect(top).not.toMatch(/'nhl'/)
  })

  test('props API uses PUBLISHED_SPORTS and early-returns non-public sports', () => {
    const route = read('app/api/props/route.js')
    expect(route).toMatch(/PUBLISHED_SPORTS/)
    expect(route).toMatch(/isPublicPropSport/)
    expect(route).toMatch(/\.in\('sport', PUBLISHED_SPORTS\)/)
    expect(route).not.toMatch(/'mlb', 'nfl', 'nhl'/)
  })

  test('parlay explorer refuses NHL and mixed does not include it', () => {
    const generator = read('lib/simple-parlay-generator.js')
    expect(generator).toMatch(/const publicSports = featuredSportsFor\(sport\)/)
    expect(generator).toMatch(/if \(publicSports\.length === 0\) return \[\]/)
    expect(generator).toMatch(/\.in\('sport', publicSports\)/)
    expect(generator).not.toMatch(/query = query\.eq\('sport', sport\)/)
  })

  test('ParlayBuilder drops Hockey Only and does not auto-select NHL', () => {
    const builder = read('components/ParlayBuilder.js')
    expect(builder).not.toMatch(/Hockey Only/)
    expect(builder).not.toMatch(/value="nhl"/)
    expect(builder).not.toMatch(/NHL props/)
    expect(builder).toMatch(/Mix MLB and NFL props/)
    expect(builder).not.toMatch(/nhl: \(result\.data\.nhl/)
  })

  test('generateSimpleParlays sport=nhl returns nothing', async () => {
    await expect(generateSimpleParlays({ sport: 'nhl' })).resolves.toEqual([])
  })
})
