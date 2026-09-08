import {
  etDateKey,
  formatMatchupChip,
  isEtCalendarDay,
  isSuccessfulTodaysGames,
  pickLatestGameTotals,
  resolveHomepageTodaysGames,
} from '../../lib/todays-games.js'

describe('et calendar day', () => {
  const tuesdayAfternoonEt = new Date('2026-09-08T16:46:00Z') // 12:46pm ET

  test('evening first pitch still counts as today', () => {
    expect(isEtCalendarDay('2026-09-08T22:35:00Z', tuesdayAfternoonEt)).toBe(true)
    expect(isEtCalendarDay('2026-09-08T22:35:00', tuesdayAfternoonEt)).toBe(true)
  })

  test('west-coast games that start after midnight UTC stay on today ET', () => {
    expect(isEtCalendarDay('2026-09-09T02:10:00Z', tuesdayAfternoonEt)).toBe(true)
  })

  test('yesterday and tomorrow do not count as today', () => {
    expect(isEtCalendarDay('2026-09-07T22:35:00Z', tuesdayAfternoonEt)).toBe(false)
    expect(isEtCalendarDay('2026-09-09T16:10:00Z', tuesdayAfternoonEt)).toBe(false)
  })

  test('etDateKey is the America/New_York calendar day', () => {
    expect(etDateKey(tuesdayAfternoonEt)).toBe('2026-09-08')
    expect(etDateKey(new Date('2026-09-09T03:00:00Z'))).toBe('2026-09-08')
  })
})

describe('pickLatestGameTotals', () => {
  test('keeps the newest finite total and skips missing lines', () => {
    const totals = pickLatestGameTotals([
      { gameId: 'CLE_at_BAL', market: 'totals', total: 8.5, ts: '2026-09-08T12:00:00Z' },
      { gameId: 'CLE_at_BAL', market: 'totals', total: 9.0, ts: '2026-09-08T10:00:00Z' },
      { gameId: 'SF_at_LAR', market: 'h2h', total: 47.5, ts: '2026-09-08T12:00:00Z' },
      { gameId: 'NYM_at_MIA', market: 'totals', total: null, ts: '2026-09-08T12:00:00Z' },
      { gameId: 'HOU_at_PHI', market: 'total', total: '7.5', ts: '2026-09-08T12:00:00Z' },
    ])
    expect(totals).toEqual({
      CLE_at_BAL: 8.5,
      HOU_at_PHI: 7.5,
    })
  })

  test('does not invent totals from empty or invalid rows', () => {
    expect(pickLatestGameTotals([])).toEqual({})
    expect(pickLatestGameTotals(null)).toEqual({})
    expect(pickLatestGameTotals([
      { gameId: 'x', market: 'totals', total: 0 },
      { gameId: 'y', market: 'totals', total: 'n/a' },
    ])).toEqual({})
  })
})

describe('formatMatchupChip', () => {
  test('shows the matchup and a real total', () => {
    expect(formatMatchupChip({
      away: { abbr: 'CLE' },
      home: { abbr: 'BAL' },
      total: 8.5,
    })).toEqual({ matchup: 'CLE @ BAL', total: '8.5' })
  })

  test('omits the total when we do not have one', () => {
    expect(formatMatchupChip({
      away: { abbr: 'CLE' },
      home: { abbr: 'BAL' },
    })).toEqual({ matchup: 'CLE @ BAL', total: null })
    expect(formatMatchupChip({
      away: { name: 'Guardians' },
      home: { name: 'Orioles' },
      total: null,
    })).toEqual({ matchup: 'Guardians @ Orioles', total: null })
  })
})

describe('resolveHomepageTodaysGames', () => {
  const slate = {
    success: true,
    data: { mlb: [{ id: 'CLE_at_BAL' }], nfl: [], nhl: [] },
  }

  test('uses a successful cache hit', async () => {
    const live = jest.fn()
    const result = await resolveHomepageTodaysGames({
      cached: async () => slate,
      live,
    })
    expect(result).toBe(slate)
    expect(live).not.toHaveBeenCalled()
  })

  test('retries live when the cache returns a failed or empty payload', async () => {
    const live = jest.fn().mockResolvedValue(slate)
    const result = await resolveHomepageTodaysGames({
      cached: async () => ({ success: false, error: 'stuck' }),
      live,
    })
    expect(result).toBe(slate)
    expect(live).toHaveBeenCalledTimes(1)
  })

  test('retries live when the cache throws instead of persisting the miss', async () => {
    const live = jest.fn().mockResolvedValue(slate)
    const result = await resolveHomepageTodaysGames({
      cached: async () => {
        throw new Error('today\'s games unavailable')
      },
      live,
    })
    expect(result).toBe(slate)
    expect(live).toHaveBeenCalledTimes(1)
  })
})

describe('isSuccessfulTodaysGames', () => {
  test('rejects null and failed payloads the old cache used to treat as empty', () => {
    expect(isSuccessfulTodaysGames(null)).toBe(false)
    expect(isSuccessfulTodaysGames({ success: false })).toBe(false)
    expect(isSuccessfulTodaysGames({ success: true, data: { mlb: [], nfl: [], nhl: [] } })).toBe(true)
  })
})
