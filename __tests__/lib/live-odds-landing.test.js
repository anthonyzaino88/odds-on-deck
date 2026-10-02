import {
  eventCommenceMs,
  oddsInsertFailedForMissingCommenceTime,
  oddsInsertPayload,
  isOpenForOddsEvent,
  pickOpenTeamMatch,
  pickUnmappedOddsGame,
  resolveTeamNameFallback,
  resolvePropLanding,
} from '../../lib/live-odds-landing.js'

describe('pickUnmappedOddsGame', () => {
  const game1 = {
    id: 'CHC_at_CLE_2026-04-04',
    date: '2026-04-04T17:10:00',
    oddsApiEventId: 'event-game-1',
  }
  const game2 = {
    id: 'CHC_at_CLE_2026-04-05',
    date: '2026-04-05T17:10:00',
    oddsApiEventId: null,
  }

  test('split doubleheader: a new event lands on the unmapped game, not the closest mapped row', () => {
    const eventTime = eventCommenceMs('2026-04-05T17:10:00Z')
    const picked = pickUnmappedOddsGame([game1, game2], eventTime)
    expect(picked.id).toBe('CHC_at_CLE_2026-04-05')
  })

  test('does not steal a mapped sibling when every match is already mapped', () => {
    const mappedTwin = { ...game2, oddsApiEventId: 'event-game-2' }
    expect(pickUnmappedOddsGame([game1, mappedTwin], eventCommenceMs('2026-04-05T17:10:00Z'))).toBeNull()
  })
})

describe('pickOpenTeamMatch (saveGameOdds team-name fallback)', () => {
  const mapped = {
    id: 'CHC_at_CLE_2026-04-04',
    oddsApiEventId: 'event-game-1',
  }
  const unmapped = {
    id: 'CHC_at_CLE_2026-04-05',
    oddsApiEventId: null,
  }

  test('skips a mapped sibling and keeps the unmapped game', () => {
    expect(pickOpenTeamMatch([mapped, unmapped], 'event-game-2').id).toBe('CHC_at_CLE_2026-04-05')
    expect(isOpenForOddsEvent(mapped, 'event-game-2')).toBe(false)
    expect(isOpenForOddsEvent(unmapped, 'event-game-2')).toBe(true)
  })

  test('does not steal the mapped sibling when pickUnmappedOddsGame already returned nothing', () => {
    expect(pickOpenTeamMatch([mapped], 'event-game-2')).toBeNull()
    expect(pickOpenTeamMatch([
      mapped,
      { ...unmapped, oddsApiEventId: 'event-other' },
    ], 'event-game-2')).toBeNull()
  })

  test('allows a row already mapped to this event', () => {
    expect(pickOpenTeamMatch([mapped], 'event-game-1').id).toBe('CHC_at_CLE_2026-04-04')
  })

  test('same-day matches all mapped, open sibling the next day, so null', () => {
    const sameDay = [{ id: 'NYY_at_BOS_2026-10-01', oddsApiEventId: 'event-g1' }]
    const nextDay = [{ id: 'NYY_at_BOS_2026-10-02', oddsApiEventId: null }]
    expect(resolveTeamNameFallback(sameDay, nextDay, 'event-g2')).toBeNull()
    expect(resolveTeamNameFallback([], nextDay, 'event-g2').id).toBe('NYY_at_BOS_2026-10-02')
  })
})

describe('resolvePropLanding', () => {
  const finalGame = {
    id: 'TOR_at_BAL_2026-09-22',
    date: '2026-09-22T23:05:00',
  }
  const nextGame = {
    id: 'TOR_at_BAL_2026-09-23',
    date: '2026-09-23T23:05:00',
  }

  test('redirected props use the next game date, not the final game date or run time', () => {
    const landing = resolvePropLanding({
      mappedGame: finalGame,
      redirectGame: nextGame,
      commenceTime: '2026-09-23T23:05:00Z',
      now: new Date('2026-09-24T12:00:00.000Z'),
    })
    expect(landing.gameId).toBe('TOR_at_BAL_2026-09-23')
    expect(landing.redirected).toBe(true)
    expect(landing.gameTime).toBe('2026-09-23T23:05:00.000Z')
    expect(landing.gameTime).not.toBe('2026-09-22T23:05:00.000Z')
    expect(landing.gameTime).not.toBe('2026-09-24T12:00:00.000Z')
  })

  test('falls back to event commence_time when no redirected date exists', () => {
    const landing = resolvePropLanding({
      mappedGame: { id: 'g1', date: null },
      commenceTime: '2026-09-23T17:05:00Z',
      now: new Date('2026-09-24T12:00:00.000Z'),
    })
    expect(landing.gameTime).toBe('2026-09-23T17:05:00.000Z')
  })
})

describe('oddsInsertPayload', () => {
  test('stores commence_time only when the column is opted in', () => {
    const base = {
      id: 'o1',
      gameId: 'g1',
      book: 'DraftKings',
      market: 'h2h',
      priceAway: 2.1,
      priceHome: 1.8,
      spread: null,
      total: null,
      ts: '2026-10-01T12:00:00.000Z',
      commenceTime: '2026-10-01T23:10:00Z',
    }
    expect(oddsInsertPayload(base).commence_time).toBeUndefined()
    expect(oddsInsertPayload({ ...base, includeCommenceTime: true }).commence_time).toBe('2026-10-01T23:10:00.000Z')
  })

  test('detects a missing commence_time column from PostgREST errors', () => {
    expect(oddsInsertFailedForMissingCommenceTime({
      code: 'PGRST204',
      message: "Could not find the 'commence_time' column of 'Odds' in the schema cache",
    })).toBe(true)
    expect(oddsInsertFailedForMissingCommenceTime({
      code: '23505',
      message: 'duplicate key',
    })).toBe(false)
  })
})
