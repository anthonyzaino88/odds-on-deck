import {
  appearanceGradeContext,
  planPlayerAppearanceGrade,
} from '../../lib/player-stat-grade.js'
import {
  classifyNflGameLogAppearance,
  classifyNflRosterAppearance,
  isNflMissingStatSettleReady,
  matchEventLogByEventId,
  matchGameLogByEventId,
  matchNflRosterPlayer,
  nflEventFinalAt,
  nflNamesMatchExact,
  NFL_ESTIMATED_DURATION_MS,
  NFL_MISSING_STAT_SETTLE_HOURS,
  parseEspnNflEventRoster,
  planNflMissingStatFromSources,
} from '../../lib/nfl-stat-grade.js'
import { buildRegradePreview } from '../../lib/regrade-needs-review.js'
import {
  createNflLookupCache,
  getPlayerGameStat,
  lookupPlayerGameStat,
  NFL_FETCH_MAX_RETRIES,
  NFL_FETCH_RETRY_AFTER_MAX_MS,
  retryAfterWaitMs,
} from '../../lib/vendors/nfl-game-stats.js'
import { completedNflSummaryFixture, COMPLETED_EVENT_ID } from '../fixtures/espn-nfl-boxscore.fixture.js'

const KICKOFF = '2025-09-05T00:20:00.000Z'
const SETTLE_NOW = new Date(Date.parse(KICKOFF) + NFL_ESTIMATED_DURATION_MS + (NFL_MISSING_STAT_SETTLE_HOURS + 1) * 3600 * 1000)

function jsonResponse(body, ok = true, extras = {}) {
  const headers = extras.headers || {}
  return Promise.resolve({
    ok,
    status: extras.status ?? (ok ? 200 : 500),
    statusText: extras.statusText ?? (ok ? 'OK' : 'Error'),
    headers: {
      get(name) {
        const key = String(name || '').toLowerCase()
        return headers[key] ?? headers[name] ?? null
      },
    },
    json: async () => body,
  })
}

function errorResponse(status, statusText, headers = {}) {
  return jsonResponse({}, false, { status, statusText, headers })
}

function rosterEntry(overrides = {}) {
  return {
    playerId: 1001,
    period: 0,
    active: false,
    starter: false,
    valid: true,
    didNotPlay: false,
    displayName: 'Fant',
    athlete: {
      $ref: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/athletes/1001',
      id: '1001',
      fullName: 'Noah Fant',
      displayName: 'Noah Fant',
    },
    statistics: {
      $ref: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401547353/competitions/401547353/competitors/9/roster/1001/statistics/0',
    },
    ...overrides,
  }
}

function eventRoster(entries, teamId = '9') {
  return {
    entries,
    team: { $ref: `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/teams/${teamId}` },
  }
}

function mockEspn({
  summary = completedNflSummaryFixture(),
  homeRoster,
  awayRoster,
  eventlog,
  gamelog,
  athletes = {},
  homeStatus,
  awayStatus,
  summaryStatus,
  eventlogStatus,
  gamelogStatus,
} = {}) {
  global.fetch = jest.fn((url) => {
    const href = String(url)
    if (href.includes('/summary?event=')) {
      if (summaryStatus) return errorResponse(summaryStatus, 'Error')
      return jsonResponse(summary)
    }
    if (href.includes('/competitors/12/roster')) {
      if (homeStatus) return errorResponse(homeStatus, 'Error')
      return jsonResponse(homeRoster ?? eventRoster([
        rosterEntry({
          playerId: 3139477,
          displayName: 'Mahomes',
          athlete: { id: '3139477', fullName: 'Patrick Mahomes', displayName: 'Patrick Mahomes' },
        }),
      ], '12'))
    }
    if (href.includes('/competitors/9/roster')) {
      if (awayStatus) return errorResponse(awayStatus, 'Error')
      return jsonResponse(awayRoster ?? eventRoster([rosterEntry()]))
    }
    if (href.includes('/eventlog')) {
      if (eventlogStatus) return errorResponse(eventlogStatus, 'Error')
      return jsonResponse(eventlog ?? { events: { items: [] } })
    }
    if (href.includes('/gamelog')) {
      if (gamelogStatus) return errorResponse(gamelogStatus, 'Error')
      return jsonResponse(gamelog ?? { events: {} })
    }
    const athleteMatch = href.match(/\/athletes\/(\d+)(?:\?|$)/)
    if (athleteMatch && href.includes('/seasons/') && !href.includes('/eventlog')) {
      const id = athleteMatch[1]
      const named = athletes[id]
      if (!named) return errorResponse(404, 'Not Found')
      return jsonResponse({ id, fullName: named, displayName: named })
    }
    return errorResponse(500, 'Error')
  })
}

const NFL_GAME = {
  id: 'PHI_at_KC_2025-09-05',
  sport: 'nfl',
  status: 'final',
  espnGameId: COMPLETED_EVENT_ID,
  homeScore: 24,
  awayScore: 21,
  date: KICKOFF,
  home: { abbr: 'KC' },
  away: { abbr: 'PHI' },
}

function previewFromLookup(lookup, row = {}) {
  return buildRegradePreview(
    {
      id: 'pv-nfl-1',
      sport: 'nfl',
      playerName: 'Noah Fant',
      propType: 'player_receptions',
      gameIdRef: NFL_GAME.id,
      status: 'needs_review',
      prediction: 'over',
      threshold: 3.5,
      ...row,
    },
    lookup,
    NFL_GAME,
    appearanceGradeContext(NFL_GAME, 'nfl', {
      usedId: COMPLETED_EVENT_ID,
      box: lookup?.box,
      playerName: row.playerName || 'Noah Fant',
    }),
  )
}

describe('NFL name matching after suffix / apostrophe normalization', () => {
  test('Jr and apostrophes match only when the full normalized name is exact', () => {
    expect(nflNamesMatchExact("Ja'Marr Chase", 'Jamarr Chase')).toBe(true)
    expect(nflNamesMatchExact('Marvin Harrison Jr.', 'Marvin Harrison')).toBe(true)
    expect(nflNamesMatchExact('Amon-Ra St. Brown', 'Amon-Ra St Brown')).toBe(true)
    expect(nflNamesMatchExact('Josh Allen', 'Allen')).toBe(false)
    expect(nflNamesMatchExact('Christian Watson', 'Justin Watson')).toBe(false)
    expect(nflNamesMatchExact('Jordan Love', 'Jordan Lovett')).toBe(false)
  })

  test('roster matcher never last-name-only or substring matches', () => {
    const entries = [
      { playerId: '1', fullName: 'Josh Allen', teamAbbr: 'BUF' },
      { playerId: '2', fullName: 'Justin Watson', teamAbbr: 'KC' },
      { playerId: '3', fullName: 'Jordan Lovett', teamAbbr: 'KC' },
    ]
    expect(matchNflRosterPlayer(entries, { name: 'Allen' }).status).toBe('unmatched')
    expect(matchNflRosterPlayer(entries, { name: 'Hines-Allen' }).status).toBe('unmatched')
    expect(matchNflRosterPlayer(entries, { name: 'Christian Watson' }).status).toBe('unmatched')
    expect(matchNflRosterPlayer(entries, { name: 'Jordan Love' }).status).toBe('unmatched')
    expect(matchNflRosterPlayer(entries, { name: 'Josh Allen', team: 'BUF' }).player.playerId).toBe('1')
    expect(matchNflRosterPlayer(entries, { name: 'Josh Allen', team: 'KC' }).status).toBe('team_mismatch')
  })
})

describe('NFL missing-stat classification', () => {
  test('dressed with snaps grades the missing category as 0', () => {
    const entry = parseEspnNflEventRoster(eventRoster([rosterEntry()])).entries[0]
    expect(classifyNflRosterAppearance(entry)).toEqual({ status: 'played', reason: 'appeared' })
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: entry,
    })).toEqual({ action: 'grade', reason: 'appeared', actualValue: 0 })
  })

  test('didNotPlay is a verified DNP void', () => {
    const entry = parseEspnNflEventRoster(eventRoster([
      rosterEntry({ didNotPlay: true, valid: false, statistics: undefined }),
    ])).entries[0]
    expect(classifyNflRosterAppearance(entry)).toEqual({ status: 'dnp', reason: 'dnp_verified' })
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: entry,
    })).toEqual({ action: 'void', reason: 'dnp_verified' })
  })

  test('dressed with no snaps voids as dnp_no_snap after an eventId log hit', () => {
    const entry = parseEspnNflEventRoster(eventRoster([
      rosterEntry({ valid: false, statistics: undefined, playerId: 4434153, displayName: 'Bagent' }),
    ])).entries[0]
    entry.fullName = 'Tyson Bagent'
    entry.name = 'Tyson Bagent'
    expect(classifyNflRosterAppearance(entry).status).toBe('dressed_unknown_snaps')
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: entry,
      logFetched: true,
      logEntry: { event: { $ref: `.../events/${COMPLETED_EVENT_ID}` }, played: false },
    })).toEqual({ action: 'void', reason: 'dnp_no_snap' })
  })

  test('player on neither event roster voids as not_on_roster', () => {
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: null,
    })).toEqual({ action: 'void', reason: 'not_on_roster' })
  })

  test('fail-closed: missing roster, no log, or incomplete settle window', () => {
    expect(planNflMissingStatFromSources({
      settleReady: false,
      rosterOk: true,
      rosterMatch: rosterEntry(),
    })).toEqual({ action: 'hold', reason: 'pending_final_window' })
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: false,
    })).toEqual({ action: 'needs_review', reason: 'missing_roster' })
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: parseEspnNflEventRoster(eventRoster([
        rosterEntry({ statistics: undefined }),
      ])).entries[0],
      logFetched: true,
      logEntry: null,
    })).toEqual({ action: 'needs_review', reason: 'no_log_entry' })
  })

  test('game log is matched by eventId, never by date', () => {
    const items = [
      { event: { $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401872999' }, played: true },
      { event: { $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${COMPLETED_EVENT_ID}` }, played: false },
    ]
    expect(matchEventLogByEventId(items, COMPLETED_EVENT_ID).played).toBe(false)
    expect(matchEventLogByEventId(items, '401872000')).toBeNull()
    expect(matchGameLogByEventId({ [COMPLETED_EVENT_ID]: { gameDate: '2025-09-05' } }, COMPLETED_EVENT_ID).present).toBe(true)
    expect(matchGameLogByEventId({ '401872999': { gameDate: '2025-09-05' } }, COMPLETED_EVENT_ID)).toBeNull()
    expect(classifyNflGameLogAppearance({ present: true }).status).toBe('played')
    expect(classifyNflGameLogAppearance(null).status).toBe('missing')
  })

  test('settle window is 6 hours after estimated final, not kickoff', () => {
    const finalAt = nflEventFinalAt({ header: { competitions: [{ date: KICKOFF }] } })
    expect(finalAt.getTime()).toBe(Date.parse(KICKOFF) + NFL_ESTIMATED_DURATION_MS)
    expect(isNflMissingStatSettleReady(finalAt, new Date(Date.parse(KICKOFF) + 5 * 3600 * 1000))).toBe(false)
    expect(isNflMissingStatSettleReady(finalAt, new Date(finalAt.getTime() + 5 * 3600 * 1000))).toBe(false)
    expect(isNflMissingStatSettleReady(finalAt, new Date(finalAt.getTime() + 6 * 3600 * 1000))).toBe(true)
    expect(isNflMissingStatSettleReady(null, SETTLE_NOW)).toBe(false)
  })
})

describe('lookupPlayerGameStat missing-from-box outcomes', () => {
  afterEach(() => {
    global.fetch = jest.fn()
  })

  test('dressed with snaps grades a missing receiving line as 0', async () => {
    mockEspn()
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW, team: 'PHI' },
    )
    expect(result).toMatchObject({
      value: 0,
      matchStatus: 'matched',
      statFound: true,
      gameFinal: true,
      didNotPlay: false,
      reason: 'appeared',
    })
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true })).toEqual({
      action: 'grade',
      reason: 'appeared',
      actualValue: 0,
    })
    expect(previewFromLookup(result)).toMatchObject({ action: 'grade', actualValue: 0, newStatus: 'completed' })
    expect(await getPlayerGameStat(COMPLETED_EVENT_ID, 'Noah Fant', 'player_receptions', {
      cache: createNflLookupCache(),
      sleep: async () => {},
      now: SETTLE_NOW,
      team: 'PHI',
    })).toBe(0)
  })

  test('verified DNP voids as dnp_verified', async () => {
    mockEspn({
      awayRoster: eventRoster([
        rosterEntry({
          didNotPlay: true,
          valid: false,
          statistics: undefined,
          athlete: { id: '1001', fullName: 'Noah Fant', displayName: 'Noah Fant' },
        }),
      ]),
    })
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW, team: 'PHI' },
    )
    expect(result).toMatchObject({ didNotPlay: true, reason: 'dnp_verified', matchStatus: 'matched' })
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true })).toEqual({
      action: 'void',
      reason: 'dnp_verified',
    })
    expect(previewFromLookup(result)).toMatchObject({
      action: 'void',
      newStatus: 'manual_closed',
      newResult: 'void',
      reason: 'dnp_verified',
    })
    expect(await getPlayerGameStat(COMPLETED_EVENT_ID, 'Noah Fant', 'player_receptions', {
      cache: createNflLookupCache(),
      sleep: async () => {},
      now: SETTLE_NOW,
      team: 'PHI',
    })).toBeNull()
  })

  test('Bagent dressed with 0 snaps voids passing props as dnp_no_snap', async () => {
    mockEspn({
      awayRoster: eventRoster([
        rosterEntry({
          playerId: 4434153,
          displayName: 'Bagent',
          valid: false,
          statistics: undefined,
          athlete: { id: '4434153', fullName: 'Tyson Bagent', displayName: 'Tyson Bagent' },
        }),
      ], '3'),
      eventlog: {
        events: {
          items: [{
            event: { $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${COMPLETED_EVENT_ID}` },
            played: false,
            teamId: '3',
          }],
        },
      },
    })
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Tyson Bagent',
      'player_passing_yards',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW },
    )
    expect(result).toMatchObject({ didNotPlay: true, reason: 'dnp_no_snap' })
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true })).toEqual({
      action: 'void',
      reason: 'dnp_no_snap',
    })
    expect(previewFromLookup(result, { playerName: 'Tyson Bagent', propType: 'player_passing_yards' })).toMatchObject({
      action: 'void',
      reason: 'dnp_no_snap',
    })
  })

  test('Slayton missing from both event rosters voids as not_on_roster', async () => {
    mockEspn()
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Darius Slayton',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW },
    )
    expect(result).toMatchObject({ didNotPlay: true, reason: 'not_on_roster', matchStatus: 'not_on_roster' })
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true })).toEqual({
      action: 'void',
      reason: 'not_on_roster',
    })
    expect(previewFromLookup(result, { playerName: 'Darius Slayton' })).toMatchObject({
      action: 'void',
      reason: 'not_on_roster',
    })
  })

  test('pick team must match the event roster team', async () => {
    mockEspn()
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW, team: 'KC' },
    )
    expect(result.reason).toBe('team_mismatch')
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true })).toEqual({
      action: 'needs_review',
      reason: 'team_mismatch',
    })
    expect(previewFromLookup(result)).toMatchObject({
      action: 'skip',
      newStatus: 'needs_review',
      reason: 'team_mismatch',
    })
  })

  test('before 6 hours after final the pick stays pending', async () => {
    mockEspn()
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: new Date(KICKOFF) },
    )
    expect(result).toMatchObject({
      reason: 'pending_final_window',
      didNotPlay: false,
      gameFinal: false,
    })
    expect(result.value).toBeNull()
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true })).toEqual({
      action: 'needs_review',
      reason: 'pending_final_window',
    })
    expect(previewFromLookup(result)).toMatchObject({
      action: 'skip',
      newStatus: 'needs_review',
      reason: 'pending_final_window',
    })
  })

  test('missing roster is needs_review, never a void or 0', async () => {
    mockEspn({
      homeRoster: { entries: [] },
      awayRoster: { entries: [] },
    })
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW },
    )
    expect(isNflMissingStatSettleReady(nflEventFinalAt(completedNflSummaryFixture()), SETTLE_NOW)).toBe(true)
    expect(result.didNotPlay).toBe(false)
    expect(result.value).toBeNull()
    expect(['missing_roster', 'fetch_error']).toContain(result.reason)
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true }).action).toBe('needs_review')
    expect(previewFromLookup(result).action).toBe('skip')
  })

  test('no eventlog / gamelog entry for a dressed no-stat player is needs_review', async () => {
    mockEspn({
      awayRoster: eventRoster([
        rosterEntry({
          valid: false,
          statistics: undefined,
          athlete: { id: '1001', fullName: 'Noah Fant', displayName: 'Noah Fant' },
        }),
      ]),
      eventlog: { events: { items: [] } },
      gamelog: { events: {} },
    })
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW },
    )
    expect(result).toMatchObject({
      reason: 'no_log_entry',
      didNotPlay: false,
      value: null,
    })
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true })).toEqual({
      action: 'needs_review',
      reason: 'no_log_entry',
    })
  })

  test('roster fetch error is fetch_error, not void, and is not cached as a miss', async () => {
    const cache = createNflLookupCache()
    mockEspn({ awayStatus: 503 })
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache, sleep: async () => {}, now: SETTLE_NOW },
    )
    expect(result).toMatchObject({
      reason: 'fetch_error',
      matchStatus: 'fetch_error',
      didNotPlay: false,
    })
    expect(result.value).toBeNull()
    expect(cache.rosterByKey.has(`${COMPLETED_EVENT_ID}:9`)).toBe(false)
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true })).toEqual({
      action: 'needs_review',
      reason: 'fetch_error',
    })
    expect(previewFromLookup(result)).toMatchObject({
      action: 'skip',
      newStatus: 'needs_review',
      reason: 'fetch_error',
    })
  })

  test('eventlog 429 is fetch_error after capped retries and does not void', async () => {
    const sleep = jest.fn(async () => {})
    const cache = createNflLookupCache()
    mockEspn({
      awayRoster: eventRoster([
        rosterEntry({
          valid: false,
          statistics: undefined,
          athlete: { id: '1001', fullName: 'Noah Fant', displayName: 'Noah Fant' },
        }),
      ]),
      eventlogStatus: 429,
    })
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache, sleep, now: SETTLE_NOW },
    )
    expect(result).toMatchObject({ reason: 'fetch_error', didNotPlay: false })
    expect(sleep).toHaveBeenCalledWith(NFL_FETCH_RETRY_AFTER_MAX_MS)
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true }).action).toBe('needs_review')
  })

  test('persistent 429 is remembered and later lookups do not hit the network again', async () => {
    const cache = createNflLookupCache()
    const onPersistentRateLimit = jest.fn()
    mockEspn({ awayStatus: 429 })
    await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache, sleep: async () => {}, now: SETTLE_NOW, onPersistentRateLimit },
    )
    const hits = global.fetch.mock.calls.length
    await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache, sleep: async () => {}, now: SETTLE_NOW, onPersistentRateLimit },
    )
    expect(global.fetch.mock.calls.length).toBe(hits)
    expect(onPersistentRateLimit).toHaveBeenCalled()
  })

  test('caps 429 Retry-After at 30s like the NHL path', () => {
    expect(retryAfterWaitMs({
      status: 429,
      headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? '60' : null) },
    }, 0, 429)).toBe(NFL_FETCH_RETRY_AFTER_MAX_MS)
    expect(NFL_FETCH_MAX_RETRIES).toBe(3)
  })

  test('in-box Mahomes still grades from the stat table without a roster fetch', async () => {
    mockEspn()
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Patrick Mahomes',
      'passing_yards',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW },
    )
    expect(result).toMatchObject({ value: 258, source: 'espn-nfl-box', matchStatus: 'matched' })
    const rosterCalls = global.fetch.mock.calls.filter(([url]) => String(url).includes('/roster'))
    expect(rosterCalls).toHaveLength(0)
  })
})

describe('historical 36-row mix', () => {
  test('21 dressed-with-0 grades plus 15 voids matches the target dry-run split', () => {
    const dressed = Array.from({ length: 21 }, () => planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: parseEspnNflEventRoster(eventRoster([rosterEntry()])).entries[0],
    }))
    const dnp = Array.from({ length: 11 }, () => planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: { didNotPlay: true },
    }))
    const bagent = Array.from({ length: 2 }, () => planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: { didNotPlay: false, hasStatistics: false, active: false },
      logFetched: true,
      logEntry: { played: false },
    }))
    const slayton = Array.from({ length: 2 }, () => planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: null,
    }))
    const rows = [...dressed, ...dnp, ...bagent, ...slayton]
    expect(rows).toHaveLength(36)
    expect(rows.filter((row) => row.action === 'grade' && row.actualValue === 0)).toHaveLength(21)
    expect(rows.filter((row) => row.action === 'void')).toHaveLength(15)
    expect(rows.filter((row) => row.reason === 'dnp_verified')).toHaveLength(11)
    expect(rows.filter((row) => row.reason === 'dnp_no_snap')).toHaveLength(2)
    expect(rows.filter((row) => row.reason === 'not_on_roster')).toHaveLength(2)
  })
})
