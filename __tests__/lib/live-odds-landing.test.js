import { readFileSync } from 'fs'
import { join } from 'path'
import {
  eventCommenceMs,
  MAP_EVENT_GAME_SELECT,
  oddsInsertFailedForMissingCommenceTime,
  oddsInsertPayload,
  isOpenForOddsEvent,
  pickOpenTeamMatch,
  pickUnmappedOddsGame,
  resolveTeamNameFallback,
  resolvePropLanding,
  gamesEligibleForPropSave,
  propSaveDecision,
} from '../../lib/live-odds-landing.js'

function parseSelectColumns(select) {
  const cols = []
  let current = ''
  let depth = 0
  for (const ch of select) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      cols.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) cols.push(current.trim())
  return cols
}

function rowFromSelect(select, values) {
  const row = {}
  for (const col of parseSelectColumns(select)) {
    const key = col.split(':')[0].trim()
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`fixture missing ${key} for select ${select}`)
    }
    row[key] = values[key]
  }
  return row
}

const SELECT_FIXTURE = {
  id: 'TB_at_CLE_2026-10-16',
  sport: 'mlb',
  date: '2026-10-17T00:00:00',
  status: 'scheduled',
  homeId: 'MLB_114',
  awayId: 'MLB_139',
  oddsApiEventId: null,
  espnGameId: '401696969',
  home: { name: 'Cleveland Guardians', abbr: 'CLE' },
  away: { name: 'Tampa Bay Rays', abbr: 'TB' },
}

describe('pickUnmappedOddsGame', () => {
  const game1 = {
    id: 'CHC_at_CLE_2026-04-04',
    date: '2026-04-04T17:10:00',
    oddsApiEventId: 'event-game-1',
    status: 'scheduled',
  }
  const game2 = {
    id: 'CHC_at_CLE_2026-04-05',
    date: '2026-04-05T17:10:00',
    oddsApiEventId: null,
    status: 'scheduled',
  }

  test('split doubleheader: a new event lands on the unmapped game, not the closest mapped row', () => {
    const eventTime = eventCommenceMs('2026-04-05T17:10:00Z')
    const picked = pickUnmappedOddsGame([game1, game2], eventTime)
    expect(picked.id).toBe('CHC_at_CLE_2026-04-05')
  })

  test('retired not_needed rows are not mappable', () => {
    expect(pickUnmappedOddsGame([{ ...game2, status: 'not_needed' }], eventCommenceMs('2026-04-05T17:10:00Z'))).toBeNull()
    expect(pickUnmappedOddsGame([{ ...game2, status: 'cancelled' }], eventCommenceMs('2026-04-05T17:10:00Z'))).toBeNull()
  })

  test('does not steal a mapped sibling when every match is already mapped', () => {
    const mappedTwin = { ...game2, oddsApiEventId: 'event-game-2' }
    expect(pickUnmappedOddsGame([game1, mappedTwin], eventCommenceMs('2026-04-05T17:10:00Z'))).toBeNull()
  })

  test('maps from exactly the mapAndSaveEventIds Game select columns', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/fetch-live-odds.js'), 'utf8')
    const fnStart = src.indexOf('async function mapAndSaveEventIds')
    expect(fnStart).toBeGreaterThanOrEqual(0)
    const fn = src.slice(fnStart, src.indexOf('\nasync function', fnStart + 1))
    const selects = [...fn.matchAll(/\.select\(([^)]+)\)/g)].map((m) => m[1].trim())
    expect(selects[0]).toBe('MAP_EVENT_GAME_SELECT')
    expect(selects[1]).toBe('MAP_EVENT_GAME_SELECT')
    expect(MAP_EVENT_GAME_SELECT).toMatch(/\bstatus\b/)

    const row = rowFromSelect(MAP_EVENT_GAME_SELECT, SELECT_FIXTURE)
    expect(Object.keys(row).sort()).toEqual([
      'away', 'awayId', 'date', 'espnGameId', 'home', 'homeId',
      'id', 'oddsApiEventId', 'sport', 'status',
    ])
    expect(row).not.toHaveProperty('lastUpdate')
    expect(src).toMatch(/isCancelledGameStatus/)
    expect(pickUnmappedOddsGame([row], eventCommenceMs('2026-10-17T00:00:00Z')).id).toBe(row.id)

    const { status, ...withoutStatus } = row
    expect(status).toBe('scheduled')
    expect(pickUnmappedOddsGame([withoutStatus], eventCommenceMs('2026-10-17T00:00:00Z'))).toBeNull()
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

describe('propSaveDecision', () => {
  test('does not move not_needed or cancelled props onto another game', () => {
    expect(propSaveDecision({ status: 'not_needed' })).toBe('skip')
    expect(propSaveDecision({ status: 'cancelled' })).toBe('skip')
    expect(propSaveDecision({ status: 'final' })).toBe('redirect')
    expect(propSaveDecision({ status: 'scheduled' })).toBe('keep')
    const src = readFileSync(join(process.cwd(), 'scripts/fetch-live-odds.js'), 'utf8')
    expect(src).toMatch(/propSaveDecision/)
    expect(src).toMatch(/skippedGameIds/)
    expect(src).not.toMatch(/skippedEventIds/)
    expect(src).toMatch(/not moving onto another game/)
  })

  test('a live row that shares an event id with a retired row still maps', () => {
    const retired = { id: 'CLE_at_TB_2026-10-20', oddsApiEventId: 'evt-1', status: 'not_needed' }
    const live = { id: 'TB_at_CLE_2026-10-20', oddsApiEventId: 'evt-1', status: 'scheduled' }
    expect(gamesEligibleForPropSave([retired, live]).map((game) => game.id)).toEqual([
      'TB_at_CLE_2026-10-20',
    ])
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
