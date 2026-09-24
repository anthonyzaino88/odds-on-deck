/**
 * Real MLB Stats API payloads captured 2026-09-24 from:
 *   GET /api/v1/schedule?sportId=1&date=2026-09-23&hydrate=linescore
 *   GET /api/v1/game/824785/linescore
 *   GET /api/v1/schedule?sportId=1&gamePk=824785&hydrate=linescore
 *
 * Trimmed to the fields the mapper/updater read. Status lives on the
 * schedule game object, never on the linescore object.
 */

export const TOR_BAL_GAME_PK = 824785
export const CIN_ATL_GAME_PK = 824868
export const LAA_ATH_GAME_PK = 824951

/** TOR@BAL 2026-09-23 — Final. Leftover balls=2 / strikes=3 with outs=3. */
export const SCHEDULE_GAME_TOR_BAL_FINAL = {
  gamePk: TOR_BAL_GAME_PK,
  gameDate: '2026-09-23T17:35:00Z',
  officialDate: '2026-09-23',
  status: {
    abstractGameState: 'Final',
    codedGameState: 'F',
    detailedState: 'Final',
    statusCode: 'F',
    startTimeTBD: false,
    abstractGameCode: 'F',
  },
  teams: {
    away: { team: { id: 141, name: 'Toronto Blue Jays' }, score: 2, isWinner: false },
    home: { team: { id: 110, name: 'Baltimore Orioles' }, score: 4, isWinner: true },
  },
  linescore: {
    currentInning: 9,
    currentInningOrdinal: '9th',
    inningState: 'Top',
    inningHalf: 'Top',
    isTopInning: true,
    scheduledInnings: 9,
    teams: { away: { runs: 2 }, home: { runs: 4 } },
    offense: { batter: { id: 664770 } },
    defense: { pitcher: { id: 552640 } },
    balls: 2,
    strikes: 3,
    outs: 3,
  },
}

/** Same gamePk on 2026-09-22 — rain postponement, no linescore. */
export const SCHEDULE_GAME_TOR_BAL_POSTPONED = {
  gamePk: TOR_BAL_GAME_PK,
  gameDate: '2026-09-22T22:35:00Z',
  officialDate: '2026-09-23',
  rescheduleDate: '2026-09-23T17:35:00Z',
  rescheduleGameDate: '2026-09-23',
  status: {
    abstractGameState: 'Final',
    codedGameState: 'D',
    detailedState: 'Postponed',
    statusCode: 'DR',
    startTimeTBD: false,
    reason: 'Rain',
    abstractGameCode: 'F',
  },
  teams: {
    away: { team: { id: 141, name: 'Toronto Blue Jays' } },
    home: { team: { id: 110, name: 'Baltimore Orioles' } },
  },
}

/** CIN@ATL 2026-09-23 — walk-off Final in the 10th. outs=1, leftover count. */
export const SCHEDULE_GAME_CIN_ATL_WALKOFF_FINAL = {
  gamePk: CIN_ATL_GAME_PK,
  gameDate: '2026-09-23T23:15:00Z',
  officialDate: '2026-09-23',
  status: {
    abstractGameState: 'Final',
    codedGameState: 'F',
    detailedState: 'Final',
    statusCode: 'F',
    startTimeTBD: false,
    abstractGameCode: 'F',
  },
  teams: {
    away: { team: { id: 113, name: 'Cincinnati Reds' }, score: 2, isWinner: false },
    home: { team: { id: 144, name: 'Atlanta Braves' }, score: 3, isWinner: true },
  },
  linescore: {
    currentInning: 10,
    currentInningOrdinal: '10th',
    inningState: 'Bottom',
    inningHalf: 'Bottom',
    isTopInning: false,
    scheduledInnings: 9,
    teams: { away: { runs: 2 }, home: { runs: 3 } },
    offense: { batter: { id: 643289 }, first: { id: 643289 } },
    defense: { pitcher: { id: 682825 } },
    balls: 3,
    strikes: 2,
    outs: 1,
  },
}

/** LAA@ATH 2026-09-23 — genuinely Live / In Progress. */
export const SCHEDULE_GAME_LAA_ATH_LIVE = {
  gamePk: LAA_ATH_GAME_PK,
  gameDate: '2026-09-24T01:40:00Z',
  officialDate: '2026-09-23',
  status: {
    abstractGameState: 'Live',
    codedGameState: 'I',
    detailedState: 'In Progress',
    statusCode: 'I',
    startTimeTBD: false,
    abstractGameCode: 'L',
  },
  teams: {
    away: { team: { id: 108, name: 'Los Angeles Angels' }, score: 3 },
    home: { team: { id: 133, name: 'Athletics' }, score: 5 },
  },
  linescore: {
    currentInning: 6,
    currentInningOrdinal: '6th',
    inningState: 'Bottom',
    inningHalf: 'Bottom',
    isTopInning: false,
    scheduledInnings: 9,
    teams: { away: { runs: 3 }, home: { runs: 5 } },
    offense: { batter: { id: 675961 } },
    defense: { pitcher: { id: 820862 } },
    balls: 1,
    strikes: 1,
    outs: 0,
  },
}

/** Raw per-game linescore for TOR@BAL — no status object. */
export const LINESCORE_ONLY_TOR_BAL = {
  currentInning: 9,
  currentInningOrdinal: '9th',
  inningState: 'Top',
  inningHalf: 'Top',
  isTopInning: true,
  scheduledInnings: 9,
  teams: { away: { runs: 2 }, home: { runs: 4 } },
  offense: { batter: { id: 664770 } },
  defense: { pitcher: { id: 552640 } },
  balls: 2,
  strikes: 3,
  outs: 3,
}

/** Envelope returned by schedule?date=2026-09-23&hydrate=linescore (subset). */
export const SCHEDULE_HYDRATE_2026_09_23 = {
  copyright: 'Copyright 2026 MLB Advanced Media, L.P.',
  totalItems: 3,
  totalEvents: 0,
  totalGames: 3,
  totalGamesInProgress: 1,
  dates: [
    {
      date: '2026-09-23',
      games: [
        SCHEDULE_GAME_TOR_BAL_FINAL,
        SCHEDULE_GAME_CIN_ATL_WALKOFF_FINAL,
        SCHEDULE_GAME_LAA_ATH_LIVE,
      ],
    },
  ],
}

/** Envelope returned by schedule?gamePk=824785&hydrate=linescore. */
export const SCHEDULE_HYDRATE_GAMEPK_824785 = {
  totalItems: 2,
  totalGames: 2,
  dates: [
    { date: '2026-09-22', games: [SCHEDULE_GAME_TOR_BAL_POSTPONED] },
    { date: '2026-09-23', games: [SCHEDULE_GAME_TOR_BAL_FINAL] },
  ],
}

/** ESPN scoreboard-shaped header for TOR@BAL (event 401923610). */
export const ESPN_SUMMARY_TOR_BAL_FINAL = {
  header: {
    competitions: [
      {
        status: {
          period: 9,
          type: {
            name: 'STATUS_FINAL',
            completed: true,
            state: 'post',
            shortDetail: 'Final',
          },
        },
        competitors: [
          { homeAway: 'away', score: '2' },
          { homeAway: 'home', score: '4' },
        ],
      },
    ],
  },
}

/** ESPN scoreboard-shaped header for LAA@ATH while live. */
export const ESPN_SUMMARY_LAA_ATH_LIVE = {
  header: {
    competitions: [
      {
        status: {
          period: 6,
          type: {
            name: 'STATUS_IN_PROGRESS',
            completed: false,
            state: 'in',
            shortDetail: 'Bot 6th',
          },
        },
        competitors: [
          { homeAway: 'away', score: '3' },
          { homeAway: 'home', score: '5' },
        ],
      },
    ],
  },
}
