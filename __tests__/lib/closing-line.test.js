import {
  CLOSE_CAPTURE_WINDOW_MINUTES,
  CLOSE_ODDS_FIELDS,
  buildEventOddsUrl,
  closeCapturePayload,
  clvFromOdds,
  estimateCloseCaptureCalls,
  estimateCloseCaptureCost,
  flattenEventOddsQuotes,
  gameIsInCloseWindow,
  hasCloseAlready,
  isOpsWriteQuietPeriod,
  marketsForPublishedPicks,
  matchClosingQuote,
  oddsApiSportKey,
  parseOddsApiQuota,
  publishedMarketKey,
  resetCloseColumnCache,
  summarizePublishedClv,
  updateWithOptionalCloseOdds,
  withoutCloseOddsFields,
} from '../../lib/closing-line.js'

beforeEach(() => {
  resetCloseColumnCache()
})

describe('odds API market mapping', () => {
  test('maps published prop types to Odds API market keys', () => {
    expect(publishedMarketKey('batter_hits')).toBe('batter_hits')
    expect(publishedMarketKey('hits')).toBe('batter_hits')
    expect(publishedMarketKey('pitcher_strikeouts')).toBe('pitcher_strikeouts')
    expect(publishedMarketKey('receptions')).toBe('player_receptions')
    expect(publishedMarketKey('rec_yds')).toBe('player_reception_yds')
    expect(oddsApiSportKey('MLB')).toBe('baseball_mlb')
    expect(oddsApiSportKey('nfl')).toBe('americanfootball_nfl')
    expect(oddsApiSportKey('nhl')).toBeNull()
  })

  test('restricts event-odds URL to the markets those picks need', () => {
    const markets = marketsForPublishedPicks([
      { propType: 'batter_hits' },
      { propType: 'hits' },
      { type: 'pitcher_strikeouts' },
    ])
    expect(markets.sort()).toEqual(['batter_hits', 'pitcher_strikeouts'])
    const url = buildEventOddsUrl({
      sportKey: 'baseball_mlb',
      eventId: 'evt-1',
      markets,
      apiKey: 'secret',
    })
    expect(url).toContain('/sports/baseball_mlb/events/evt-1/odds?')
    expect(url).toContain('markets=batter_hits%2Cpitcher_strikeouts')
    expect(url).not.toContain('player_receptions')
    expect(estimateCloseCaptureCalls(7)).toEqual(expect.objectContaining({ httpCalls: 7 }))
    expect(estimateCloseCaptureCost({
      gameCount: 3,
      marketCounts: [2, 1, 3],
      regions: 1,
    })).toEqual(expect.objectContaining({ httpCalls: 3, credits: 6, regions: 1 }))
  })
})

describe('quiet period and close window', () => {
  test('isOpsWriteQuietPeriod is :05–:15 ET inclusive', () => {
    expect(isOpsWriteQuietPeriod(new Date('2026-07-15T16:05:00.000Z'))).toBe(true)
    expect(isOpsWriteQuietPeriod(new Date('2026-07-15T16:09:00.000Z'))).toBe(true)
    expect(isOpsWriteQuietPeriod(new Date('2026-07-15T16:15:00.000Z'))).toBe(true)
    expect(isOpsWriteQuietPeriod(new Date('2026-07-15T16:16:00.000Z'))).toBe(false)
    expect(isOpsWriteQuietPeriod(new Date('2026-07-15T16:04:00.000Z'))).toBe(false)
  })

  test('gameIsInCloseWindow is last 90 minutes before first pitch, never after', () => {
    const now = new Date('2026-07-15T22:00:00.000Z')
    expect(gameIsInCloseWindow({ date: '2026-07-15T22:59:00.000Z' }, now)).toBe(true)
    expect(gameIsInCloseWindow({ date: '2026-07-15T23:00:00.000Z' }, now)).toBe(true)
    expect(gameIsInCloseWindow({ date: '2026-07-15T23:01:00.000Z' }, now)).toBe(false)
    expect(gameIsInCloseWindow({ date: '2026-07-15T21:59:00.000Z' }, now)).toBe(false)
    expect(gameIsInCloseWindow({ date: now.toISOString() }, now)).toBe(false)
    expect(CLOSE_CAPTURE_WINDOW_MINUTES).toBe(60)
  })
})

describe('quote matching', () => {
  const quotes = flattenEventOddsQuotes({
    bookmakers: [
      {
        title: 'FanDuel',
        key: 'fanduel',
        markets: [{
          key: 'batter_hits',
          outcomes: [
            { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -115 },
            { name: 'Under', description: 'Vinnie Pasquantino', point: 0.5, price: -105 },
          ],
        }],
      },
      {
        title: 'DraftKings',
        key: 'draftkings',
        markets: [{
          key: 'batter_hits',
          outcomes: [
            { name: 'Over', description: 'Vinnie Pasquantino', point: 0.5, price: -108 },
            { name: 'Over', description: 'Vinnie Pasquantino', point: 1.5, price: 180 },
          ],
        }],
      },
    ],
  })

  test('prefers the recorded line and the best same-side decimal', () => {
    const match = matchClosingQuote({
      playerName: 'Vinnie Pasquantino',
      propType: 'batter_hits',
      prediction: 'over',
      threshold: 0.5,
    }, quotes)
    expect(match).toMatchObject({
      book: 'DraftKings',
      odds: -108,
      threshold: 0.5,
      sameLine: true,
      numBooks: 2,
    })
  })

  test('falls back to a moved line when the recorded threshold is gone', () => {
    const match = matchClosingQuote({
      playerName: 'Vinnie Pasquantino',
      propType: 'hits',
      prediction: 'over',
      threshold: 1.5,
    }, quotes)
    expect(match.sameLine).toBe(true)
    expect(match.odds).toBe(180)
  })

  test('requires player + market + side', () => {
    expect(matchClosingQuote({
      playerName: 'Cam Smith',
      propType: 'batter_hits',
      prediction: 'over',
      threshold: 0.5,
    }, quotes)).toBeNull()
  })
})

describe('CLV math', () => {
  test('positive CLV when we locked a better price than the close', () => {
    const clv = clvFromOdds(150, 130)
    expect(clv.clvProb).toBeCloseTo((100 / 230) - (100 / 250), 8)
    expect(clv.beatClose).toBe(true)
    expect(clv.recordedDecimal).toBeCloseTo(2.5, 5)
    expect(clv.closeDecimal).toBeCloseTo(2.3, 5)
  })

  test('negative CLV when the close pays more than we recorded', () => {
    const clv = clvFromOdds(-120, -110)
    expect(clv.beatClose).toBe(false)
    expect(clv.clvProb).toBeLessThan(0)
  })

  test('summarizePublishedClv reports avg CLV and percent that beat close', () => {
    const summary = summarizePublishedClv([
      { odds: 150, closeOdds: 130, threshold: 0.5, closeLine: 0.5 },
      { odds: -110, closeOdds: -120, threshold: 0.5, closeLine: 0.5 },
      { odds: 140, closeOdds: 160, threshold: 1.5, closeLine: 2.5 },
      { odds: 110, closeOdds: null },
    ])
    expect(summary).toMatchObject({
      sample: 4,
      withClose: 3,
      withoutClose: 1,
      beatClose: 2,
      sameLine: 2,
      lineMoved: 1,
    })
    expect(summary.pctBeatClose).toBeCloseTo(1, 8)
    expect(summary.avgClvProb).toBeCloseTo((
      clvFromOdds(150, 130).clvProb
      + clvFromOdds(-110, -120).clvProb
    ) / 2, 8)
    expect(summary.lineMovedAvgClvProb).toBeCloseTo(clvFromOdds(140, 160).clvProb, 8)
  })

  test('empty or missing closes stay honest zeros', () => {
    expect(summarizePublishedClv([])).toMatchObject({
      sample: 0,
      withClose: 0,
      pctBeatClose: null,
      avgClvProb: null,
    })
  })
})

describe('close write payload and missing-column retry', () => {
  test('closeCapturePayload stores American close + book + captured-at', () => {
    const now = new Date('2026-07-15T22:50:00.000Z')
    expect(closeCapturePayload({
      odds: -108,
      threshold: 0.5,
      book: 'DraftKings',
      numBooks: 2,
    }, now)).toEqual({
      closeOdds: -108,
      closeLine: 0.5,
      closeBook: 'DraftKings',
      closeNumBooks: 2,
      closeCapturedAt: '2026-07-15T22:50:00.000Z',
    })
  })

  test('retries without close columns on PGRST204 / 42703', async () => {
    const payloads = []
    const result = await updateWithOptionalCloseOdds(async (payload) => {
      payloads.push(payload)
      if (payload.closeOdds != null) {
        return { error: { code: 'PGRST204', message: "Could not find the 'closeOdds' column" } }
      }
      return { data: payload, error: null }
    }, closeCapturePayload({ odds: -108, threshold: 0.5, book: 'DK', numBooks: 1 }))

    expect(payloads).toHaveLength(2)
    expect(payloads[0].closeOdds).toBe(-108)
    expect(payloads[1].closeOdds).toBeUndefined()
    expect(CLOSE_ODDS_FIELDS.every((key) => !(key in payloads[1]))).toBe(true)
    expect(result.error).toBeNull()
    expect(withoutCloseOddsFields({ status: 'pending', closeOdds: 110 })).toEqual({
      status: 'pending',
    })
  })

  test('does not retry a real write error', async () => {
    let calls = 0
    const result = await updateWithOptionalCloseOdds(async () => {
      calls += 1
      return { error: { code: '42501', message: 'permission denied' } }
    }, { closeOdds: 110 })
    expect(calls).toBe(1)
    expect(result.error.code).toBe('42501')
  })

  test('hasCloseAlready requires both price and captured-at', () => {
    expect(hasCloseAlready({ closeOdds: -110, closeCapturedAt: '2026-07-15T22:00:00Z' })).toBe(true)
    expect(hasCloseAlready({ closeOdds: -110, closeCapturedAt: null })).toBeFalsy()
    expect(hasCloseAlready({ closeOdds: null, closeCapturedAt: '2026-07-15T22:00:00Z' })).toBeFalsy()
  })

  test('parseOddsApiQuota reads remaining credits', () => {
    expect(parseOddsApiQuota({
      get: (name) => (name === 'x-requests-remaining' ? '18420' : '1580'),
    })).toEqual({ remaining: 18420, used: 1580 })
  })
})
