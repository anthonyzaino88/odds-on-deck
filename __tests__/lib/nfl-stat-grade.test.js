import {
  appearanceGradeContext,
  planPlayerAppearanceGrade,
} from '../../lib/player-stat-grade.js'
import {
  classifyNflGameLogAppearance,
  classifyNflRosterAppearance,
  dedupeRosterAthleteCandidates,
  isNflEventRosterComplete,
  isNflMissingStatSettleReady,
  matchEventLogByEventId,
  matchGameLogByEventId,
  matchNflRosterPlayer,
  nflEventFinalAt,
  nflNamesMatchExact,
  nflTeamsMatch,
  NFL_ESTIMATED_DURATION_MS,
  NFL_MIN_EVENT_ROSTER,
  NFL_MISSING_STAT_SETTLE_HOURS,
  parseEspnNflEventRoster,
  parseNumericEspnAthleteId,
  planNflMissingStatFromSources,
  warnNflMissingKickoff,
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

function completeEventRoster(entries, teamId = '9', min = NFL_MIN_EVENT_ROSTER) {
  const padded = [...entries]
  while (padded.length < min) {
    const n = padded.length + 1
    const id = 800000 + Number(teamId || 0) * 1000 + n
    padded.push(rosterEntry({
      playerId: id,
      displayName: `Pad${id}`,
      athlete: { id: String(id), fullName: `Pad Player${id}`, displayName: `Pad Player${id}` },
    }))
  }
  return eventRoster(padded, teamId)
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
    expect(matchNflRosterPlayer(entries, { name: 'Josh Allen' }).status).toBe('matched')
    expect(matchNflRosterPlayer(entries, { name: 'Josh Allen', team: null }).status).toBe('matched')
  })

  test('Kelce and Gabe Davis stay unmatched; unique Gabriel Davis resolves without a pick team', () => {
    const entries = [
      { playerId: '15847', fullName: 'Travis Kelce', teamAbbr: 'KC' },
      { playerId: '4241478', fullName: 'Gabriel Davis', teamAbbr: 'BUF' },
    ]
    expect(matchNflRosterPlayer(entries, { name: 'Kelce', team: 'KC' }).status).toBe('unmatched')
    expect(matchNflRosterPlayer(entries, { name: 'Gabe Davis', team: 'BUF' }).status).toBe('unmatched')
    expect(matchNflRosterPlayer(entries, { name: 'Gabriel Davis', team: null }).status).toBe('matched')
    expect(matchNflRosterPlayer(entries, { name: 'Gabriel Davis', team: null }).player.playerId).toBe('4241478')
  })

  test('same name on both rosters is ambiguous without a team cross-check', () => {
    const entries = [
      { playerId: '1', fullName: 'Josh Allen', teamAbbr: 'BUF' },
      { playerId: '99', fullName: 'Josh Allen', teamAbbr: 'KC' },
    ]
    expect(matchNflRosterPlayer(entries, { name: 'Josh Allen' }).status).toBe('ambiguous')
    expect(matchNflRosterPlayer(entries, { name: 'Josh Allen', team: null }).status).toBe('ambiguous')
  })

  test('non-numeric playerId is ignored; numeric id must match the normalized name', () => {
    const entries = [
      { playerId: '15847', fullName: 'Travis Kelce', teamAbbr: 'KC' },
    ]
    expect(parseNumericEspnAthleteId('Travis Kelce')).toBe('')
    expect(parseNumericEspnAthleteId('15847')).toBe('15847')
    expect(matchNflRosterPlayer(entries, { name: 'Travis Kelce', playerId: 'Travis Kelce' }).status).toBe('matched')
    expect(matchNflRosterPlayer(entries, { name: 'Darius Slayton', playerId: '15847' }).status).toBe('unverified_id')
  })

  test('Kansas City Chiefs matches KC after name normalization', () => {
    expect(nflTeamsMatch('Kansas City Chiefs', 'KC')).toBe(true)
    const entries = [{ playerId: '15847', fullName: 'Travis Kelce', teamAbbr: 'KC' }]
    expect(matchNflRosterPlayer(entries, { name: 'Travis Kelce', team: 'Kansas City Chiefs' }).status).toBe('matched')
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

  test('plain roster miss (Kelce / Gabe / name not on a non-empty roster) is needs_review', () => {
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: null,
      matchStatus: 'unmatched',
    })).toEqual({ action: 'needs_review', reason: 'not_in_box' })
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: null,
      matchStatus: 'unmatched',
      bothRostersComplete: true,
    })).toEqual({ action: 'needs_review', reason: 'not_in_box' })
  })

  test('not_on_roster voids only with a verified numeric ESPN id absent from both complete rosters', () => {
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: null,
      matchStatus: 'unmatched',
      athleteId: '4241478',
      athleteIdVerified: true,
      bothRostersComplete: true,
      athleteOnEitherRoster: false,
    })).toEqual({ action: 'void', reason: 'not_on_roster' })
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: null,
      matchStatus: 'unmatched',
      athleteId: 'Darius Slayton',
      athleteIdVerified: false,
      bothRostersComplete: true,
      athleteOnEitherRoster: false,
    })).toEqual({ action: 'needs_review', reason: 'not_in_box' })
  })

  test('team_mismatch is needs_review unless the id is verified and both rosters are complete', () => {
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: null,
      matchStatus: 'team_mismatch',
    })).toEqual({ action: 'needs_review', reason: 'team_mismatch' })
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: null,
      matchStatus: 'team_mismatch',
      athleteId: '3139477',
      athleteIdVerified: true,
      bothRostersComplete: true,
      athleteOnEitherRoster: true,
    })).toEqual({ action: 'void', reason: 'not_on_roster' })
    expect(planNflMissingStatFromSources({
      settleReady: true,
      rosterOk: true,
      rosterMatch: null,
      matchStatus: 'unmatched',
    })).toEqual({ action: 'needs_review', reason: 'not_in_box' })
  })

  test('one-entry roster is not complete; 45-entry roster is', () => {
    const one = parseEspnNflEventRoster(eventRoster([rosterEntry()]))
    const full = parseEspnNflEventRoster(completeEventRoster([rosterEntry()]))
    expect(isNflEventRosterComplete(one)).toBe(false)
    expect(full.entries).toHaveLength(NFL_MIN_EVENT_ROSTER)
    expect(isNflEventRosterComplete(full)).toBe(true)
    expect(isNflEventRosterComplete(parseEspnNflEventRoster({
      entries: [rosterEntry()],
      count: 1,
      pageCount: 1,
    }))).toBe(false)
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

  test('missing kickoff logs that the 6h wait is blocked', () => {
    const log = { warn: jest.fn() }
    expect(warnNflMissingKickoff('401547353', {}, {}, log)).toBe(true)
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/6h wait blocked.*401547353/))
    expect(warnNflMissingKickoff('401547353', { header: { competitions: [{ date: KICKOFF }] } }, {}, log)).toBe(false)
  })

  test('dedupes last-name athlete candidates by playerId', () => {
    const entries = [
      { playerId: '15847', displayName: 'Kelce', athleteRef: 'a' },
      { playerId: '15847', displayName: 'Kelce', athleteRef: 'b' },
      { playerId: '3139477', displayName: 'Mahomes', athleteRef: 'c' },
    ]
    expect(dedupeRosterAthleteCandidates(entries).map((row) => row.athleteRef)).toEqual(['a', 'c'])
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
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW },
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
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW, team: 'PHI' },
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

  test('name-only Slayton miss is needs_review, not a not_on_roster void', async () => {
    mockEspn()
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Darius Slayton',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW, team: 'NYG' },
    )
    expect(result).toMatchObject({
      didNotPlay: false,
      reason: 'not_in_box',
      value: null,
    })
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true })).toEqual({
      action: 'needs_review',
      reason: 'not_in_box',
    })
    expect(previewFromLookup(result, { playerName: 'Darius Slayton' })).toMatchObject({
      action: 'skip',
      newStatus: 'needs_review',
      reason: 'not_in_box',
    })
  })

  test('Slayton with a verified numeric ESPN id absent from both complete rosters voids as not_on_roster', async () => {
    mockEspn({
      homeRoster: completeEventRoster([
        rosterEntry({
          playerId: 3139477,
          displayName: 'Mahomes',
          athlete: { id: '3139477', fullName: 'Patrick Mahomes', displayName: 'Patrick Mahomes' },
        }),
      ], '12'),
      awayRoster: completeEventRoster([rosterEntry()], '9'),
      athletes: { 4241478: 'Darius Slayton' },
    })
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Darius Slayton',
      'player_receptions',
      {
        cache: createNflLookupCache(),
        sleep: async () => {},
        now: SETTLE_NOW,
        team: 'NYG',
        playerId: '4241478',
      },
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

  test('a verified Slayton id still needs_review when either event roster is under 45', async () => {
    mockEspn({
      athletes: { 4241478: 'Darius Slayton' },
    })
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Darius Slayton',
      'player_receptions',
      {
        cache: createNflLookupCache(),
        sleep: async () => {},
        now: SETTLE_NOW,
        playerId: '4241478',
      },
    )
    expect(result).toMatchObject({ didNotPlay: false, reason: 'not_in_box', value: null })
  })

  test('a non-numeric generator playerId cannot prove Slayton not_on_roster', async () => {
    mockEspn({
      homeRoster: completeEventRoster([
        rosterEntry({
          playerId: 3139477,
          displayName: 'Mahomes',
          athlete: { id: '3139477', fullName: 'Patrick Mahomes', displayName: 'Patrick Mahomes' },
        }),
      ], '12'),
      awayRoster: completeEventRoster([rosterEntry()], '9'),
    })
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Darius Slayton',
      'player_receptions',
      {
        cache: createNflLookupCache(),
        sleep: async () => {},
        now: SETTLE_NOW,
        playerId: 'Darius Slayton',
      },
    )
    expect(result).toMatchObject({ didNotPlay: false, reason: 'not_in_box', value: null })
  })

  test('Kelce last-name-only and Gabe Davis nickname stay needs_review', async () => {
    mockEspn({
      homeRoster: eventRoster([
        rosterEntry({
          playerId: 15847,
          displayName: 'Kelce',
          athlete: { id: '15847', fullName: 'Travis Kelce', displayName: 'Travis Kelce' },
        }),
      ], '12'),
      awayRoster: eventRoster([
        rosterEntry({
          playerId: 4241478,
          displayName: 'Davis',
          athlete: { id: '4241478', fullName: 'Gabriel Davis', displayName: 'Gabriel Davis' },
        }),
      ]),
    })
    const kelce = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Kelce',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW, team: 'KC' },
    )
    const gabe = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Gabe Davis',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW, team: 'PHI' },
    )
    expect(kelce).toMatchObject({ reason: 'not_in_box', didNotPlay: false, value: null })
    expect(gabe).toMatchObject({ reason: 'not_in_box', didNotPlay: false, value: null })
    expect(planPlayerAppearanceGrade(kelce, { sport: 'nfl', gameFinal: true }).action).toBe('needs_review')
    expect(planPlayerAppearanceGrade(gabe, { sport: 'nfl', gameFinal: true }).action).toBe('needs_review')
  })

  test('null pick team still grades when the exact name is unique across both rosters', async () => {
    mockEspn()
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW, team: null },
    )
    expect(result).toMatchObject({
      value: 0,
      reason: 'appeared',
      matchStatus: 'matched',
    })
    expect(planPlayerAppearanceGrade(result, { sport: 'nfl', gameFinal: true })).toEqual({
      action: 'grade',
      reason: 'appeared',
      actualValue: 0,
    })
    expect(previewFromLookup(result)).toMatchObject({
      action: 'grade',
      actualValue: 0,
    })
  })

  test('Kansas City Chiefs matches KC and does not team_mismatch', async () => {
    mockEspn()
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      {
        cache: createNflLookupCache(),
        sleep: async () => {},
        now: SETTLE_NOW,
        team: 'Philadelphia Eagles',
        game: NFL_GAME,
      },
    )
    expect(result).toMatchObject({ value: 0, reason: 'appeared' })
  })

  test('pick team on the other sideline is needs_review without a verified ESPN id', async () => {
    mockEspn()
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW, team: 'KC' },
    )
    expect(result.reason).toBe('team_mismatch')
    expect(result.didNotPlay).toBe(false)
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
      { cache: createNflLookupCache(), sleep: async () => {}, now: SETTLE_NOW, team: 'PHI' },
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
      { cache, sleep, now: SETTLE_NOW, team: 'PHI' },
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

  test('hydrate copies roster rows and dedupes athlete fetches by playerId', async () => {
    const rawAway = eventRoster([
      rosterEntry({
        playerId: 1001,
        displayName: 'Fant',
        athlete: { $ref: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/athletes/1001' },
        statistics: { $ref: 'https://example.test/stats/1001' },
      }),
      rosterEntry({
        playerId: 1001,
        displayName: 'Fant',
        athlete: { $ref: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/athletes/1001' },
        statistics: { $ref: 'https://example.test/stats/1001' },
      }),
    ])
    const cache = createNflLookupCache()
    mockEspn({
      awayRoster: rawAway,
      athletes: { 1001: 'Noah Fant' },
    })
    const result = await lookupPlayerGameStat(
      COMPLETED_EVENT_ID,
      'Noah Fant',
      'player_receptions',
      { cache, sleep: async () => {}, now: SETTLE_NOW, team: 'PHI' },
    )
    expect(result).toMatchObject({ value: 0, reason: 'appeared' })
    expect(rawAway.entries[0].fullName).toBeUndefined()
    expect(rawAway.entries[0].name).toBeUndefined()
    const athleteCalls = global.fetch.mock.calls.filter(([url]) => (
      String(url).includes('/athletes/1001') && !String(url).includes('/eventlog') && !String(url).includes('/gamelog')
    ))
    expect(athleteCalls).toHaveLength(1)
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
  test('without verified Slayton ids the live split is 21 graded, 13 void, 2 needs_review', () => {
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
      matchStatus: 'unmatched',
    }))
    const rows = [...dressed, ...dnp, ...bagent, ...slayton]
    expect(rows).toHaveLength(36)
    expect(rows.filter((row) => row.action === 'grade' && row.actualValue === 0)).toHaveLength(21)
    expect(rows.filter((row) => row.action === 'void')).toHaveLength(13)
    expect(rows.filter((row) => row.reason === 'dnp_verified')).toHaveLength(11)
    expect(rows.filter((row) => row.reason === 'dnp_no_snap')).toHaveLength(2)
    expect(rows.filter((row) => row.reason === 'not_in_box')).toHaveLength(2)
  })

  test('Slayton voids only with verified id proof, restoring 21 graded / 15 void', () => {
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
      matchStatus: 'unmatched',
      athleteId: '4241478',
      athleteIdVerified: true,
      bothRostersComplete: true,
      athleteOnEitherRoster: false,
    }))
    const rows = [...dressed, ...dnp, ...bagent, ...slayton]
    expect(rows).toHaveLength(36)
    expect(rows.filter((row) => row.action === 'grade' && row.actualValue === 0)).toHaveLength(21)
    expect(rows.filter((row) => row.action === 'void')).toHaveLength(15)
    expect(rows.filter((row) => row.reason === 'not_on_roster')).toHaveLength(2)
  })
})
