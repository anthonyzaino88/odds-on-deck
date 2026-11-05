import { PUBLISHED_COHORT_TAG, PUBLISHED_SOURCE, SHADOW_PUBLISHED_COHORT_TAG } from '../../lib/published-picks.js'
import {
  NFL_ALT_CREDIT_ESTIMATE,
  NFL_ALT_MARKETS,
  NFL_ALT_REGIONS,
  altMarketsForPicks,
  applyAltLinesToCacheRows,
  attachPublicAltLines,
  bestAltLinesForPick,
  cacheRowMatchesPick,
  classifyNflAltJobs,
  formatNflAltCredits,
  formatNflAltEvents,
  formatNflAltStatus,
  isMissingAltQuoteColumnError,
  isNflAltDisabled,
  isNflAltEligibleCacheProp,
  isNflAltEligiblePick,
  latestAltStampByGameId,
  loadNflAltDayState,
  nflAlternateMarketForPick,
  remainingNflAltCredits,
  recordNflAltSpend,
  resetNflAltColumnCache,
  selectNflAltJobs,
  toPublicAltLines,
} from '../../lib/nfl-alt-lines.js'

function publishedNflPick(overrides = {}) {
  return {
    id: 'pv-hurts',
    propId: 'prop-hurts',
    gameIdRef: 'DAL_at_PHI_2026-11-08',
    playerName: 'Jalen Hurts',
    propType: 'player_pass_yds',
    threshold: 224.5,
    prediction: 'over',
    odds: -110,
    edge: 0.06,
    qualityScore: 52,
    sport: 'nfl',
    source: PUBLISHED_SOURCE,
    status: 'pending',
    notes: PUBLISHED_COHORT_TAG,
    ...overrides,
  }
}

function cacheProp(overrides = {}) {
  return {
    propId: 'cache-hurts',
    gameId: 'DAL_at_PHI_2026-11-08',
    playerName: 'Jalen Hurts',
    type: 'player_pass_yds',
    pick: 'over',
    threshold: 224.5,
    odds: -110,
    edge: 0.06,
    qualityScore: 52,
    sport: 'nfl',
    gameTime: '2026-11-08T18:00:00.000Z',
    ...overrides,
  }
}

describe('nfl alt-line helpers', () => {
  beforeEach(() => {
    resetNflAltColumnCache()
  })

  test('maps official NFL alternate keys and never NHL/MLB', () => {
    expect(nflAlternateMarketForPick(publishedNflPick())).toBe('player_pass_yds_alternate')
    expect(nflAlternateMarketForPick(publishedNflPick({ propType: 'rush_yds' })))
      .toBe('player_rush_yds_alternate')
    expect(nflAlternateMarketForPick(publishedNflPick({ propType: 'player_rush_tds' })))
      .toBe('player_rush_tds_alternate')
    expect(nflAlternateMarketForPick(publishedNflPick({
      sport: 'nhl',
      propType: 'player_shots_on_goal',
    }))).toBeNull()
    expect(NFL_ALT_MARKETS).toContain('player_receptions_alternate')
    expect(NFL_ALT_MARKETS).not.toContain('player_shots_on_goal_alternate')
    expect(altMarketsForPicks([
      publishedNflPick(),
      publishedNflPick({ propType: 'player_reception_yds', playerName: 'A.J. Brown' }),
      publishedNflPick({ sport: 'nhl', propType: 'player_shots_on_goal' }),
    ])).toEqual(['player_pass_yds_alternate', 'player_reception_yds_alternate'])
  })

  test('eligibility is Published NFL only', () => {
    expect(isNflAltEligiblePick(publishedNflPick())).toBe(true)
    expect(isNflAltEligiblePick(publishedNflPick({
      notes: SHADOW_PUBLISHED_COHORT_TAG,
    }))).toBe(false)
    expect(isNflAltEligiblePick(publishedNflPick({ sport: 'nhl' }))).toBe(false)
    expect(isNflAltEligiblePick(publishedNflPick({ source: 'user_saved' }))).toBe(false)
    expect(isNflAltEligiblePick(publishedNflPick({ status: 'completed' }))).toBe(false)
    expect(isNflAltEligiblePick(publishedNflPick({ notes: null }))).toBe(false)
    expect(isNflAltEligibleCacheProp(cacheProp())).toBe(true)
    expect(isNflAltEligibleCacheProp(cacheProp({ sport: 'mlb', type: 'batter_hits' }))).toBe(false)
    expect(isNflAltEligibleCacheProp(cacheProp({
      notes: SHADOW_PUBLISHED_COHORT_TAG,
    }))).toBe(false)
    expect(isNflAltEligibleCacheProp(cacheProp({ qualityScore: 20 }))).toBe(false)
  })

  test('bestAltLinesForPick keeps the best book per line on the pick side', () => {
    const lines = bestAltLinesForPick(publishedNflPick({
      propType: 'player_reception_yds',
      playerName: 'A.J. Brown',
      prediction: 'over',
    }), [
      {
        playerName: 'A.J. Brown',
        market: 'player_reception_yds_alternate',
        pick: 'over',
        threshold: 64.5,
        odds: -110,
        book: 'FanDuel',
        last_update: '2026-11-08T14:00:00.000Z',
      },
      {
        playerName: 'A.J. Brown',
        market: 'player_reception_yds_alternate',
        pick: 'over',
        threshold: 62.5,
        odds: -135,
        book: 'DraftKings',
        last_update: '2026-11-08T14:05:00.000Z',
      },
      {
        playerName: 'A.J. Brown',
        market: 'player_reception_yds_alternate',
        pick: 'over',
        threshold: 64.5,
        odds: -105,
        book: 'BetMGM',
        last_update: '2026-11-08T14:02:00.000Z',
      },
      {
        playerName: 'A.J. Brown',
        market: 'player_reception_yds_alternate',
        pick: 'under',
        threshold: 64.5,
        odds: -110,
        book: 'FanDuel',
      },
    ])
    expect(lines).toEqual([
      {
        line: 62.5,
        side: 'over',
        price: -135,
        book: 'DraftKings',
        lastUpdate: '2026-11-08T14:05:00.000Z',
      },
      {
        line: 64.5,
        side: 'over',
        price: -105,
        book: 'BetMGM',
        lastUpdate: '2026-11-08T14:02:00.000Z',
      },
    ])
  })

  test('selectNflAltJobs enforces the daily credit cap at selection', () => {
    const jobs = [
      {
        game: { date: '2026-11-08T18:00:00.000Z' },
        markets: ['player_pass_yds_alternate', 'player_rush_yds_alternate'],
        picks: [publishedNflPick()],
      },
      {
        game: { date: '2026-11-08T21:00:00.000Z' },
        markets: ['player_reception_yds_alternate'],
        picks: [publishedNflPick({ playerName: 'A.J. Brown' })],
      },
      {
        game: { date: '2026-11-08T21:25:00.000Z' },
        markets: ['player_receptions_alternate', 'player_rush_yds_alternate', 'player_pass_tds_alternate'],
        picks: [publishedNflPick({ playerName: 'Saquon Barkley' })],
      },
    ]
    const selected = selectNflAltJobs(jobs, { maxCredits: 3 })
    expect(selected.plannedCredits).toBe(3)
    expect(selected.jobs).toHaveLength(2)
    expect(selected.skippedCap).toHaveLength(1)
    expect(NFL_ALT_REGIONS).toEqual(['us'])
  })

  test('classifyNflAltJobs skips fresh and unmapped events', () => {
    const now = new Date('2026-11-08T16:00:00.000Z')
    const classified = classifyNflAltJobs([
      {
        eventId: 'evt-1',
        gameId: 'g1',
        gameIds: ['g1'],
        picks: [publishedNflPick()],
      },
      {
        eventId: 'evt-2',
        gameId: 'g2',
        gameIds: ['g2'],
        picks: [publishedNflPick()],
      },
      {
        eventId: null,
        gameId: 'g3',
        gameIds: ['g3'],
        picks: [publishedNflPick()],
      },
    ], {
      now,
      freshMinutes: 90,
      latestAltQuotes: new Map([
        ['g1', '2026-11-08T15:00:00.000Z'],
        ['g2', '2026-11-08T13:00:00.000Z'],
      ]),
    })
    expect(classified.skippedFresh.map((job) => job.gameId)).toEqual(['g1'])
    expect(classified.skippedNoMarket.map((job) => job.gameId)).toEqual(['g3'])
    expect(classified.fetchable.map((job) => job.gameId)).toEqual(['g2'])
  })

  test('daily persist subtracts already-spent credits', () => {
    const now = new Date('2026-11-08T16:00:00.000Z')
    const state = loadNflAltDayState({ persist: false })
    const next = recordNflAltSpend(state, 16, now, { persist: false })
    expect(remainingNflAltCredits(next, now, 48)).toBe(32)
    expect(isNflAltDisabled({ ODDS_NFL_ALT: '0' })).toBe(true)
    expect(isNflAltDisabled({ ODDS_NFL_ALT_DAILY_CREDITS: '0' })).toBe(true)
    expect(isNflAltDisabled({})).toBe(false)
  })

  test('cache match writes altQuotes onto the posted-line row', () => {
    const rows = applyAltLinesToCacheRows(
      [cacheProp({ id: 'row-1', type: 'player_pass_yds' })],
      publishedNflPick({ propType: 'pass_yds' }),
      [{
        playerName: 'Jalen Hurts',
        market: 'player_pass_yds_alternate',
        pick: 'over',
        threshold: 219.5,
        odds: -115,
        book: 'FanDuel',
        last_update: '2026-11-08T14:00:00.000Z',
      }],
    )
    expect(cacheRowMatchesPick(cacheProp(), publishedNflPick({ propType: 'pass_yds' }))).toBe(true)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('row-1')
    expect(rows[0].altQuotes[0].line).toBe(219.5)
    expect(rows[0].altQuoteUpdatedAt).toBe('2026-11-08T14:00:00.000Z')
  })

  test('public altLines stay off unpublished / non-NFL / shadow rows', () => {
    const now = Date.parse('2026-11-08T16:00:00.000Z')
    const stored = [{
      line: 64.5,
      side: 'over',
      price: -110,
      book: 'FanDuel',
      lastUpdate: '2026-11-08T14:00:00.000Z',
    }]
    const publicNfl = toPublicAltLines(cacheProp({ altQuotes: stored }), { now })
    expect(publicNfl).toEqual([expect.objectContaining({
      line: 64.5,
      side: 'over',
      price: -110,
      book: 'FanDuel',
      stale: false,
    })])
    expect(toPublicAltLines(cacheProp({
      sport: 'mlb',
      type: 'batter_hits',
      altQuotes: stored,
    }), { now })).toBeNull()
    expect(toPublicAltLines(cacheProp({
      notes: SHADOW_PUBLISHED_COHORT_TAG,
      altQuotes: stored,
    }), { now })).toBeNull()
    expect(toPublicAltLines(cacheProp({
      qualityScore: 10,
      altQuotes: stored,
    }), { now })).toBeNull()
    expect(attachPublicAltLines({ playerName: 'Jalen Hurts' }, cacheProp({
      altQuotes: stored,
    }), { now }).altLines).toHaveLength(1)
    expect(latestAltStampByGameId([
      { gameId: 'g1', altQuoteUpdatedAt: '2026-11-08T13:00:00.000Z' },
      { gameId: 'g1', altQuoteUpdatedAt: '2026-11-08T15:00:00.000Z' },
    ]).get('g1')).toBe('2026-11-08T15:00:00.000Z')
    expect(formatNflAltStatus('partial')).toBe('NFL_ALT_STATUS=partial')
    expect(formatNflAltEvents(3)).toBe('NFL_ALT_EVENTS=3')
    expect(formatNflAltCredits(16)).toBe('CREDITS=16')
    expect(isMissingAltQuoteColumnError({ code: 'PGRST204', message: "Could not find the 'altQuotes' column" })).toBe(true)
    expect(isMissingAltQuoteColumnError({ code: '23502', message: 'altQuotes' })).toBe(false)
    expect(NFL_ALT_CREDIT_ESTIMATE.dailyCap).toBe(48)
    expect(NFL_ALT_CREDIT_ESTIMATE.worstEveryDayMonthCredits).toBeLessThan(16500 - 10500)
  })
})
