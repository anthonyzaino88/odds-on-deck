import { readFileSync } from 'fs'
import { join } from 'path'

jest.mock('../../lib/supabase.js', () => ({
  isSupabaseAdminConfigured: jest.fn(() => true),
  isUsableSupabase: jest.fn(() => true),
  supabase: { from: jest.fn() },
}))

const { GET: getProps } = require('../../app/api/props/route.js')
const { generateEditorPicks } = require('../../lib/picks.js')
const { fetchUpcomingPublishedProps } = require('../../lib/homepage-hook.js')
const { getTopProps } = require('../../lib/top-props.js')
const { generateSimpleParlays } = require('../../lib/simple-parlay-generator.js')
const { supabase } = require('../../lib/supabase.js')
const { PUBLIC_PROP_FRESHNESS_MS } = require('../../lib/live-odds-landing.js')
const { canonicalPlayerPropCacheId } = require('../../lib/published-picks.js')

const NOW = Date.now()
const FUTURE = new Date(NOW + 36 * 60 * 60 * 1000).toISOString()
const RETAINED = new Date(NOW + 48 * 60 * 60 * 1000).toISOString()
const FRESH_AT = new Date(NOW - 60 * 60 * 1000).toISOString()
const OLD_AT = new Date(NOW - PUBLIC_PROP_FRESHNESS_MS - 60 * 60 * 1000).toISOString()

function chain(data, captured) {
  const query = {
    select: () => query,
    in: () => query,
    eq: () => query,
    gt: () => query,
    lt: () => query,
    gte: (col, val) => {
      captured.push({ col, val })
      return query
    },
    order: () => query,
    limit: () => query,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (ok, err) => Promise.resolve({ data, error: null }).then(ok, err),
  }
  return query
}

function install(cacheRows) {
  const captured = []
  supabase.from.mockImplementation((table) => (
    chain(table === 'PlayerPropCache' ? cacheRows : [], captured)
  ))
  return captured
}

function row(overrides) {
  return {
    propId: overrides.playerName,
    gameId: overrides.gameId || 'DAL_at_PHI_2026-11-08',
    playerName: overrides.playerName,
    team: 'PHI',
    type: 'player_pass_yds',
    pick: 'over',
    threshold: 224.5,
    odds: overrides.odds,
    probability: 0.55,
    edge: 0.06,
    qualityScore: 48,
    confidence: 'medium',
    sport: 'nfl',
    isStale: false,
    bookmaker: 'DraftKings',
    numBooks: 3,
    gameTime: FUTURE,
    expiresAt: RETAINED,
    fetchedAt: overrides.fetchedAt,
  }
}

function freshAndOld({ odds, games = false } = {}) {
  const fresh = row({
    playerName: 'Fresh Price',
    odds,
    fetchedAt: FRESH_AT,
    gameId: games ? 'GB_at_CHI_2026-11-08' : undefined,
  })
  const old = row({
    playerName: 'Old Price',
    odds,
    fetchedAt: OLD_AT,
    gameId: games ? 'KC_at_DEN_2026-11-08' : undefined,
  })
  return [fresh, old]
}

function expectFetchedAtGate(captured) {
  const hit = captured.find((call) => call.col === 'fetchedAt')
  expect(hit).toBeTruthy()
  expect(Math.abs(Date.now() - Date.parse(hit.val) - PUBLIC_PROP_FRESHNESS_MS)).toBeLessThan(5000)
}

describe('public prop freshness is fetchedAt, not expiresAt', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('/api/props hides an old pregame price that has not expired', async () => {
    const captured = install(freshAndOld({ odds: 1.91 }))
    const res = await getProps(new Request('http://localhost/api/props?sport=nfl'))
    const body = await res.json()
    expect(body.props.map((prop) => prop.playerName)).toEqual(['Fresh Price'])
    expectFetchedAtGate(captured)
  })

  test("Editor's hides an old pregame price that has not expired", async () => {
    const captured = install(freshAndOld({ odds: -110 }))
    const picks = await generateEditorPicks()
    expect(picks.map((pick) => pick.playerName)).toEqual(['Fresh Price'])
    expectFetchedAtGate(captured)
  })

  test('homepage hides an old pregame price that has not expired', async () => {
    const captured = install(freshAndOld({ odds: -110 }))
    const { props } = await fetchUpcomingPublishedProps()
    expect(props.map((prop) => prop.playerName)).toEqual(['Fresh Price'])
    expectFetchedAtGate(captured)
  })

  test('sport-hub top props hide an old pregame price that has not expired', async () => {
    const captured = install(freshAndOld({ odds: 1.91 }))
    const rows = await getTopProps('nfl')
    expect(rows.map((prop) => prop.playerName)).toEqual(['Fresh Price'])
    expectFetchedAtGate(captured)
  })

  test('featured and explorer parlays omit an old pregame price', async () => {
    const legs = [
      row({ playerName: 'Fresh One', odds: -110, fetchedAt: FRESH_AT, gameId: 'GB_at_CHI_2026-11-08' }),
      row({ playerName: 'Fresh Two', odds: -110, fetchedAt: FRESH_AT, gameId: 'KC_at_DEN_2026-11-08' }),
      row({ playerName: 'Fresh Three', odds: -110, fetchedAt: FRESH_AT, gameId: 'DAL_at_PHI_2026-11-08' }),
      row({ playerName: 'Old Price', odds: -110, fetchedAt: OLD_AT, gameId: 'BUF_at_MIA_2026-11-08' }),
    ]
    const featuredCapture = install(legs)
    const featured = await generateSimpleParlays({ sport: 'nfl', featured: true, legCount: 3 })
    const featuredNames = featured.flatMap((parlay) => parlay.legs.map((leg) => leg.playerName))
    expect(featuredNames).toEqual(expect.arrayContaining(['Fresh One', 'Fresh Two', 'Fresh Three']))
    expect(featuredNames).not.toContain('Old Price')
    expectFetchedAtGate(featuredCapture)

    const explorerCapture = install(legs)
    const explorer = await generateSimpleParlays({
      sport: 'nfl',
      featured: false,
      legCount: 3,
      minConfidence: 'low',
    })
    const explorerNames = explorer.flatMap((parlay) => parlay.legs.map((leg) => leg.playerName))
    expect(explorerNames).toEqual(expect.arrayContaining(['Fresh One', 'Fresh Two', 'Fresh Three']))
    expect(explorerNames).not.toContain('Old Price')
    expectFetchedAtGate(explorerCapture)
  })
})

describe('cache prop ids keep the legacy market key', () => {
  test('*_alternate is not stripped, so a refetch updates the existing row', () => {
    const market = 'player_pass_yds_alternate'
    const legacy = `DAL_at_PHI_2026-11-08-Jalen Hurts-${market}-224.5-over`
    expect(canonicalPlayerPropCacheId({
      gameId: 'DAL_at_PHI_2026-11-08',
      playerName: 'Jalen Hurts',
      type: market,
      threshold: 224.5,
      pick: 'over',
    })).toBe(legacy)
    expect(canonicalPlayerPropCacheId({
      gameId: 'DAL_at_PHI_2026-11-08',
      playerName: 'Jalen Hurts',
      type: 'player_pass_yds',
      threshold: 224.5,
      pick: 'over',
    })).toBe('DAL_at_PHI_2026-11-08-Jalen Hurts-player_pass_yds-224.5-over')
    const src = readFileSync(join(process.cwd(), 'scripts/fetch-live-odds.js'), 'utf8')
    expect(src).toMatch(/type: market\.key/)
    expect(src).not.toMatch(/slice\(0, -'_alternate'\.length\)/)
  })
})
