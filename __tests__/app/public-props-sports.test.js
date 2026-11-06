const fs = require('fs')
const path = require('path')

const { GET: getProps } = require('../../app/api/props/route.js')
const { generateSimpleParlays } = require('../../lib/simple-parlay-generator.js')
const { getTopProps } = require('../../lib/top-props.js')
const { PUBLISHED_SPORTS, SHADOW_PUBLISHED_COHORT_TAG } = require('../../lib/published-picks.js')

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
  const resolved = {
    data: (data || []).map((row) => (
      row && row.fetchedAt ? row : { ...row, fetchedAt: new Date().toISOString() }
    )),
    error: null,
  }
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

  test('sport=nhl queries the cache and returns NHL props', async () => {
    const captured = { ins: [], eqs: [] }
    supabase.from.mockReturnValue(thenableQuery([
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

    const res = await getProps(new Request('http://localhost/api/props?sport=nhl'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(supabase.from).toHaveBeenCalledWith('PlayerPropCache')
    expect(captured.eqs).toEqual(expect.arrayContaining([
      { col: 'sport', val: 'nhl' },
    ]))
    expect(body.success).toBe(true)
    expect(body.count).toBe(1)
    expect(body.props.map((prop) => prop.playerName)).toEqual(['Auston Matthews'])
    expect(body.props[0].quotes).toBeNull()
    expect(body.props[0].numBooks).toBeNull()
    expect(body.props[0].bestBook).toBeNull()
  })

  test('unlisted sport returns nothing', async () => {
    const res = await getProps(new Request('http://localhost/api/props?sport=nba'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.props).toEqual([])
    expect(body.count).toBe(0)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  test('all queries PUBLISHED_SPORTS and keeps NHL alongside MLB', async () => {
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
    expect(PUBLISHED_SPORTS).toEqual(['mlb', 'nfl', 'nhl'])
    expect(body.success).toBe(true)
    expect(body.count).toBe(2)
    expect(body.props.map((prop) => prop.playerName)).toEqual(['Aaron Judge', 'Auston Matthews'])
    expect(body.props.some((prop) => prop.sport === 'nhl')).toBe(true)
  })

  test('drops a stale alt placeholder even when its odds are inside 1.25–15', async () => {
    const captured = { ins: [], eqs: [] }
    supabase.from.mockReturnValue(thenableQuery([
      {
        propId: 'prop-hurts',
        gameId: 'DAL_at_PHI_2026-11-08',
        playerName: 'Jalen Hurts',
        type: 'player_pass_yds',
        pick: 'over',
        threshold: 224.5,
        odds: 1.91,
        edge: 0,
        qualityScore: 0,
        confidence: 'low',
        sport: 'nfl',
        isStale: true,
      },
      {
        propId: 'nfl-live',
        gameId: 'DAL_at_PHI_2026-11-08',
        playerName: 'A.J. Brown',
        type: 'player_receptions',
        pick: 'over',
        threshold: 5.5,
        odds: 1.91,
        sport: 'nfl',
        isStale: false,
      },
    ], captured))

    const res = await getProps(new Request('http://localhost/api/props?sport=nfl'))
    const body = await res.json()
    expect(captured.eqs).toEqual(expect.arrayContaining([
      { col: 'isStale', val: false },
    ]))
    expect(body.props.map((prop) => prop.playerName)).toEqual(['A.J. Brown'])
  })

  test('returns shop fields, hides a null ladder, and drops shadow NHL', async () => {
    const captured = { ins: [], eqs: [] }
    supabase.from.mockReturnValue(thenableQuery([
      {
        propId: 'mlb-shop',
        gameId: 'NYY_at_BOS_2026-11-04',
        playerName: 'Aaron Judge',
        type: 'batter_hits',
        pick: 'over',
        threshold: 1.5,
        odds: 2.10,
        probability: 0.52,
        edge: 0.03,
        sport: 'mlb',
        bookmaker: 'DraftKings',
        numBooks: 2,
        gameTime: '2026-11-04T23:00:00.000Z',
        quotes: [
          { book: 'FanDuel', decimal: 2.00, american: 100, lastUpdate: '2026-11-04T17:00:00.000Z' },
          { book: 'DraftKings', decimal: 2.10, american: 110, lastUpdate: '2026-11-04T17:05:00.000Z' },
        ],
      },
      {
        propId: 'nhl-shadow',
        gameId: 'BOS_at_TOR_2026-11-04',
        playerName: 'Private Shadow',
        type: 'player_shots_on_goal',
        pick: 'over',
        threshold: 3.5,
        odds: 1.91,
        sport: 'nhl',
        notes: SHADOW_PUBLISHED_COHORT_TAG,
      },
    ], captured))

    const res = await getProps(new Request('http://localhost/api/props'))
    const body = await res.json()
    expect(body.props.map((prop) => prop.playerName)).toEqual(['Aaron Judge'])
    expect(body.props[0].bestBook).toBe('DraftKings')
    expect(body.props[0].numBooks).toBe(2)
    expect(body.props[0].quotes).toHaveLength(2)
    expect(body.props[0].consensusOdds).toBeCloseTo(1 / 0.52, 5)
    expect(body.props[0].altLines).toBeNull()
    expect(body.count).toBe(1)
  })

  test('Published NFL cache rows expose altLines; unpublished and NHL do not', async () => {
    const captured = { ins: [], eqs: [] }
    supabase.from.mockReturnValue(thenableQuery([
      {
        propId: 'nfl-pub',
        gameId: 'DAL_at_PHI_2026-11-08',
        playerName: 'Jalen Hurts',
        type: 'player_pass_yds',
        pick: 'over',
        threshold: 224.5,
        odds: 1.91,
        probability: 0.54,
        edge: 0.06,
        qualityScore: 52,
        sport: 'nfl',
        gameTime: '2026-11-08T21:00:00.000Z',
        altQuotes: [
          { line: 219.5, side: 'over', price: -115, book: 'FanDuel', lastUpdate: '2026-11-08T16:00:00.000Z' },
          { line: 224.5, side: 'over', price: -110, book: 'DraftKings', lastUpdate: '2026-11-08T16:00:00.000Z' },
        ],
      },
      {
        propId: 'nfl-low',
        gameId: 'DAL_at_PHI_2026-11-08',
        playerName: 'Backup QB',
        type: 'player_pass_yds',
        pick: 'over',
        threshold: 180.5,
        odds: 1.91,
        edge: 0.01,
        qualityScore: 10,
        sport: 'nfl',
        altQuotes: [
          { line: 175.5, side: 'over', price: -110, book: 'FanDuel', lastUpdate: '2026-11-08T16:00:00.000Z' },
        ],
      },
      {
        propId: 'nhl-1',
        gameId: 'BOS_at_TOR_2026-11-08',
        playerName: 'Auston Matthews',
        type: 'player_shots_on_goal',
        pick: 'over',
        threshold: 3.5,
        odds: 1.91,
        edge: 0.06,
        qualityScore: 52,
        sport: 'nhl',
        altQuotes: [
          { line: 2.5, side: 'over', price: -120, book: 'FanDuel', lastUpdate: '2026-11-08T16:00:00.000Z' },
        ],
      },
    ], captured))

    const res = await getProps(new Request('http://localhost/api/props'))
    const body = await res.json()
    expect(body.props.map((prop) => prop.playerName)).toEqual([
      'Jalen Hurts',
      'Backup QB',
      'Auston Matthews',
    ])
    expect(body.props[0].altLines).toEqual([
      expect.objectContaining({ line: 219.5, side: 'over', price: -115, book: 'FanDuel' }),
      expect.objectContaining({ line: 224.5, side: 'over', price: -110, book: 'DraftKings' }),
    ])
    expect(body.props[1].altLines).toBeNull()
    expect(body.props[2].altLines).toBeNull()
  })

  test('getTopProps(nhl) queries the cache', async () => {
    supabase.from.mockReturnValue(thenableQuery([
      {
        propId: 'nhl-1',
        gameId: 'BOS_at_TOR_2026-11-02',
        playerName: 'Auston Matthews',
        type: 'player_shots_on_goal',
        pick: 'over',
        threshold: 3.5,
        odds: 1.91,
        sport: 'nhl',
        qualityScore: 55,
      },
    ], { ins: [], eqs: [] }))

    const rows = await getTopProps('nhl')
    expect(supabase.from).toHaveBeenCalledWith('PlayerPropCache')
    expect(rows).toHaveLength(1)
    expect(rows[0].playerName).toBe('Auston Matthews')
  })
})

describe('public props / parlay surfaces offer NHL', () => {
  test('props page filter is All + PUBLISHED_SPORTS including NHL', () => {
    const page = read('app/props/page.js')
    expect(page).toMatch(/PUBLISHED_SPORTS/)
    expect(page).toMatch(/nhl: 'NHL'/)
  })

  test('PlayerPropsFilter renders an NHL props section and NHL type tables', () => {
    const filter = read('components/PlayerPropsFilter.js')
    expect(filter).toMatch(/nhlProps/)
    expect(filter).toMatch(/title="NHL Props"/)
    expect(filter).toMatch(/key: 'nhl'/)
    expect(filter).toMatch(/sport: 'nhl'/)
    expect(filter).toMatch(/player_shots_on_goal/)
    expect(filter).toMatch(/player_blocked_shots/)
  })

  test('sport hubs load top props for public sports including NHL', () => {
    const hub = read('components/SportHub.js')
    const top = read('lib/top-props.js')
    expect(hub).toMatch(/getTopProps\(sport/)
    expect(top).toMatch(/isPublicPropSport/)
    expect(top).not.toMatch(/VALID_SPORTS/)
    expect(top).toMatch(/mlb \/ nfl \/ nhl/)
  })

  test('props API uses PUBLISHED_SPORTS and early-returns non-public sports', () => {
    const route = read('app/api/props/route.js')
    expect(route).toMatch(/PUBLISHED_SPORTS/)
    expect(route).toMatch(/isPublicPropSport/)
    expect(route).toMatch(/isShadowPublishedCohort/)
    expect(route).toMatch(/toPublicPropsApiRow/)
    expect(route).toMatch(/\.in\('sport', PUBLISHED_SPORTS\)/)
  })

  test('public shop copy does not claim 10+ sportsbooks or real-time odds', () => {
    const copyFiles = [
      'app/props/page.js',
      'app/parlays/page.js',
      'app/layout.js',
      'app/props/layout.js',
      'app/games/layout.js',
      'components/HomeMarketing.js',
      'components/ParlayBuilder.js',
      'components/ParlayResults.js',
      'lib/glossary.js',
    ]
    for (const rel of copyFiles) {
      const src = read(rel)
      expect(src).not.toMatch(/10\+ sportsbooks/)
      expect(src).not.toMatch(/10\+ books/)
      expect(src).not.toMatch(/all of them/)
      expect(src).not.toMatch(/Real-time/)
      expect(src).not.toMatch(/real-time odds/)
    }
    const filter = read('components/PlayerPropsFilter.js')
    const shopMeta = read('components/LineShopMeta.js')
    expect(filter).toMatch(/LineShopMeta/)
    expect(shopMeta).toMatch(/Array\.isArray\(prop\?\.quotes\) && prop\.quotes\.length > 0/)
    expect(read('components/DataFreshness.js')).toMatch(/Quotes as of/)
    expect(read('app/api/refresh-status/route.js')).toMatch(/getLatestOddsFreshness/)
    expect(read('app/api/refresh-status/route.js')).toMatch(/console\.error\('getLatestOddsFreshness:/)
  })

  test('parlay explorer uses public sports including NHL', () => {
    const generator = read('lib/simple-parlay-generator.js')
    expect(generator).toMatch(/const publicSports = featuredSportsFor\(sport\)/)
    expect(generator).toMatch(/if \(publicSports\.length === 0\) return \[\]/)
    expect(generator).toMatch(/\.in\('sport', publicSports\)/)
    expect(generator).not.toMatch(/query = query\.eq\('sport', sport\)/)
  })

  test('ParlayBuilder restores Hockey Only and can auto-select NHL', () => {
    const builder = read('components/ParlayBuilder.js')
    expect(builder).toMatch(/Hockey Only/)
    expect(builder).toMatch(/value="nhl"/)
    expect(builder).toMatch(/NHL props/)
    expect(builder).toMatch(/nhl: \(result\.data\.nhl/)
  })

  test('generateSimpleParlays sport=nhl queries instead of early-returning empty', async () => {
    const captured = { ins: [], eqs: [] }
    supabase.from.mockReturnValue(thenableQuery([], captured))
    await expect(generateSimpleParlays({ sport: 'nhl' })).resolves.toEqual([])
    expect(supabase.from).toHaveBeenCalled()
    expect(captured.ins).toEqual(expect.arrayContaining([
      { col: 'sport', vals: ['nhl'] },
    ]))
  })
})
