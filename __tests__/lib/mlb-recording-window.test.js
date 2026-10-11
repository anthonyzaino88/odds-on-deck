import {
  MLB_RECORD_WINDOW_MINUTES,
  featuredMlbRecordDecision,
  hasMlbGameStarted,
  isConfirmedMlbBatter,
  isConfirmedMlbPitcher,
  isInMlbRecordWindow,
  isMlbPlayerConfirmedForProp,
  isMlbRecordingClockHour,
  isOpsWriteQuietPeriod,
  isPitcherProp,
  mlbMatchupDayKey,
  mlbPlayerNamesMatch,
  mlbPublishedRecordDecision,
  findMlbDoubleheaderIds,
  buildMlbFeaturedRequests,
} from '../../lib/mlb-recording-window.js'
import {
  fetchMlbConfirmedLineup,
  isMlbStatsDoubleheader,
  parseEspnProbablePitchers,
  parseMlbConfirmedLineup,
  pickScheduleGame,
} from '../../lib/mlb-confirmed-lineup.js'

const FIRST_PITCH = new Date('2026-10-11T23:10:00.000Z') // 7:10 PM EDT

function mlbProp(overrides = {}) {
  return {
    sport: 'mlb',
    playerName: 'Aaron Judge',
    type: 'batter_hits',
    pick: 'over',
    threshold: 0.5,
    odds: -110,
    edge: 0.04,
    qualityScore: 42,
    gameId: 'NYY_at_BOS_2026-10-11',
    ...overrides,
  }
}

function game(overrides = {}) {
  return {
    id: 'NYY_at_BOS_2026-10-11',
    sport: 'mlb',
    date: FIRST_PITCH.toISOString(),
    status: 'scheduled',
    mlbGameId: '778899',
    ...overrides,
  }
}

function lineup(overrides = {}) {
  return {
    batters: [{ fullName: 'Aaron Judge' }, { fullName: 'Juan Soto' }],
    pitchers: [],
    probableHome: { fullName: 'Gerrit Cole' },
    probableAway: { fullName: 'Tarik Skubal' },
    ...overrides,
  }
}

describe('MLB recording window', () => {
  test('opens 90 minutes before first pitch and closes at start', () => {
    expect(MLB_RECORD_WINDOW_MINUTES).toBe(90)
    expect(isInMlbRecordWindow(game(), new Date('2026-10-11T21:40:00.000Z'))).toBe(true)
    expect(isInMlbRecordWindow(game(), new Date('2026-10-11T21:39:00.000Z'))).toBe(false)
    expect(isInMlbRecordWindow(game(), FIRST_PITCH)).toBe(false)
    expect(isInMlbRecordWindow(game(), new Date('2026-10-11T23:11:00.000Z'))).toBe(false)
  })

  test('hasMlbGameStarted uses clock and status', () => {
    expect(hasMlbGameStarted(game(), new Date('2026-10-11T23:00:00.000Z'))).toBe(false)
    expect(hasMlbGameStarted(game(), FIRST_PITCH)).toBe(true)
    expect(hasMlbGameStarted(game({ status: 'in_progress' }), new Date('2026-10-11T22:00:00.000Z'))).toBe(true)
    expect(hasMlbGameStarted(game({ status: 'postponed' }), new Date('2026-10-11T22:00:00.000Z'))).toBe(true)
  })

  test('ops quiet period is :05–:15 ET inclusive', () => {
    // 2026-10-11 is EDT (UTC-4)
    expect(isOpsWriteQuietPeriod(new Date('2026-10-11T16:09:00.000Z'))).toBe(true) // 12:09 ET
    expect(isOpsWriteQuietPeriod(new Date('2026-10-11T16:05:00.000Z'))).toBe(true)
    expect(isOpsWriteQuietPeriod(new Date('2026-10-11T16:15:00.000Z'))).toBe(true)
    expect(isOpsWriteQuietPeriod(new Date('2026-10-11T16:16:00.000Z'))).toBe(false)
    expect(isOpsWriteQuietPeriod(new Date('2026-10-11T16:04:00.000Z'))).toBe(false)
  })

  test('recording hours are 11–22 ET regular, 12–22 postseason', () => {
    expect(isMlbRecordingClockHour(new Date('2026-07-15T15:16:00.000Z'))).toBe(true) // 11:16 ET
    expect(isMlbRecordingClockHour(new Date('2026-07-15T15:00:00.000Z'))).toBe(true) // 11:00 ET
    expect(isMlbRecordingClockHour(new Date('2026-07-15T14:46:00.000Z'))).toBe(false) // 10:46 ET
    expect(isMlbRecordingClockHour(new Date('2026-07-15T14:46:00.000Z'), { postseason: true })).toBe(false)
    expect(isMlbRecordingClockHour(new Date('2026-07-15T16:16:00.000Z'), { postseason: true })).toBe(true) // 12:16 ET
    expect(isMlbRecordingClockHour(new Date('2026-07-15T02:16:00.000Z'))).toBe(true) // 22:16 ET
    expect(isMlbRecordingClockHour(new Date('2026-07-15T03:16:00.000Z'))).toBe(false) // 23:16 ET
  })
})

describe('confirmed MLB starters', () => {
  test('matches names with Jr / initial drift', () => {
    expect(mlbPlayerNamesMatch('Aaron Judge', 'aaron judge')).toBe(true)
    expect(mlbPlayerNamesMatch('Gerrit Cole', 'G. Cole')).toBe(true)
    expect(mlbPlayerNamesMatch('Vladimir Guerrero Jr.', 'Vladimir Guerrero Jr')).toBe(true)
    expect(mlbPlayerNamesMatch('Aaron Judge', 'Juan Soto')).toBe(false)
    expect(mlbPlayerNamesMatch('José Ramírez', 'Jose Ramirez')).toBe(true)
    expect(mlbPlayerNamesMatch('Yandy Díaz', 'Yandy Diaz')).toBe(true)
    expect(mlbPlayerNamesMatch('Jeremy Peña', 'Jeremy Pena')).toBe(true)
    expect(mlbPlayerNamesMatch('Teoscar Hernández', 'Teoscar Hernandez')).toBe(true)
    expect(mlbPlayerNamesMatch('J.D. Martínez', 'JD Martinez')).toBe(true)
    expect(mlbPlayerNamesMatch('Salvador Pérez', 'Salvador Perez')).toBe(true)
    expect(mlbPlayerNamesMatch('Pablo López', 'Pablo Lopez')).toBe(true)
    expect(mlbPlayerNamesMatch('José Ramírez', 'Yandy Diaz')).toBe(false)
  })

  test('doubleheader ids share a matchup-day key and are skipped together', () => {
    const g1 = game({ id: 'NYY_at_BOS_2026-10-11', mlbGameId: '778801' })
    const g2 = game({
      id: 'NYY_at_BOS_2026-10-11_g2',
      mlbGameId: '778802',
      date: '2026-10-11T23:40:00.000Z',
    })
    expect(mlbMatchupDayKey(g1)).toBe(mlbMatchupDayKey(g2))
    expect([...findMlbDoubleheaderIds([g1, g2])].sort()).toEqual([
      'NYY_at_BOS_2026-10-11',
      'NYY_at_BOS_2026-10-11_g2',
    ])
    expect(findMlbDoubleheaderIds([g1]).size).toBe(0)
    expect(buildMlbFeaturedRequests([g1, game({ id: 'TOR_at_BAL_2026-10-11' })])).toEqual([
      { type: 'single_game', gameId: 'NYY_at_BOS_2026-10-11', gameIds: ['NYY_at_BOS_2026-10-11'] },
      { type: 'single_game', gameId: 'TOR_at_BAL_2026-10-11', gameIds: ['TOR_at_BAL_2026-10-11'] },
      {
        type: 'multi_game',
        gameId: null,
        gameIds: ['NYY_at_BOS_2026-10-11', 'TOR_at_BAL_2026-10-11'],
      },
    ])
  })

  test('batters need the batting order; pitchers need probable/starter', () => {
    const card = lineup()
    expect(isConfirmedMlbBatter('Aaron Judge', card)).toBe(true)
    expect(isConfirmedMlbBatter('Giancarlo Stanton', card)).toBe(false)
    expect(isConfirmedMlbPitcher('Gerrit Cole', card)).toBe(true)
    expect(isConfirmedMlbPitcher('Aaron Judge', card)).toBe(false)
    expect(isPitcherProp({ type: 'pitcher_strikeouts' })).toBe(true)
    expect(isMlbPlayerConfirmedForProp(mlbProp(), card)).toBe(true)
    expect(isMlbPlayerConfirmedForProp(mlbProp({
      playerName: 'Gerrit Cole',
      type: 'pitcher_strikeouts',
    }), card)).toBe(true)
    expect(isMlbPlayerConfirmedForProp(mlbProp({ playerName: 'Bench Bat' }), card)).toBe(false)
  })

  test('parseMlbConfirmedLineup reads schedule + boxscore shapes', () => {
    const parsed = parseMlbConfirmedLineup({
      game: {
        gamePk: 778899,
        teams: {
          home: { probablePitcher: { id: 1, fullName: 'Gerrit Cole' } },
          away: { probablePitcher: { id: 2, fullName: 'Tarik Skubal' } },
        },
        lineups: {
          home: [{ fullName: 'Aaron Judge' }, { fullName: 'Juan Soto' }],
        },
      },
      home: [{ fullName: 'Giancarlo Stanton', battingOrder: 5 }],
      away: [],
    })
    expect(parsed.probableHome.fullName).toBe('Gerrit Cole')
    expect(parsed.batters.map((p) => p.fullName)).toEqual(expect.arrayContaining([
      'Aaron Judge',
      'Juan Soto',
      'Giancarlo Stanton',
    ]))
    expect(parsed.doubleHeader).toBeNull()
  })

  test('skips StatsAPI doubleHeader Y and S on a collapsed single Game row', () => {
    expect(isMlbStatsDoubleheader('Y')).toBe(true)
    expect(isMlbStatsDoubleheader('S')).toBe(true)
    expect(isMlbStatsDoubleheader('N')).toBe(false)
    const chcBos = parseMlbConfirmedLineup({
      game: {
        gamePk: 776401,
        doubleHeader: 'S',
        gameNumber: 1,
        teams: { home: {}, away: {} },
      },
    })
    expect(chcBos).toMatchObject({
      mlbGameId: '776401',
      doubleHeader: 'S',
      gameNumber: 1,
    })
    expect(isMlbStatsDoubleheader(chcBos)).toBe(true)
    expect(mlbPublishedRecordDecision(mlbProp({
      gameId: 'CHC_at_BOS_2026-09-25',
    }), {
      now: new Date('2026-10-11T22:20:00.000Z'),
      gamesById: new Map([['CHC_at_BOS_2026-09-25', game({
        id: 'CHC_at_BOS_2026-09-25',
        mlbGameId: '776401',
      })]]),
      lineupsByGameId: new Map([['CHC_at_BOS_2026-09-25', {
        ...lineup(),
        doubleHeader: 'Y',
        gameNumber: 2,
      }]]),
    }).reason).toBe('mlb_doubleheader')
  })

  const SCHEDULE_824460 = {
    dates: [
      {
        date: '2026-04-04',
        games: [{
          gamePk: 824460,
          officialDate: '2026-04-04',
          doubleHeader: 'N',
          gameNumber: 1,
          status: { detailedState: 'Postponed', abstractGameState: 'Final' },
          teams: {
            home: { probablePitcher: { fullName: 'Stale Home' } },
            away: { probablePitcher: { fullName: 'Stale Away' } },
          },
        }],
      },
      {
        date: '2026-04-05',
        games: [{
          gamePk: 824460,
          officialDate: '2026-04-05',
          doubleHeader: 'Y',
          gameNumber: 2,
          status: { detailedState: 'Scheduled', abstractGameState: 'Preview' },
          teams: {
            home: { probablePitcher: { fullName: 'Live Home' } },
            away: { probablePitcher: { fullName: 'Live Away' } },
          },
        }],
      },
    ],
  }

  test('gamePk 824460 skips the postponed N entry and flags the replay DH', async () => {
    const picked = pickScheduleGame(SCHEDULE_824460, 824460)
    expect(picked).toMatchObject({
      officialDate: '2026-04-05',
      doubleHeader: 'Y',
      gameNumber: 2,
      status: { detailedState: 'Scheduled' },
    })
    expect(picked.teams.home.probablePitcher.fullName).toBe('Live Home')

    const parsed = await fetchMlbConfirmedLineup('824460', {
      fetchImpl: async () => ({
        ok: true,
        json: async () => SCHEDULE_824460,
      }),
      fetchBoxscoreLineup: async () => ({ home: [], away: [] }),
    })
    expect(parsed).toMatchObject({
      mlbGameId: '824460',
      doubleHeader: 'Y',
      gameNumber: 2,
      scheduleUnavailable: false,
    })
    expect(parsed.probableHome.fullName).toBe('Live Home')
    expect(parsed.probableAway.fullName).toBe('Live Away')
    expect(isMlbStatsDoubleheader(parsed)).toBe(true)
  })

  test('any schedule entry with doubleHeader Y or S flags the gamePk', () => {
    const parsed = parseMlbConfirmedLineup({
      game: {
        gamePk: 824460,
        officialDate: '2026-04-05',
        doubleHeader: 'N',
        gameNumber: 2,
        teams: { home: {}, away: {} },
      },
      scheduleGames: [
        { gamePk: 824460, doubleHeader: 'N' },
        { gamePk: 824460, doubleHeader: 'Y', gameNumber: 2 },
      ],
    })
    expect(parsed.doubleHeader).toBe('Y')
    expect(isMlbStatsDoubleheader(parsed)).toBe(true)
  })

  test('fetchMlbConfirmedLineup marks scheduleUnavailable on 500 or network error', async () => {
    const down = await fetchMlbConfirmedLineup('824460', {
      fetchImpl: async () => ({ ok: false, status: 500 }),
      fetchBoxscoreLineup: async () => ({
        home: [{ fullName: 'Aaron Judge' }],
        away: [],
      }),
    })
    expect(down.scheduleUnavailable).toBe(true)
    expect(down.doubleHeader).toBeNull()
    expect(down.batters.map((p) => p.fullName)).toContain('Aaron Judge')

    const thrown = await fetchMlbConfirmedLineup('824460', {
      fetchImpl: async () => { throw new Error('network') },
      fetchBoxscoreLineup: async () => ({ home: [], away: [] }),
    })
    expect(thrown.scheduleUnavailable).toBe(true)
  })

  test('parseEspnProbablePitchers reads the summary header', () => {
    const parsed = parseEspnProbablePitchers({
      header: {
        competitions: [{
          competitors: [
            { homeAway: 'home', probables: [{ athlete: { displayName: 'Gerrit Cole' } }] },
            { homeAway: 'away', probables: [{ athlete: { fullName: 'Tarik Skubal' } }] },
          ],
        }],
      },
    })
    expect(parsed.home.fullName).toBe('Gerrit Cole')
    expect(parsed.away.fullName).toBe('Tarik Skubal')
  })
})

describe('mlbPublishedRecordDecision', () => {
  const now = new Date('2026-10-11T22:20:00.000Z') // 50 min before
  const gate = {
    now,
    gamesById: new Map([[game().id, game()]]),
    lineupsByGameId: new Map([[game().id, lineup()]]),
  }

  test('NFL is unchanged', () => {
    expect(mlbPublishedRecordDecision({ sport: 'nfl', playerName: 'A' }, {})).toEqual({
      record: true,
      reason: 'not_mlb',
    })
  })

  test('morning persist without a gate skips MLB', () => {
    expect(mlbPublishedRecordDecision(mlbProp(), { now }).reason).toBe('mlb_game_missing')
    expect(mlbPublishedRecordDecision(mlbProp(), { now }).record).toBe(false)
  })

  test('records a confirmed batter in the window', () => {
    expect(mlbPublishedRecordDecision(mlbProp(), gate)).toEqual({
      record: true,
      reason: 'mlb_confirmed',
    })
  })

  test('fails closed when the schedule fetch is unavailable', () => {
    expect(mlbPublishedRecordDecision(mlbProp(), {
      ...gate,
      lineupsByGameId: new Map([[game().id, {
        ...lineup(),
        doubleHeader: null,
        scheduleUnavailable: true,
      }]]),
    })).toEqual({
      record: false,
      reason: 'mlb_schedule_unavailable',
    })
  })

  test('skips unconfirmed, started, outside window, and quiet period', () => {
    expect(mlbPublishedRecordDecision(mlbProp({ playerName: 'Bench Bat' }), gate).reason)
      .toBe('mlb_player_not_confirmed')
    expect(mlbPublishedRecordDecision(mlbProp(), {
      ...gate,
      now: new Date('2026-10-11T23:16:00.000Z'), // 7:16 PM ET — after first pitch, not quiet
    }).reason).toBe('mlb_game_started')
    expect(mlbPublishedRecordDecision(mlbProp(), {
      ...gate,
      now: new Date('2026-10-11T16:10:00.000Z'), // 8:10 AM ET, also quiet
    }).reason).toBe('ops_quiet_period')
    expect(mlbPublishedRecordDecision(mlbProp(), {
      ...gate,
      now: new Date('2026-10-11T20:00:00.000Z'), // 3.1h before
    }).reason).toBe('mlb_outside_window')
  })
})

describe('featuredMlbRecordDecision', () => {
  const now = new Date('2026-10-11T22:20:00.000Z')
  const gate = {
    now,
    gamesById: new Map([[game().id, game()]]),
    lineupsByGameId: new Map([[game().id, lineup()]]),
  }

  test('NFL featured does not need a lineup gate', () => {
    expect(featuredMlbRecordDecision({
      sport: 'nfl',
      legs: [{ sport: 'nfl', playerName: 'Geno Smith', gameId: 'g1' }],
    }, {})).toEqual({ record: true, reason: 'not_mlb' })
  })

  test('MLB featured without a gate is rejected so morning cannot lock the slot', () => {
    expect(featuredMlbRecordDecision({
      sport: 'mlb',
      legs: [mlbProp(), mlbProp({ playerName: 'Juan Soto', gameId: game().id }), mlbProp({
        playerName: 'Gerrit Cole',
        type: 'pitcher_strikeouts',
        gameId: game().id,
      })],
    }, { now }).reason).toBe('mlb_lineup_window')
  })

  test('MLB featured records when every leg is confirmed', () => {
    const parlay = {
      sport: 'mlb',
      legs: [
        mlbProp(),
        mlbProp({ playerName: 'Juan Soto' }),
        mlbProp({ playerName: 'Gerrit Cole', type: 'pitcher_strikeouts' }),
      ],
    }
    expect(featuredMlbRecordDecision(parlay, gate)).toEqual({
      record: true,
      reason: 'mlb_confirmed',
    })
  })
})
