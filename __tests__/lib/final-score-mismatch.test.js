import { readFileSync } from 'fs'
import { join } from 'path'
import {
  DEFAULT_SOURCE_FETCH_GAP_MS,
  ESPN_SUMMARY_URLS,
  FINAL_SCORE_MISMATCH_REASONS,
  collectFinalScoreMismatches,
  espnSummaryUrl,
  flagFinalScoreMismatch,
  formatFinalScoreMismatchLine,
  loadSourceFinalBox,
  mapEspnSummaryBox,
  mapMlbScheduleFinalBox,
  parseReportFinalScoreArgs,
  resolveReportSports,
} from '../../lib/final-score-mismatch.js'
import { mapNHLGameDetail, mapNHLStatus } from '../../lib/vendors/nhl-stats.js'
import { mapNFLGameDetail } from '../../lib/vendors/nfl-stats.js'
import { buildHydratedScheduleUrl } from '../../lib/vendors/stats.js'

const NJ_VGK = {
  id: 'NJ_at_VGK_2026-10-14',
  sport: 'nhl',
  status: 'final',
  espnGameId: '401772001',
  homeAbbr: 'VGK',
  awayAbbr: 'NJ',
  homeScore: 3,
  awayScore: 2,
}

const KC_BUF = {
  id: 'KC_at_BUF_2026-11-02',
  sport: 'nfl',
  status: 'final',
  espnGameId: '401772555',
  homeAbbr: 'BUF',
  awayAbbr: 'KC',
  homeScore: 30,
  awayScore: 21,
}

const CHW_HOU = {
  id: 'CHW_at_HOU_2026-10-01',
  sport: 'mlb',
  status: 'final',
  mlbGameId: '776543',
  espnGameId: '401696001',
  homeAbbr: 'HOU',
  awayAbbr: 'CHW',
  homeScore: 4,
  awayScore: 1,
}

function espnDetail({
  home = '5',
  away = '2',
  statusName = 'STATUS_FINAL',
  statusId = '3',
  state = 'post',
  homeAbbr = 'VGK',
  awayAbbr = 'NJ',
  id = '401772001',
} = {}) {
  return {
    header: {
      id,
      competitions: [{
        competitors: [
          { homeAway: 'home', score: home, team: { abbreviation: homeAbbr } },
          { homeAway: 'away', score: away, team: { abbreviation: awayAbbr } },
        ],
        status: { type: { id: statusId, name: statusName, state } },
      }],
    },
  }
}

function mlbScheduleGame({
  pk = '776543',
  homeRuns = 7,
  awayRuns = 2,
  homeAbbr = 'HOU',
  awayAbbr = 'CHW',
  coded = 'F',
} = {}) {
  return {
    gamePk: pk,
    status: {
      codedGameState: coded,
      abstractGameState: coded === 'F' ? 'Final' : 'Live',
      detailedState: coded === 'F' ? 'Final' : 'In Progress',
    },
    teams: {
      home: { score: homeRuns, team: { abbreviation: homeAbbr } },
      away: { score: awayRuns, team: { abbreviation: awayAbbr } },
    },
    linescore: {
      currentInning: 9,
      teams: { home: { runs: homeRuns }, away: { runs: awayRuns } },
    },
  }
}

describe('flagFinalScoreMismatch', () => {
  test('flags NJ@VGK when stored final disagrees with the ESPN box', () => {
    const source = mapNHLGameDetail(espnDetail({ home: '5', away: '2' }))
    expect(source).toMatchObject({
      status: 'final',
      homeScore: 5,
      awayScore: 2,
      homeAbbr: 'VGK',
      awayAbbr: 'NJ',
    })
    const flag = flagFinalScoreMismatch(NJ_VGK, source)
    expect(flag).toMatchObject({
      reason: FINAL_SCORE_MISMATCH_REASONS.SCORE_DISAGREE,
      gameId: NJ_VGK.id,
      stored: { homeScore: 3, awayScore: 2 },
      source: { homeScore: 5, awayScore: 2 },
    })
    expect(formatFinalScoreMismatchLine(flag)).toMatch(/NJ@VGK/)
    expect(formatFinalScoreMismatchLine(flag)).toMatch(/stored=2-3/)
    expect(formatFinalScoreMismatchLine(flag)).toMatch(/source=2-5/)
  })

  test('flags NFL and MLB score / team / missing-source cases', () => {
    const nflSource = mapEspnSummaryBox(espnDetail({
      id: KC_BUF.espnGameId,
      home: '34',
      away: '21',
      homeAbbr: 'BUF',
      awayAbbr: 'KC',
    }))
    expect(mapNFLGameDetail(espnDetail({
      id: KC_BUF.espnGameId,
      home: '34',
      away: '21',
      homeAbbr: 'BUF',
      awayAbbr: 'KC',
      state: 'post',
    }))).toMatchObject({ homeAbbr: 'BUF', awayAbbr: 'KC', homeScore: 34 })
    expect(flagFinalScoreMismatch(KC_BUF, nflSource)).toMatchObject({
      reason: FINAL_SCORE_MISMATCH_REASONS.SCORE_DISAGREE,
      sport: 'nfl',
      stored: { homeScore: 30, awayScore: 21 },
      source: { homeScore: 34, awayScore: 21 },
    })

    const mlbSource = mapMlbScheduleFinalBox(mlbScheduleGame({ homeRuns: 7, awayRuns: 2 }))
    expect(mlbSource).toMatchObject({
      status: 'final',
      homeScore: 7,
      awayScore: 2,
      homeAbbr: 'HOU',
      awayAbbr: 'CHW',
      mlbGameId: '776543',
    })
    expect(flagFinalScoreMismatch(CHW_HOU, mlbSource)).toMatchObject({
      reason: FINAL_SCORE_MISMATCH_REASONS.SCORE_DISAGREE,
      sport: 'mlb',
    })
    expect(flagFinalScoreMismatch(CHW_HOU, {
      ...mlbSource,
      homeScore: 4,
      awayScore: 1,
      homeAbbr: 'TEX',
    }).reason).toBe(FINAL_SCORE_MISMATCH_REASONS.TEAM_DISAGREE)
    expect(flagFinalScoreMismatch(KC_BUF, null).reason).toBe(
      FINAL_SCORE_MISMATCH_REASONS.SOURCE_MISSING,
    )
  })

  test('returns null when stored and source finals agree', () => {
    const source = mapNHLGameDetail(espnDetail({ home: '3', away: '2' }))
    expect(flagFinalScoreMismatch(NJ_VGK, source)).toBeNull()
    expect(flagFinalScoreMismatch(
      CHW_HOU,
      mapMlbScheduleFinalBox(mlbScheduleGame({ homeRuns: 4, awayRuns: 1 })),
    )).toBeNull()
  })

  test('flags a missing or non-final source without writing', () => {
    expect(flagFinalScoreMismatch(NJ_VGK, null).reason).toBe(
      FINAL_SCORE_MISMATCH_REASONS.SOURCE_MISSING,
    )
    const live = mapNHLGameDetail(espnDetail({
      statusName: 'STATUS_IN_PROGRESS',
      statusId: '2',
      state: 'in',
      home: '1',
      away: '0',
    }))
    expect(flagFinalScoreMismatch(NJ_VGK, live).reason).toBe(
      FINAL_SCORE_MISMATCH_REASONS.SOURCE_NOT_FINAL,
    )
    expect(flagFinalScoreMismatch({ ...NJ_VGK, status: 'in_progress' }, live)).toBeNull()
  })

  test('collects mismatches by game id, espnGameId, or mlbGameId', () => {
    const source = mapNHLGameDetail(espnDetail({ home: '4', away: '1' }))
    const flags = collectFinalScoreMismatches(
      [NJ_VGK],
      new Map([[NJ_VGK.espnGameId, source]]),
    )
    expect(flags).toHaveLength(1)
    expect(flags[0].reason).toBe(FINAL_SCORE_MISMATCH_REASONS.SCORE_DISAGREE)

    const mlb = mapMlbScheduleFinalBox(mlbScheduleGame({ homeRuns: 9, awayRuns: 0 }))
    const mlbFlags = collectFinalScoreMismatches(
      [CHW_HOU],
      new Map([[CHW_HOU.mlbGameId, mlb]]),
      { sport: 'all' },
    )
    expect(mlbFlags[0].sport).toBe('mlb')
    expect(mlbFlags[0].reason).toBe(FINAL_SCORE_MISMATCH_REASONS.SCORE_DISAGREE)
  })
})

describe('source loaders', () => {
  test('MLB prefers StatsAPI by mlbGameId and falls back to ESPN', async () => {
    const urls = []
    const statsPayload = {
      dates: [{ games: [mlbScheduleGame({ homeRuns: 7, awayRuns: 2 })] }],
    }
    const source = await loadSourceFinalBox(CHW_HOU, {
      fetchJson: async (url) => {
        urls.push(url)
        if (String(url).includes('statsapi.mlb.com')) return statsPayload
        throw new Error('espn should not run when StatsAPI maps')
      },
    })
    expect(urls[0]).toBe(buildHydratedScheduleUrl({ gamePk: CHW_HOU.mlbGameId }))
    expect(source).toMatchObject({ status: 'final', homeScore: 7, awayScore: 2, homeAbbr: 'HOU' })

    const espnOnly = await loadSourceFinalBox(
      { ...CHW_HOU, mlbGameId: null },
      {
        fetchJson: async (url) => {
          expect(url).toBe(espnSummaryUrl('mlb', CHW_HOU.espnGameId))
          return espnDetail({
            id: CHW_HOU.espnGameId,
            home: '4',
            away: '1',
            homeAbbr: 'HOU',
            awayAbbr: 'CWS',
          })
        },
      },
    )
    expect(espnOnly).toMatchObject({ status: 'final', homeScore: 4, awayScore: 1, awayAbbr: 'CWS' })
  })

  test('NFL and NHL load ESPN summary URLs', async () => {
    const nfl = await loadSourceFinalBox(KC_BUF, {
      fetchJson: async (url) => {
        expect(url).toBe(espnSummaryUrl('nfl', KC_BUF.espnGameId))
        return espnDetail({
          id: KC_BUF.espnGameId,
          home: '30',
          away: '21',
          homeAbbr: 'BUF',
          awayAbbr: 'KC',
        })
      },
    })
    expect(nfl).toMatchObject({ status: 'final', homeScore: 30, awayScore: 21, homeAbbr: 'BUF' })

    const nhl = await loadSourceFinalBox(NJ_VGK, {
      fetchJson: async (url) => {
        expect(url).toBe(`${ESPN_SUMMARY_URLS.nhl}?event=${NJ_VGK.espnGameId}`)
        return espnDetail({ home: '3', away: '2' })
      },
    })
    expect(nhl).toMatchObject({ status: 'final', homeScore: 3, awayScore: 2 })
  })

  test('missing ids return source_missing rather than a boxed score', async () => {
    expect(await loadSourceFinalBox({ sport: 'mlb', status: 'final' })).toBeNull()
    expect(await loadSourceFinalBox({ sport: 'nfl', status: 'final' })).toBeNull()
  })
})

describe('mapNHLStatus halftime', () => {
  test('maps STATUS_HALFTIME instead of falling through to scheduled', () => {
    expect(mapNHLStatus({ type: { name: 'STATUS_HALFTIME' } })).toBe('halftime')
    expect(mapNHLStatus({ type: { id: '2', name: 'STATUS_HALFTIME' } })).toBe('halftime')
    expect(mapNHLStatus({ type: { id: '2', name: 'STATUS_END_PERIOD' } })).toBe('in_progress')
  })
})

describe('report-final-score-mismatch script', () => {
  test('is read-only, covers mlb|nfl|nhl|all, and does not call The Odds API', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/report-final-score-mismatch.js'), 'utf8')
    expect(src).toMatch(/Does not write/)
    expect(src).toMatch(/Does not call The Odds API/)
    expect(src).toMatch(/loadSourceFinalBox/)
    expect(src).toMatch(/DEFAULT_SOURCE_FETCH_GAP_MS/)
    expect(src).not.toMatch(/from\('Game'\)[\s\S]{0,200}\.update\(/)
    expect(src).not.toMatch(/the-odds-api|ODDS_API_KEY/)
    expect(parseReportFinalScoreArgs(['--sport', 'all', '--days', '7'])).toMatchObject({
      sport: 'all',
      days: 7,
    })
    expect(resolveReportSports('all')).toEqual(['mlb', 'nfl', 'nhl'])
    expect(resolveReportSports('mlb')).toEqual(['mlb'])
    expect(DEFAULT_SOURCE_FETCH_GAP_MS).toBeGreaterThanOrEqual(100)
  })

  test('runFinalScoreMismatchReport rate-limits source fetches and writes nothing', async () => {
    const { runFinalScoreMismatchReport } = await import(
      '../../scripts/report-final-score-mismatch.js'
    )
    const waits = []
    const fetched = []
    const games = [
      { ...CHW_HOU, home: { abbr: 'HOU' }, away: { abbr: 'CHW' } },
      { ...KC_BUF, home: { abbr: 'BUF' }, away: { abbr: 'KC' } },
    ]
    const supabase = {
      from() {
        return {
          select() { return this },
          eq() { return this },
          gte() { return this },
          order() { return this },
          limit() {
            return Promise.resolve({ data: games.splice(0, 1), error: null })
          },
        }
      },
    }
    const result = await runFinalScoreMismatchReport({
      argv: ['--sport', 'all', '--days', '3'],
      supabase,
      loadSource: async (row) => {
        fetched.push(row.sport)
        if (row.sport === 'mlb') {
          return mapMlbScheduleFinalBox(mlbScheduleGame({ homeRuns: 4, awayRuns: 1 }))
        }
        return mapEspnSummaryBox(espnDetail({
          home: '30',
          away: '21',
          homeAbbr: 'BUF',
          awayAbbr: 'KC',
        }))
      },
      wait: async (ms) => { waits.push(ms) },
      gapMs: 200,
      stdout: { log() {} },
    })
    expect(fetched).toEqual(['mlb', 'nfl'])
    expect(waits).toEqual([200])
    expect(result.scanned).toBe(2)
    expect(result.mismatches).toEqual([])
  })
})
