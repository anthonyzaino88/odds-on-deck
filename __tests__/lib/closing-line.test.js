import {
  CLOSE_CAPTURE_MIN_LEAD_MINUTES,
  CLOSE_CAPTURE_NEAR_START_MIN_LEAD_MINUTES,
  CLOSE_CAPTURE_NEAR_START_MINUTES,
  CLOSE_CAPTURE_PROPOSED_ROUTINE_MINUTES,
  CLOSE_CAPTURE_RECOMMENDED_CRON,
  CLOSE_CAPTURE_ROUTINE_MINUTES,
  CLOSE_CAPTURE_WINDOW_MINUTES,
  applyPublishedCloseUpdate,
  closeCapturePassForGame,
  closeCaptureRoutineMissesNearStart,
  formatCloseCaptureCounts,
  formatCloseCaptureStatus,
  nearStartKickoffMinutesCoveredByRoutine,
  CLOSE_ODDS_FIELDS,
  buildEventOddsUrl,
  closeCapturePayload,
  closeUpdateRowCount,
  clvFromOdds,
  estimateCloseCaptureCalls,
  estimateCloseCaptureCost,
  flattenEventOddsQuotes,
  gameIsInCloseWindow,
  groupCaptureJobsByOddsApiEventId,
  hasCloseAlready,
  isCloseCaptureCandidate,
  isOpsWriteQuietPeriod,
  shouldSkipPaidCloseCaptureFetch,
  CLOSE_CAPTURE_PAID_FETCH_CUTOFF_SECOND,
  marketsForPublishedPicks,
  marketsForCaptureJob,
  marketsForQuoteMatch,
  marketsToRequestForPick,
  matchClosingQuote,
  alternateMarketKey,
  consensusClosingQuote,
  describeSkippedTeamOutcome,
  describeSkippedTotalOutcome,
  formatGameLineCloseCounts,
  shouldRequestAlternateMarket,
  oddsApiSportKey,
  parseOddsApiQuota,
  buildSportsQuotaProbeUrl,
  plannedCloseCaptureHttpCalls,
  publishedMarketKey,
  resetCloseColumnCache,
  resetClosingOddsWriteGuard,
  selectCloseCaptureJobsWithinBudget,
  capturedNflGameLineGameIds,
  closeCaptureRowId,
  isCloseCaptureClosingOddsRow,
  isDuplicateClosingOddsError,
  fillMissingNflGameLineAttempts,
  CLOSE_CAPTURE_ATTEMPTED_BOOK,
  CLOSE_CAPTURE_ID_PREFIX,
  CLOSING_ODDS_PKEY,
  CLOSING_ODDS_CLOSE_CAPTURE_UNIQ,
  POSTGRES_UNIQUE_VIOLATION,
  closingTotalsByGame,
  closingTotalOverUnderPrices,
  filterClosingOddsForResearchArchive,
  selectClosingTotalRow,
  closeCaptureJobPriority,
  sortCloseCaptureJobs,
  summarizePublishedClv,
  summarizePublicPublishedClv,
  updateWithOptionalCloseOdds,
  withoutCloseOddsFields,
  writeGameLineCloses,
  shouldSkipLiveCloseOverwrite,
  filterNewClosingOddsRows,
  formatCallsUsed,
  gameLineClosesFromEventOdds,
  gameLineClosesForCaptureJob,
  gameLineClosesForSportEvent,
  gameLineMarketsAlreadyCaptured,
  gameLineQuoteCloseDecision,
  gameLineQuoteFitsClose,
  nflGameLineMarketsAlreadyCaptured,
  loadExistingClosingOdds,
  setClosingOddsClock,
  buildSportOddsUrl,
  clusterGameLineCloseTargets,
  selectGameLineCloseTargets,
  selectGameLineClustersWithinBudget,
  gameLineCloseMarkets,
  includeNflWindowGamesForGameLines,
  isNflAllPendingProp,
  isTargetedCloseCapturePick,
  NFL_GAME_LINE_MARKETS,
} from '../../lib/closing-line.js'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

beforeEach(() => {
  resetCloseColumnCache()
  resetClosingOddsWriteGuard()
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
    expect(oddsApiSportKey('nhl')).toBe('icehockey_nhl')
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

  test('marketsForCaptureJob merges NFL game lines onto the same call only with --nfl-all', () => {
    const job = {
      game: { sport: 'nfl' },
      picks: [{ propType: 'player_receptions' }, { propType: 'rush_yds' }],
    }
    expect(marketsForCaptureJob(job)).toEqual([
      'player_receptions', 'player_receptions_alternate',
      'player_rush_yds', 'player_rush_yds_alternate',
    ])
    expect(marketsForCaptureJob(job, { nflAll: true }).sort()).toEqual([
      'h2h',
      'player_receptions',
      'player_receptions_alternate',
      'player_rush_yds',
      'player_rush_yds_alternate',
      'spreads',
      'totals',
    ])
    expect(marketsForCaptureJob({
      game: { sport: 'mlb' },
      picks: [{ propType: 'batter_hits' }],
    }, { nflAll: true })).toEqual(['batter_hits'])
    expect(NFL_GAME_LINE_MARKETS).toEqual(['h2h', 'spreads', 'totals'])
    expect(alternateMarketKey('player_pass_yds')).toBe('player_pass_yds_alternate')
    expect(marketsForQuoteMatch({ propType: 'pass_yds', sport: 'nfl' }).sort()).toEqual([
      'player_pass_yds',
      'player_pass_yds_alternate',
    ])
  })

  test('does not request NHL/MLB *_alternate markets; NFL only when source is alternate or unknown', () => {
    expect(marketsToRequestForPick({
      propType: 'player_shots_on_goal',
      sport: 'nhl',
    })).toEqual(['player_shots_on_goal'])
    expect(marketsForPublishedPicks([
      { propType: 'player_shots_on_goal', sport: 'nhl' },
      { propType: 'player_points', sport: 'nhl' },
    ], { sport: 'nhl' }).sort()).toEqual(['player_points', 'player_shots_on_goal'])
    expect(marketsForCaptureJob({
      game: { sport: 'nhl' },
      picks: [{ propType: 'player_shots_on_goal', sport: 'nhl' }],
    })).toEqual(['player_shots_on_goal'])
    expect(shouldRequestAlternateMarket({ propType: 'pass_yds' })).toBe(false)
    expect(shouldRequestAlternateMarket({ propType: 'pass_yds', sport: 'nfl' })).toBe(true)
    expect(marketsToRequestForPick({
      propType: 'pass_yds',
      sport: 'nfl',
      sourceMarket: 'player_pass_yds',
    })).toEqual(['player_pass_yds'])
    expect(marketsToRequestForPick({
      propType: 'pass_yds',
      sport: 'nfl',
      sourceMarket: 'player_pass_yds_alternate',
    })).toEqual(['player_pass_yds_alternate'])
    expect(marketsToRequestForPick({
      propType: 'pass_yds',
      sport: 'nfl',
    }).sort()).toEqual(['player_pass_yds', 'player_pass_yds_alternate'])
    expect(marketsForCaptureJob({
      game: { sport: 'nfl' },
      picks: [{ propType: 'pass_yds', sport: 'nfl', sourceMarket: 'player_pass_yds' }],
    }, { nflAll: true }).sort()).toEqual(['h2h', 'player_pass_yds', 'spreads', 'totals'])
  })

  test('planned HTTP calls include the quota probe and honor --max-calls', () => {
    expect(plannedCloseCaptureHttpCalls({ jobCount: 3 })).toBe(4)
    expect(plannedCloseCaptureHttpCalls({ jobCount: 3, maxCalls: 2 })).toBe(2)
    expect(plannedCloseCaptureHttpCalls({ jobCount: 3, maxCalls: 0 })).toBe(0)
    expect(plannedCloseCaptureHttpCalls({ jobCount: 0 })).toBe(0)
    expect(plannedCloseCaptureHttpCalls({
      jobs: [
        { eventId: 'evt-1', game: { sport: 'nfl' } },
        { eventId: null, game: { sport: 'nfl' } },
        { eventId: 'evt-2', game: { sport: 'nfl' } },
      ],
    })).toBe(3)
    expect(formatCallsUsed(2)).toBe('CALLS_USED=2')
    expect(formatCallsUsed(0)).toBe('CALLS_USED=0')
  })

  test('selectCloseCaptureJobsWithinBudget stops before exceeding --max-credits', () => {
    const soon = {
      gameId: 'soon',
      gameIds: ['soon'],
      eventId: 'evt-soon',
      game: { sport: 'nfl', date: '2026-07-15T23:00:00.000Z' },
      picks: [{ propType: 'player_receptions' }],
    }
    const later = {
      gameId: 'later',
      gameIds: ['later'],
      eventId: 'evt-later',
      game: { sport: 'nfl', date: '2026-07-15T23:16:00.000Z' },
      picks: [{ propType: 'player_receptions' }],
    }
    const picked = selectCloseCaptureJobsWithinBudget([soon, later], {
      nflAll: true,
      maxCredits: 5,
    })
    expect(picked.jobs.map((job) => job.gameId)).toEqual(['soon'])
    expect(picked.plannedCredits).toBe(5)
    expect(picked.plannedCalls).toBe(2)
    expect(selectCloseCaptureJobsWithinBudget([soon, later], {
      nflAll: true,
      maxCredits: 4,
    }).jobs).toEqual([])
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

  test('shouldSkipPaidCloseCaptureFetch is true at/after :04:30 ET and false before', () => {
    expect(CLOSE_CAPTURE_PAID_FETCH_CUTOFF_SECOND).toBe(30)
    expect(shouldSkipPaidCloseCaptureFetch(new Date('2026-07-15T20:04:29.000Z'))).toBe(false)
    expect(shouldSkipPaidCloseCaptureFetch(new Date('2026-07-15T20:04:30.000Z'))).toBe(true)
    expect(shouldSkipPaidCloseCaptureFetch(new Date('2026-07-15T20:04:45.000Z'))).toBe(true)
    expect(shouldSkipPaidCloseCaptureFetch(new Date('2026-07-15T20:05:00.000Z'))).toBe(false)
    expect(shouldSkipPaidCloseCaptureFetch(new Date('2026-07-15T20:00:00.000Z'))).toBe(false)
  })

  test('gameIsInCloseWindow is T−35 inclusive through T−1 exclusive', () => {
    const now = new Date('2026-07-15T22:00:00.000Z')
    expect(gameIsInCloseWindow({ date: '2026-07-15T22:35:00.000Z' }, now)).toBe(true)
    expect(gameIsInCloseWindow({ date: '2026-07-15T22:30:00.000Z' }, now)).toBe(true)
    expect(gameIsInCloseWindow({ date: '2026-07-15T22:01:00.001Z' }, now)).toBe(true)
    expect(gameIsInCloseWindow({ date: '2026-07-15T22:01:00.000Z' }, now)).toBe(false)
    expect(gameIsInCloseWindow({ date: '2026-07-15T22:00:30.000Z' }, now)).toBe(false)
    expect(gameIsInCloseWindow({ date: '2026-07-15T22:36:00.000Z' }, now)).toBe(false)
    expect(gameIsInCloseWindow({ date: '2026-07-15T21:59:00.000Z' }, now)).toBe(false)
    expect(gameIsInCloseWindow({ date: now.toISOString() }, now)).toBe(false)
    expect(CLOSE_CAPTURE_WINDOW_MINUTES).toBe(35)
    expect(CLOSE_CAPTURE_MIN_LEAD_MINUTES).toBe(1)
    expect(CLOSE_CAPTURE_NEAR_START_MINUTES).toBe(10)
    expect(CLOSE_CAPTURE_NEAR_START_MIN_LEAD_MINUTES).toBe(1)
  })

  test('closeCapturePassForGame splits early T−35..T−10 from near-start T−10..T−1', () => {
    const now = new Date('2026-07-15T22:00:00.000Z')
    expect(closeCapturePassForGame({ date: '2026-07-15T22:35:00.000Z', status: 'scheduled' }, now)).toBe('early')
    expect(closeCapturePassForGame({ date: '2026-07-15T22:11:00.000Z', status: 'scheduled' }, now)).toBe('early')
    expect(closeCapturePassForGame({ date: '2026-07-15T22:10:00.000Z', status: 'scheduled' }, now)).toBe('near-start')
    expect(closeCapturePassForGame({ date: '2026-07-15T22:01:00.001Z', status: 'scheduled' }, now)).toBe('near-start')
    expect(closeCapturePassForGame({ date: '2026-07-15T22:01:00.000Z', status: 'scheduled' }, now)).toBe(null)
    expect(closeCapturePassForGame({ date: now.toISOString(), status: 'scheduled' }, now)).toBe(null)
    expect(isCloseCaptureCandidate({ date: '2026-07-15T22:05:00.000Z', status: 'scheduled' }, now)).toBe(true)
    expect(isCloseCaptureCandidate({ date: '2026-07-15T22:05:00.000Z', status: 'in_progress' }, now)).toBe(false)
  })

  test(':16/:46 ET misses most near-start kickoffs; recommended 8–22 cron covers morning games', () => {
    expect(CLOSE_CAPTURE_RECOMMENDED_CRON).toBe('0,4,16,26,36,46,56 8-22 * * *')
    expect(CLOSE_CAPTURE_PROPOSED_ROUTINE_MINUTES).toEqual([0, 4, 16, 26, 36, 46, 56])
    expect(closeCaptureRoutineMissesNearStart({
      routineMinutes: CLOSE_CAPTURE_ROUTINE_MINUTES,
    })).toBe(true)
    const current = nearStartKickoffMinutesCoveredByRoutine({
      routineMinutes: CLOSE_CAPTURE_ROUTINE_MINUTES,
    })
    expect(current).toEqual([...Array(9)].map((_, i) => 18 + i).concat(
      [...Array(9)].map((_, i) => 48 + i),
    ))
    expect(closeCaptureRoutineMissesNearStart({
      routineMinutes: CLOSE_CAPTURE_PROPOSED_ROUTINE_MINUTES,
    })).toBe(true)
    const proposed = nearStartKickoffMinutesCoveredByRoutine({
      routineMinutes: CLOSE_CAPTURE_PROPOSED_ROUTINE_MINUTES,
    })
    expect(proposed.length).toBeGreaterThan(current.length)
    expect(proposed).toEqual(expect.arrayContaining([5, 6, 11, 12, 14]))
    expect(proposed).not.toContain(15)
    expect(proposed).not.toContain(16)
    expect(proposed).not.toContain(17)
    expect(proposed).not.toContain(27)
    expect(proposed).not.toContain(37)
    expect(proposed).not.toContain(47)
    expect(proposed).not.toContain(57)
    expect(formatCloseCaptureStatus('ok')).toBe('CLOSE_CAPTURE_STATUS=ok')
    expect(formatCloseCaptureCounts({
      captured: 3,
      skippedBudget: 1,
      skippedQuiet: 4,
      skippedWindow: 2,
      credits: 6,
    })).toBe('CLOSE_CAPTURE_CAPTURED=3 CLOSE_CAPTURE_SKIPPED_BUDGET=1 CLOSE_CAPTURE_SKIPPED_QUIET=4 CLOSE_CAPTURE_SKIPPED_WINDOW=2 CLOSE_CAPTURE_CREDITS=6')
  })

  test('isCloseCaptureCandidate requires a pre-start status and the window', () => {
    const now = new Date('2026-07-15T22:00:00.000Z')
    const inWindow = { date: '2026-07-15T22:20:00.000Z' }
    expect(isCloseCaptureCandidate({ ...inWindow, status: 'scheduled' }, now)).toBe(true)
    expect(isCloseCaptureCandidate({ ...inWindow, status: 'pre-game' }, now)).toBe(true)
    expect(isCloseCaptureCandidate({ ...inWindow, status: 'delayed_start' }, now)).toBe(true)
    expect(isCloseCaptureCandidate({ ...inWindow, status: 'delayed' }, now)).toBe(true)
    expect(isCloseCaptureCandidate({ ...inWindow, status: 'STATUS_RAIN_DELAY' }, now)).toBe(true)
    expect(isCloseCaptureCandidate({ ...inWindow, status: 'in_progress' }, now)).toBe(false)
    expect(isCloseCaptureCandidate({ ...inWindow, status: 'final' }, now)).toBe(false)
    expect(isCloseCaptureCandidate({ ...inWindow, status: 'postponed' }, now)).toBe(false)
    expect(isCloseCaptureCandidate({ ...inWindow, status: 'cancelled' }, now)).toBe(false)
    expect(isCloseCaptureCandidate({ date: '2026-07-15T22:36:00.000Z', status: 'scheduled' }, now)).toBe(false)
  })
})

describe('event-id dedupe and conditional close write', () => {
  test('groupCaptureJobsByOddsApiEventId fetches each event once', () => {
    const gamesById = new Map([
      ['g1', { id: 'g1', oddsApiEventId: 'evt-shared', sport: 'mlb' }],
      ['g2', { id: 'g2', oddsApiEventId: 'evt-shared', sport: 'mlb' }],
      ['g3', { id: 'g3', oddsApiEventId: 'evt-other', sport: 'mlb' }],
      ['g4', { id: 'g4', oddsApiEventId: null, sport: 'mlb' }],
    ])
    const byGame = new Map([
      ['g1', [{ id: 'p1' }]],
      ['g2', [{ id: 'p2' }]],
      ['g3', [{ id: 'p3' }]],
      ['g4', [{ id: 'p4' }]],
    ])
    const jobs = groupCaptureJobsByOddsApiEventId(byGame, gamesById)
    expect(jobs).toHaveLength(3)
    const shared = jobs.find((job) => job.eventId === 'evt-shared')
    expect(shared.gameIds).toEqual(['g1', 'g2'])
    expect(shared.picks.map((pick) => pick.id)).toEqual(['p1', 'p2'])
    expect(jobs.filter((job) => job.eventId === 'evt-shared')).toHaveLength(1)
    expect(jobs.find((job) => job.eventId === 'evt-other').picks).toEqual([{ id: 'p3' }])
    expect(jobs.find((job) => job.gameId === 'g4').eventId).toBeNull()
  })

  test('sortCloseCaptureJobs uses Published-first unless --nfl-all prefers kickoff', () => {
    const mlbLater = {
      game: { sport: 'mlb', date: '2026-07-15T23:20:00.000Z' },
    }
    const nflSoon = {
      game: { sport: 'nfl', date: '2026-07-15T23:00:00.000Z' },
    }
    const nhlMid = {
      game: { sport: 'nhl', date: '2026-07-15T23:10:00.000Z' },
    }
    expect(sortCloseCaptureJobs([nhlMid, nflSoon, mlbLater]).map((job) => job.game.sport))
      .toEqual(['nfl', 'nhl', 'mlb'])
    expect(sortCloseCaptureJobs([mlbLater, nhlMid, nflSoon], { nflAll: true }).map((job) => job.game.sport))
      .toEqual(['nfl', 'nhl', 'mlb'])
  })

  test('NFL outranks NHL so a later NFL close is not starved by a busy NHL slate', () => {
    const nhlSoon = {
      game: { sport: 'nhl', date: '2026-07-15T23:00:00.000Z' },
    }
    const nhlSooner = {
      game: { sport: 'nhl', date: '2026-07-15T22:50:00.000Z' },
    }
    const nflLater = {
      game: { sport: 'nfl', date: '2026-07-15T23:20:00.000Z' },
    }
    expect(closeCaptureJobPriority(nflLater)).toBeLessThan(closeCaptureJobPriority(nhlSoon))
    expect(sortCloseCaptureJobs([nhlSoon, nhlSooner, nflLater]).map((job) => job.game.sport))
      .toEqual(['nfl', 'nhl', 'nhl'])
    expect(sortCloseCaptureJobs([nhlSoon, nflLater], { nflAll: true }).map((job) => job.game.sport))
      .toEqual(['nhl', 'nfl'])
  })

  test('--nfl-all pending props ignore the Published bar; NHL archive stays out', () => {
    const pendingNfl = {
      sport: 'nfl',
      status: 'pending',
      source: 'user_saved',
      edge: 0,
      qualityScore: 12,
      propType: 'player_receptions',
      closeOdds: null,
    }
    const publishedNfl = {
      sport: 'nfl',
      status: 'pending',
      source: 'system_generated',
      edge: 0.06,
      qualityScore: 52,
      propType: 'player_receptions',
      odds: -110,
      prediction: 'over',
      threshold: 5.5,
      closeOdds: null,
    }
    const nhlArchive = {
      sport: 'nhl',
      status: 'pending',
      source: 'system_generated',
      edge: 0.08,
      qualityScore: 55,
      propType: 'player_shots_on_goal',
      odds: -110,
      prediction: 'over',
      threshold: 2.5,
      notes: 'tier:elite',
      closeOdds: null,
    }
    expect(isNflAllPendingProp(pendingNfl)).toBe(true)
    expect(isTargetedCloseCapturePick(pendingNfl)).toBe(false)
    expect(isTargetedCloseCapturePick(pendingNfl, { nflAll: true })).toBe(true)
    expect(isTargetedCloseCapturePick(publishedNfl)).toBe(true)
    expect(isTargetedCloseCapturePick({
      ...publishedNfl,
      closeOdds: -110,
    })).toBe(false)
    expect(isTargetedCloseCapturePick({
      ...publishedNfl,
      closeOdds: -110,
    }, { overwrite: true })).toBe(true)
    expect(isTargetedCloseCapturePick(pendingNfl, { nflAll: true, overwrite: true })).toBe(false)
    expect(isTargetedCloseCapturePick(nhlArchive, { nflAll: true })).toBe(false)
    expect(isTargetedCloseCapturePick({
      ...pendingNfl,
      source: 'game_line',
      propType: 'moneyline',
    }, { nflAll: true })).toBe(false)
  })

  test('includeNflWindowGamesForGameLines only adds empty NFL jobs when --nfl-all', () => {
    const games = [
      { id: 'nfl-1', sport: 'nfl' },
      { id: 'mlb-1', sport: 'mlb' },
    ]
    expect(includeNflWindowGamesForGameLines(new Map(), games).size).toBe(0)
    const withFlag = includeNflWindowGamesForGameLines(new Map([['nfl-1', [{ id: 'p1' }]]]), games, {
      nflAll: true,
    })
    expect([...withFlag.keys()].sort()).toEqual(['nfl-1'])
    expect(withFlag.get('nfl-1')).toEqual([{ id: 'p1' }])
    const empty = includeNflWindowGamesForGameLines(new Map(), games, { nflAll: true })
    expect(empty.get('nfl-1')).toEqual([])
    expect(empty.has('mlb-1')).toBe(false)
    const skipped = includeNflWindowGamesForGameLines(new Map(), games, {
      nflAll: true,
      capturedGameIds: new Set(['nfl-1']),
    })
    expect(skipped.has('nfl-1')).toBe(false)
  })

  test('applyPublishedCloseUpdate only patches rows where closeOdds IS NULL', () => {
    const calls = []
    const table = {
      update(body) {
        calls.push(['update', body])
        return {
          eq(col, val) {
            calls.push(['eq', col, val])
            return {
              is(col2, val2) {
                calls.push(['is', col2, val2])
                return {
                  select(cols) {
                    calls.push(['select', cols])
                    return { error: null, data: [{ id: 'pv-1' }] }
                  },
                }
              },
            }
          },
        }
      },
    }
    applyPublishedCloseUpdate(table, 'pv-1', { closeOdds: -110 })
    expect(calls).toEqual([
      ['update', { closeOdds: -110 }],
      ['eq', 'id', 'pv-1'],
      ['is', 'closeOdds', null],
      ['select', 'id'],
    ])
    expect(closeUpdateRowCount({ data: [], error: null })).toBe(0)
    expect(closeUpdateRowCount({ data: [{ id: 'pv-1' }], error: null })).toBe(1)
  })

  test('applyPublishedCloseUpdate overwrite skips the closeOdds IS NULL guard', () => {
    const calls = []
    const table = {
      update(body) {
        calls.push(['update', body])
        return {
          eq(col, val) {
            calls.push(['eq', col, val])
            return {
              is(col2, val2) {
                calls.push(['is', col2, val2])
                return this
              },
              select(cols) {
                calls.push(['select', cols])
                return { error: null, data: [{ id: 'pv-1' }] }
              },
            }
          },
        }
      },
    }
    applyPublishedCloseUpdate(table, 'pv-1', { closeOdds: -105 }, { overwrite: true })
    expect(calls).toEqual([
      ['update', { closeOdds: -105 }],
      ['eq', 'id', 'pv-1'],
      ['select', 'id'],
    ])
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

  test('uses the recorded line and consensus price, not the highest juice', () => {
    const match = matchClosingQuote({
      playerName: 'Vinnie Pasquantino',
      propType: 'batter_hits',
      prediction: 'over',
      threshold: 0.5,
    }, quotes)
    expect(match).toMatchObject({
      book: 'FanDuel',
      odds: -115,
      threshold: 0.5,
      sameLine: true,
      numBooks: 2,
      bestOdds: -108,
      bestBook: 'DraftKings',
    })
  })

  test('matches an exact alternate line and never a different point', () => {
    const match = matchClosingQuote({
      playerName: 'Vinnie Pasquantino',
      propType: 'hits',
      prediction: 'over',
      threshold: 1.5,
    }, quotes)
    expect(match.sameLine).toBe(true)
    expect(match.odds).toBe(180)
    expect(match.threshold).toBe(1.5)
  })

  test('returns null when the recorded threshold is gone so a later run can retry', () => {
    expect(matchClosingQuote({
      playerName: 'Vinnie Pasquantino',
      propType: 'batter_hits',
      prediction: 'over',
      threshold: 2.5,
    }, quotes)).toBeNull()
  })

  test('does not take max price across a Stafford-style alternate vs main line', () => {
    const stafford = flattenEventOddsQuotes({
      bookmakers: [
        {
          title: 'FanDuel',
          markets: [{
            key: 'player_pass_yds',
            outcomes: [
              { name: 'Over', description: 'Matthew Stafford', point: 281.5, price: 170 },
              { name: 'Under', description: 'Matthew Stafford', point: 281.5, price: -210 },
            ],
          }],
        },
        {
          title: 'DraftKings',
          markets: [{
            key: 'player_pass_yds_alternate',
            outcomes: [
              { name: 'Over', description: 'Matthew Stafford', point: 219.5, price: -110 },
              { name: 'Under', description: 'Matthew Stafford', point: 219.5, price: -110 },
            ],
          }],
        },
      ],
    })
    const match = matchClosingQuote({
      playerName: 'Matthew Stafford',
      propType: 'pass_yds',
      sport: 'nfl',
      prediction: 'over',
      threshold: 219.5,
    }, stafford)
    expect(match).toMatchObject({
      threshold: 219.5,
      odds: -110,
      book: 'DraftKings',
      market: 'player_pass_yds_alternate',
      sameLine: true,
      numBooks: 1,
      alternate: true,
    })
    expect(matchClosingQuote({
      playerName: 'Matthew Stafford',
      propType: 'pass_yds',
      sport: 'nfl',
      prediction: 'over',
      threshold: 219.5,
    }, stafford.filter((quote) => quote.market === 'player_pass_yds'))).toBeNull()
  })

  test('consensus is the median book on the exact line', () => {
    const three = [
      { playerName: 'Matthew Stafford', market: 'player_pass_yds', pick: 'over', threshold: 219.5, odds: -120, book: 'BetMGM' },
      { playerName: 'Matthew Stafford', market: 'player_pass_yds', pick: 'over', threshold: 219.5, odds: -110, book: 'FanDuel' },
      { playerName: 'Matthew Stafford', market: 'player_pass_yds', pick: 'over', threshold: 219.5, odds: -105, book: 'DraftKings' },
    ]
    expect(consensusClosingQuote(three)).toMatchObject({ book: 'FanDuel', odds: -110 })
    const match = matchClosingQuote({
      playerName: 'Matthew Stafford',
      propType: 'passing_yards',
      sport: 'nfl',
      prediction: 'over',
      threshold: 219.5,
    }, three)
    expect(match).toMatchObject({
      book: 'FanDuel',
      odds: -110,
      numBooks: 3,
      bestOdds: -105,
      bestBook: 'DraftKings',
    })
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

  test('public Published CLV drops shadow, game-line, juice-trap, and moved-line rows', () => {
    const publishedSameLine = {
      status: 'completed',
      result: 'correct',
      prediction: 'over',
      propType: 'batter_hits',
      threshold: 0.5,
      odds: 150,
      edge: 0.05,
      qualityScore: 48,
      sport: 'mlb',
      source: 'system_generated',
      notes: 'cohort:published',
      timestamp: '2026-07-15T18:00:00.000Z',
      completedAt: '2026-07-16T04:00:00.000Z',
      closeOdds: 130,
      closeLine: 0.5,
    }
    const publishedMoved = {
      ...publishedSameLine,
      id: 'moved',
      closeLine: 1.5,
      closeOdds: 100,
    }
    const shadowNhl = {
      ...publishedSameLine,
      id: 'shadow',
      sport: 'nhl',
      propType: 'player_shots_on_goal',
      notes: 'cohort:shadow-published',
      closeOdds: 110,
      closeLine: 0.5,
    }
    const sidesTotals = {
      ...publishedSameLine,
      id: 'gl',
      sport: 'nhl',
      source: 'game_line',
      propType: 'moneyline',
      notes: 'cohort:sides_totals | cohort:shadow-published',
      closeOdds: 110,
      closeLine: 0.5,
    }
    const juiceTrap = {
      ...publishedSameLine,
      id: 'trap',
      prediction: 'under',
      threshold: 0.5,
      closeLine: 0.5,
      closeOdds: 110,
    }
    const nhlPublished = {
      ...publishedSameLine,
      id: 'nhl-pub',
      sport: 'nhl',
      propType: 'player_shots_on_goal',
      notes: 'cohort:published',
      odds: -110,
      closeOdds: -120,
      threshold: 2.5,
      closeLine: 2.5,
    }

    const summary = summarizePublicPublishedClv([
      publishedSameLine,
      publishedMoved,
      shadowNhl,
      sidesTotals,
      juiceTrap,
      nhlPublished,
    ])
    expect(summary.sample).toBe(3)
    expect(summary.sameLine).toBe(2)
    expect(summary.lineMoved).toBe(1)
    expect(summary.beatClose).toBe(2)
    expect(summary.avgClvProb).toBeCloseTo((
      clvFromOdds(150, 130).clvProb
      + clvFromOdds(-110, -120).clvProb
    ) / 2, 8)
    expect(summary.pctBeatClose).toBe(1)
  })

  test('ignores NHL rows from nfl-nhl-v0.1.0 and leaves NFL CLV unchanged', () => {
    const nfl = {
      sport: 'nfl',
      modelRun: 'nfl-nhl-v0.1.0',
      odds: 150,
      closeOdds: 130,
      threshold: 0.5,
      closeLine: 0.5,
    }
    const legacyNhl = {
      sport: 'nhl',
      modelRun: 'nfl-nhl-v0.1.0',
      source: 'game_line',
      propType: 'moneyline',
      odds: 150,
      closeOdds: 130,
      threshold: 0.5,
      closeLine: 0.5,
    }
    const currentNhl = {
      sport: 'nhl',
      modelRun: 'nhl-gd-v0.2.0',
      source: 'game_line',
      propType: 'moneyline',
      odds: -110,
      closeOdds: -120,
      threshold: 0.5,
      closeLine: 0.5,
    }
    const summary = summarizePublishedClv([nfl, legacyNhl, currentNhl])
    expect(summary.sample).toBe(2)
    expect(summary.sameLine).toBe(2)
    expect(summary.avgClvProb).toBeCloseTo((
      clvFromOdds(150, 130).clvProb
      + clvFromOdds(-110, -120).clvProb
    ) / 2, 8)
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
  test('closeCapturePayload skips unconvertible prices so a later run can retry', () => {
    expect(closeCapturePayload({ odds: 'n/a', threshold: 0.5, book: 'DK', numBooks: 1 })).toBeNull()
    expect(closeCapturePayload({ odds: null, threshold: 0.5, book: 'DK' })).toBeNull()
    expect(closeCapturePayload({ odds: 0, threshold: 0.5, book: 'DK' })).toBeNull()
  })

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

  test('hasCloseAlready treats closeOdds or closeCapturedAt as already captured', () => {
    expect(hasCloseAlready({ closeOdds: -110, closeCapturedAt: '2026-07-15T22:00:00Z' })).toBe(true)
    expect(hasCloseAlready({ closeOdds: -110, closeCapturedAt: null })).toBe(true)
    expect(hasCloseAlready({ closeOdds: null, closeCapturedAt: '2026-07-15T22:00:00Z' })).toBe(true)
    expect(hasCloseAlready({ closeOdds: null, closeCapturedAt: null })).toBe(false)
  })

  test('shouldSkipLiveCloseOverwrite uses commence_time and quote last_update', () => {
    const now = new Date('2026-07-15T22:00:00.000Z')
    expect(shouldSkipLiveCloseOverwrite({
      payload: { commence_time: '2026-07-15T22:00:30.000Z' },
      now,
    })).toBe('commence_time within 60s of now')
    expect(shouldSkipLiveCloseOverwrite({
      payload: { commence_time: '2026-07-15T22:00:00.000Z' },
      now,
    })).toBe('commence_time within 60s of now')
    expect(shouldSkipLiveCloseOverwrite({
      payload: { commence_time: '2026-07-15T21:59:00.000Z' },
      now,
    })).toBe('commence_time within 60s of now')
    expect(shouldSkipLiveCloseOverwrite({
      payload: { commence_time: '2026-07-15T22:01:01.000Z' },
      now,
    })).toBeNull()
    expect(shouldSkipLiveCloseOverwrite({
      payload: { commence_time: '2026-07-15T22:10:00.000Z' },
      quote: { last_update: '2026-07-15T22:05:00.000Z' },
      now,
    })).toBe('quote last_update after capture')
    expect(shouldSkipLiveCloseOverwrite({
      payload: { commence_time: '2026-07-15T22:10:00.000Z' },
      quote: { last_update: '2026-07-15T22:10:00.000Z' },
      now,
    })).toBe('quote last_update after capture')
    expect(shouldSkipLiveCloseOverwrite({
      payload: { commence_time: '2026-07-15T22:10:00.000Z' },
      quote: { last_update: '2026-07-15T21:59:00.000Z' },
      now,
    })).toBeNull()
    expect(shouldSkipLiveCloseOverwrite({ payload: {}, quote: {}, now }))
      .toBe('commence_time missing/unparseable')
    expect(shouldSkipLiveCloseOverwrite({
      payload: { commence_time: 'nope' },
      now,
    })).toBe('commence_time missing/unparseable')
    expect(shouldSkipLiveCloseOverwrite({
      payload: { commence_time: '2026-07-15T22:10:00.000Z' },
      now,
    })).toBeNull()
  })

  test('parseOddsApiQuota reads remaining, used, and last credits', () => {
    expect(parseOddsApiQuota({
      get: (name) => ({
        'x-requests-remaining': '18420',
        'x-requests-used': '1580',
        'x-requests-last': '5',
      }[name] || null),
    })).toEqual({ remaining: 18420, used: 1580, last: 5 })
    expect(parseOddsApiQuota(null)).toEqual({ remaining: null, used: null, last: null })
    expect(buildSportsQuotaProbeUrl('k')).toBe(
      'https://api.the-odds-api.com/v4/sports?apiKey=k',
    )
  })
})

describe('NFL game-line ClosingOdds writes', () => {
  const eventData = {
    home_team: 'Kansas City Chiefs',
    away_team: 'Buffalo Bills',
    bookmakers: [
      {
        title: 'FanDuel',
        markets: [
          {
            key: 'player_receptions',
            outcomes: [
              { name: 'Over', description: 'Travis Kelce', point: 5.5, price: -115 },
            ],
          },
          {
            key: 'h2h',
            outcomes: [
              { name: 'Kansas City Chiefs', price: -150 },
              { name: 'Buffalo Bills', price: 130 },
            ],
          },
          {
            key: 'spreads',
            outcomes: [
              { name: 'Kansas City Chiefs', price: -110, point: -3.5 },
              { name: 'Buffalo Bills', price: -110, point: 3.5 },
            ],
          },
          {
            key: 'totals',
            outcomes: [
              { name: 'Over', price: -108, point: 47.5 },
              { name: 'Under', price: -112, point: 47.5 },
            ],
          },
        ],
      },
      {
        title: 'DraftKings',
        markets: [{
          key: 'h2h',
          outcomes: [
            { name: 'Kansas City Chiefs', price: -148 },
            { name: 'Buffalo Bills', price: 128 },
          ],
        }],
      },
    ],
  }

  test('logs books skipped because a team outcome is missing or name-mismatched', () => {
    const lines = []
    const log = { log: (...args) => lines.push(args.join(' ')) }
    const mismatched = {
      home_team: 'Kansas City Chiefs',
      away_team: 'Buffalo Bills',
      bookmakers: [{
        title: 'BetMGM',
        markets: [{
          key: 'h2h',
          outcomes: [
            { name: 'KC', price: -150 },
            { name: 'BUF', price: 130 },
          ],
        }],
      }],
    }
    const rows = gameLineClosesFromEventOdds(mismatched, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
      log,
    })
    expect(rows).toEqual([])
    expect(lines.join('\n')).toMatch(/skipped book/)
    expect(lines.join('\n')).toMatch(/BetMGM h2h/)
    expect(lines.join('\n')).toMatch(/missing\/name-mismatched/)
    const totalsLog = []
    gameLineClosesFromEventOdds({
      home_team: 'Kansas City Chiefs',
      away_team: 'Buffalo Bills',
      bookmakers: [{
        title: 'Caesars',
        markets: [{
          key: 'totals',
          outcomes: [{ name: 'Over', price: -108, point: 47.5 }],
        }],
      }],
    }, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
      log: { log: (...args) => totalsLog.push(args.join(' ')) },
    })
    expect(totalsLog.join('\n')).toMatch(/Caesars totals: missing Under/)
    expect(describeSkippedTeamOutcome({
      book: 'BetMGM',
      market: 'h2h',
      homeTeam: 'Kansas City Chiefs',
      awayTeam: 'Buffalo Bills',
      home: null,
      away: null,
      outcomes: [{ name: 'KC' }, { name: 'BUF' }],
    })).toMatch(/outcomes: KC, BUF/)
    expect(describeSkippedTotalOutcome({
      book: 'Caesars',
      over: { name: 'Over' },
      under: null,
      outcomes: [{ name: 'Over' }],
    })).toMatch(/missing Under/)
    expect(formatGameLineCloseCounts({
      label: 'KC_at_BUF',
      proposed: 4,
      inserted: 1,
      skipped: 2,
      failed: 1,
    })).toBe('  game-line KC_at_BUF proposed=4 inserted=1 skipped=2 failed=1')
  })

  test('stores each book\'s h2h / spread / total using ClosingOdds columns', () => {
    const rows = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      sport: 'nfl',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        game_id: 'KC_at_BUF',
        sport: 'nfl',
        book: 'FanDuel',
        market: 'h2h',
        price_home: -150,
        price_away: 130,
      }),
      expect.objectContaining({
        book: 'FanDuel',
        market: 'spreads',
        spread: -3.5,
        price_home: -110,
        price_away: -110,
      }),
      expect.objectContaining({
        book: 'FanDuel',
        market: 'totals',
        total: 47.5,
        price_away: -108,
        price_home: -112,
      }),
      expect.objectContaining({
        book: 'DraftKings',
        market: 'h2h',
        price_home: -148,
      }),
    ]))
    expect(rows.find((row) => row.market === 'player_receptions')).toBeUndefined()
    expect(rows.every((row) => row.quoted_at == null)).toBe(true)
    expect(rows.every((row) => row.quoted_at !== row.snapshot_at)).toBe(true)
  })

  test('a missing spread or puck-line point is attempted, never a null spread close', () => {
    const capturedAt = new Date('2026-07-15T22:46:00.000Z')
    const kickoff = '2026-07-15T23:10:00.000Z'
    const quoted = '2026-07-15T22:40:00.000Z'
    function event(home, away) {
      return {
        home_team: home,
        away_team: away,
        bookmakers: [{
          title: 'FanDuel',
          markets: [
            {
              key: 'h2h',
              last_update: quoted,
              outcomes: [
                { name: home, price: -150 },
                { name: away, price: 130 },
              ],
            },
            {
              key: 'spreads',
              last_update: quoted,
              outcomes: [
                { name: home, price: -110 },
                { name: away, price: -110 },
              ],
            },
          ],
        }],
      }
    }
    for (const sport of ['nfl', 'nhl']) {
      const home = sport === 'nfl' ? 'Kansas City Chiefs' : 'Toronto Maple Leafs'
      const away = sport === 'nfl' ? 'Buffalo Bills' : 'Boston Bruins'
      const direct = gameLineClosesFromEventOdds(event(home, away), {
        gameId: 'GAME',
        sport,
        capturedAt,
        kickoff,
        markets: ['h2h', 'spreads', 'totals'],
      })
      expect(direct.some((row) => row.market === 'spreads')).toBe(false)
      expect(direct.some((row) => row.book !== 'attempted' && row.spread == null && row.market === 'spreads')).toBe(false)
      const filled = gameLineClosesForCaptureJob({
        gameId: 'GAME',
        gameIds: ['GAME'],
        game: { id: 'GAME', sport, date: kickoff },
      }, event(home, away), capturedAt, {
        markets: ['h2h', 'spreads', 'totals'],
        sport,
      })
      const realSpread = filled.filter((row) => row.market === 'spreads' && row.book !== 'attempted')
      expect(realSpread).toEqual([])
      const attempted = filled.find((row) => row.market === 'spreads' && row.book === 'attempted')
      expect(attempted).toMatchObject({ game_id: 'GAME', sport, book: 'attempted' })
      expect(filled.some((row) => row.market === 'h2h' && row.book === 'FanDuel')).toBe(true)
    }
  })

  test('stores the market last_update on quoted_at and leaves snapshot_at as capture time', () => {
    const rows = gameLineClosesFromEventOdds({
      home_team: 'Kansas City Chiefs',
      away_team: 'Buffalo Bills',
      bookmakers: [{
        title: 'FanDuel',
        last_update: '2026-07-15T22:00:00.000Z',
        markets: [{
          key: 'h2h',
          last_update: '2026-07-15T22:40:00.000Z',
          outcomes: [
            { name: 'Kansas City Chiefs', price: -150 },
            { name: 'Buffalo Bills', price: 130 },
          ],
        }],
      }],
    }, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    expect(rows).toEqual([
      expect.objectContaining({
        book: 'FanDuel',
        market: 'h2h',
        snapshot_at: '2026-07-15T22:50:00.000Z',
        quoted_at: '2026-07-15T22:40:00.000Z',
      }),
    ])
  })

  test('a missing quoted_at column is stripped and the close insert is retried', async () => {
    const bodies = []
    const supabase = {
      from() {
        return {
          select() { return this },
          in() { return Promise.resolve({ data: [], error: null }) },
          insert(body) {
            bodies.push(body)
            if (bodies.length === 1) {
              return Promise.resolve({
                error: {
                  code: 'PGRST204',
                  message: "Could not find the 'quoted_at' column of 'ClosingOdds' in the schema cache",
                },
              })
            }
            return Promise.resolve({ data: body, error: null })
          },
        }
      },
    }
    const proposed = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    const written = await writeGameLineCloses(supabase, proposed)
    expect(written.error).toBeNull()
    expect(written.inserted).toBe(proposed.length)
    expect(bodies[1][0].quoted_at).toBeUndefined()
    expect(bodies[1][0].snapshot_at).toBe('2026-07-15T22:50:00.000Z')
  })

  test('writeGameLineCloses is idempotent on game_id + book + market', async () => {
    const existing = []
    const inserts = []
    const supabase = {
      from(table) {
        expect(table).toBe('ClosingOdds')
        return {
          select() { return this },
          in() { return Promise.resolve({ data: existing, error: null }) },
          insert(rows) {
            inserts.push(...rows)
            existing.push(...rows)
            return Promise.resolve({ data: rows, error: null })
          },
        }
      },
    }
    const proposed = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    const first = await writeGameLineCloses(supabase, proposed)
    expect(first.inserted).toBe(4)
    expect(inserts).toHaveLength(4)
    const second = await writeGameLineCloses(supabase, proposed)
    expect(second.inserted).toBe(0)
    expect(second.skipped).toBe(4)
    expect(inserts).toHaveLength(4)
    expect(filterNewClosingOddsRows(proposed, existing)).toEqual([])
  })

  test('writeGameLineCloses overwrite upserts the same clvclose: id and never inserts a duplicate', async () => {
    const rowsById = new Map()
    const upserts = []
    const supabase = {
      from(table) {
        expect(table).toBe('ClosingOdds')
        return {
          select() { return this },
          in() { return Promise.resolve({ data: [...rowsById.values()], error: null }) },
          insert() { throw new Error('overwrite must upsert, not insert') },
          upsert(next) {
            upserts.push(...next)
            for (const row of next) rowsById.set(row.id, row)
            return Promise.resolve({ data: next, error: null })
          },
        }
      },
    }
    const first = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    await writeGameLineCloses(supabase, first, { overwrite: true })
    const later = gameLineClosesFromEventOdds({
      ...eventData,
      bookmakers: [{
        ...eventData.bookmakers[0],
        markets: eventData.bookmakers[0].markets.map((market) => (
          market.key === 'h2h'
            ? {
              ...market,
              outcomes: market.outcomes.map((outcome) => (
                outcome.name === 'Kansas City Chiefs'
                  ? { ...outcome, price: -160 }
                  : outcome
              )),
            }
            : market
        )),
      }],
    }, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T23:05:00.000Z'),
    })
    const second = await writeGameLineCloses(supabase, later, { overwrite: true })
    expect(second.upserted).toBe(true)
    const h2hId = closeCaptureRowId('KC_at_BUF', 'FanDuel', 'h2h')
    expect([...rowsById.values()].filter((row) => row.id === h2hId)).toHaveLength(1)
    expect(rowsById.get(h2hId).price_home).toBe(-160)
  })

  test('early snapshot-closing-lines rows do not count as already captured', () => {
    const kickoff = '2026-07-15T23:10:00.000Z'
    const game = { id: 'KC_at_BUF', date: kickoff, sport: 'nfl' }
    const gamesById = new Map([['KC_at_BUF', game]])
    const earlySnapshot = {
      id: 'uuid-snapshot',
      game_id: 'KC_at_BUF',
      book: 'FanDuel',
      market: 'h2h',
      snapshot_at: '2026-07-15T21:20:00.000Z',
    }
    expect(isCloseCaptureClosingOddsRow(earlySnapshot, game)).toBe(false)
    const proposed = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    const fresh = filterNewClosingOddsRows(proposed, [earlySnapshot], { gamesById })
    expect(fresh.some((row) => row.market === 'h2h' && row.book === 'FanDuel')).toBe(true)
  })

  test('T-30 snapshot_at without clvclose: id does not count as captured', () => {
    const game = { id: 'KC_at_BUF', date: '2026-07-15T23:10:00.000Z', sport: 'nfl' }
    const t30 = {
      id: 'uuid-snapshot-t30',
      game_id: 'KC_at_BUF',
      book: 'FanDuel',
      market: 'h2h',
      snapshot_at: '2026-07-15T22:40:00.000Z',
    }
    expect(isCloseCaptureClosingOddsRow(t30, game)).toBe(false)
    const proposed = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    const fresh = filterNewClosingOddsRows(proposed, [t30])
    expect(fresh.some((row) => row.market === 'h2h' && row.book === 'FanDuel')).toBe(true)
  })

  test('only clvclose: ids count as this capture', () => {
    const tagged = {
      id: 'clvclose:kc_at_buf|draftkings|h2h',
      game_id: 'KC_at_BUF',
      book: 'DraftKings',
      market: 'h2h',
      snapshot_at: '2026-07-15T22:50:00.000Z',
    }
    expect(isCloseCaptureClosingOddsRow(tagged)).toBe(true)
    const proposed = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    const fresh = filterNewClosingOddsRows(proposed, [tagged])
    expect(fresh.find((row) => row.book === 'DraftKings' && row.market === 'h2h')).toBeUndefined()
    expect(fresh.find((row) => row.book === 'FanDuel' && row.market === 'h2h')).toBeTruthy()
  })

  test('capture writes pin Over = price_away', () => {
    const rows = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    const totals = rows.find((row) => row.market === 'totals')
    expect(totals).toMatchObject({
      price_away: -108,
      price_home: -112,
      total: 47.5,
    })
  })

  test('duplicate-key insert is already captured, not a failure', async () => {
    expect(isDuplicateClosingOddsError({
      code: POSTGRES_UNIQUE_VIOLATION,
      message: `duplicate key value violates unique constraint "${CLOSING_ODDS_PKEY}"`,
    })).toBe(true)
    const supabase = {
      from(table) {
        expect(table).toBe('ClosingOdds')
        return {
          select() { return this },
          in() { return Promise.resolve({ data: [], error: null }) },
          insert() {
            return Promise.resolve({
              data: null,
              error: {
                code: POSTGRES_UNIQUE_VIOLATION,
                message: `duplicate key value violates unique constraint "${CLOSING_ODDS_PKEY}"`,
              },
            })
          },
        }
      },
    }
    const proposed = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    const result = await writeGameLineCloses(supabase, proposed)
    expect(result.error).toBeNull()
    expect(result.inserted).toBe(0)
    expect(result.skipped).toBe(proposed.length)
  })

  test('isDuplicateClosingOddsError matches only Postgres 23505', () => {
    expect(isDuplicateClosingOddsError({
      code: POSTGRES_UNIQUE_VIOLATION,
      message: `duplicate key value violates unique constraint "${CLOSING_ODDS_PKEY}"`,
    })).toBe(true)
    expect(isDuplicateClosingOddsError({
      code: POSTGRES_UNIQUE_VIOLATION,
      constraint: CLOSING_ODDS_PKEY,
    })).toBe(true)
    expect(isDuplicateClosingOddsError({
      code: POSTGRES_UNIQUE_VIOLATION,
      constraint: CLOSING_ODDS_CLOSE_CAPTURE_UNIQ,
    })).toBe(true)
    expect(isDuplicateClosingOddsError({
      code: POSTGRES_UNIQUE_VIOLATION,
      message: `duplicate key value violates unique constraint "${CLOSING_ODDS_CLOSE_CAPTURE_UNIQ}"`,
    })).toBe(true)
    expect(isDuplicateClosingOddsError({
      code: POSTGRES_UNIQUE_VIOLATION,
      details: 'Key (id)=(clvclose:g1|fanduel|h2h) already exists.',
    })).toBe(true)
    expect(isDuplicateClosingOddsError({
      code: POSTGRES_UNIQUE_VIOLATION,
    })).toBe(true)
    expect(isDuplicateClosingOddsError({
      message: 'duplicate key value violates unique constraint "ClosingOdds_pkey"',
    })).toBe(false)
    expect(isDuplicateClosingOddsError({
      code: '23503',
      message: 'insert or update on table "ClosingOdds" violates foreign key constraint',
    })).toBe(false)
    expect(isDuplicateClosingOddsError({
      message: 'unique violation: row already exists',
    })).toBe(false)
    expect(isDuplicateClosingOddsError({
      code: POSTGRES_UNIQUE_VIOLATION,
      message: 'duplicate key value violates unique constraint "Odds_pkey"',
    })).toBe(false)
    expect(isDuplicateClosingOddsError({
      code: POSTGRES_UNIQUE_VIOLATION,
      constraint: 'Odds_gameId_book_market_key',
    })).toBe(false)
  })

  test('a 23505 batch retries per row and still inserts the non-duplicates', async () => {
    const stored = []
    const inserts = []
    const duplicateId = closeCaptureRowId('KC_at_BUF', 'FanDuel', 'h2h')
    const pkeyError = {
      code: POSTGRES_UNIQUE_VIOLATION,
      message: `duplicate key value violates unique constraint "${CLOSING_ODDS_PKEY}"`,
    }
    const supabase = {
      from(table) {
        expect(table).toBe('ClosingOdds')
        return {
          select() { return this },
          in() { return Promise.resolve({ data: [], error: null }) },
          insert(rows) {
            inserts.push(rows)
            if (rows.length > 1) {
              return Promise.resolve({ data: null, error: pkeyError })
            }
            const [row] = rows
            if (row.id === duplicateId) {
              return Promise.resolve({ data: null, error: pkeyError })
            }
            stored.push(row)
            return Promise.resolve({ data: rows, error: null })
          },
        }
      },
    }
    const proposed = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    expect(proposed.some((row) => row.id === duplicateId)).toBe(true)
    const result = await writeGameLineCloses(supabase, proposed)
    expect(result.error).toBeNull()
    expect(result.failed).toBe(0)
    expect(result.inserted).toBe(proposed.length - 1)
    expect(result.skipped).toBe(1)
    expect(stored).toHaveLength(proposed.length - 1)
    expect(stored.find((row) => row.id === duplicateId)).toBeUndefined()
    expect(inserts[0]).toHaveLength(proposed.length)
    expect(inserts.slice(1).every((batch) => batch.length === 1)).toBe(true)

    const second = await writeGameLineCloses(supabase, proposed)
    expect(second.inserted).toBe(0)
    expect(second.skipped).toBe(proposed.length)
    expect(stored).toHaveLength(proposed.length - 1)
  })

  test('a mixed 23505 batch returns firstOtherError and does not mark failed rows captured', async () => {
    const stored = []
    const duplicateId = closeCaptureRowId('KC_at_BUF', 'FanDuel', 'h2h')
    const deniedId = closeCaptureRowId('KC_at_BUF', 'FanDuel', 'spreads')
    const pkeyError = {
      code: POSTGRES_UNIQUE_VIOLATION,
      message: `duplicate key value violates unique constraint "${CLOSING_ODDS_PKEY}"`,
    }
    const deniedError = { code: '42501', message: 'permission denied' }
    const supabase = {
      from(table) {
        expect(table).toBe('ClosingOdds')
        return {
          select() { return this },
          in() { return Promise.resolve({ data: [], error: null }) },
          insert(rows) {
            if (rows.length > 1) {
              return Promise.resolve({ data: null, error: pkeyError })
            }
            const [row] = rows
            if (row.id === duplicateId) {
              return Promise.resolve({ data: null, error: pkeyError })
            }
            if (row.id === deniedId) {
              return Promise.resolve({ data: null, error: deniedError })
            }
            stored.push(row)
            return Promise.resolve({ data: rows, error: null })
          },
        }
      },
    }
    const proposed = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    expect(proposed.map((row) => row.id)).toEqual(expect.arrayContaining([
      duplicateId,
      deniedId,
    ]))
    const result = await writeGameLineCloses(supabase, proposed)
    expect(result.error).toMatchObject({ code: '42501', message: 'permission denied' })
    expect(result.failed).toBe(1)
    expect(result.inserted).toBe(proposed.length - 2)
    expect(result.skipped).toBe(1)
    expect(result.rows.map((row) => row.id)).not.toContain(deniedId)
    expect(result.rows.map((row) => row.id)).not.toContain(duplicateId)
    expect(stored.map((row) => row.id)).toEqual(result.rows.map((row) => row.id))

    const second = await writeGameLineCloses(supabase, proposed)
    expect(second.error).toMatchObject({ code: '42501' })
    expect(second.inserted).toBe(0)
    expect(second.failed).toBe(1)
    expect(second.skipped).toBe(proposed.length - 1)
    expect(stored).toHaveLength(result.inserted)
  })

  test('a non-23505 insert error is still a failure', async () => {
    const supabase = {
      from(table) {
        expect(table).toBe('ClosingOdds')
        return {
          select() { return this },
          in() { return Promise.resolve({ data: [], error: null }) },
          insert() {
            return Promise.resolve({
              data: null,
              error: { code: '42501', message: 'permission denied' },
            })
          },
        }
      },
    }
    const proposed = gameLineClosesFromEventOdds(eventData, {
      gameId: 'KC_at_BUF',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
    })
    const result = await writeGameLineCloses(supabase, proposed)
    expect(result.error).toMatchObject({ code: '42501' })
    expect(result.inserted).toBe(0)
    expect(result.failed).toBe(proposed.length)
    expect(result.skipped).toBe(0)
  })

  test('ClosingOdds.id is text in Prisma and the archive SQL', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    const sql = readFileSync(join(process.cwd(), 'scripts/migrations/001_archive_tables.sql'), 'utf8')
    expect(schema).toMatch(/model ClosingOdds \{[\s\S]*?id\s+String\s+@id/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "ClosingOdds" \([\s\S]*?id\s+TEXT PRIMARY KEY/)
    expect(CLOSE_CAPTURE_ID_PREFIX).toBe('clvclose:')
  })

  test('missing markets are marked attempted so the game is not refetched', () => {
    const filled = fillMissingNflGameLineAttempts(
      [{ game_id: 'g1', book: 'FanDuel', market: 'h2h', id: 'clvclose:g1|fanduel|h2h' }],
      ['g1'],
      new Date('2026-07-15T22:50:00.000Z'),
    )
    expect(filled.map((row) => row.market).sort()).toEqual(['h2h', 'spreads', 'totals'])
    const spreads = filled.find((row) => row.market === 'spreads')
    expect(spreads.book).toBe(CLOSE_CAPTURE_ATTEMPTED_BOOK)
    expect(spreads.id.startsWith(CLOSE_CAPTURE_ID_PREFIX)).toBe(true)
    expect(isCloseCaptureClosingOddsRow(spreads)).toBe(true)
  })

  test('capturedNflGameLineGameIds requires all three markets from this capture', () => {
    const game = { id: 'g1', date: '2026-07-15T23:10:00.000Z', sport: 'nfl' }
    const early = {
      id: 'snap',
      game_id: 'g1',
      book: 'FanDuel',
      market: 'h2h',
      snapshot_at: '2026-07-15T21:00:00.000Z',
    }
    const closeRows = ['h2h', 'spreads', 'totals'].map((market) => ({
      id: `clvclose:g1|fanduel|${market}`,
      game_id: 'g1',
      book: 'FanDuel',
      market,
      snapshot_at: '2026-07-15T22:50:00.000Z',
    }))
    expect(capturedNflGameLineGameIds([game], [early])).toEqual(new Set())
    expect(capturedNflGameLineGameIds([game], closeRows)).toEqual(new Set(['g1']))
  })
})

describe('ClosingOdds total selection for close-stuck-parlays', () => {
  const kickoff = '2026-07-15T23:10:00.000Z'
  const morning = {
    id: 'uuid-morning',
    game_id: 'KC_at_BUF',
    book: 'FanDuel',
    market: 'totals',
    total: 44.5,
    price_away: -105,
    price_home: -115,
    snapshot_at: '2026-07-15T14:05:00.000Z',
  }
  const t30 = {
    id: 'uuid-t30',
    game_id: 'KC_at_BUF',
    book: 'DraftKings',
    market: 'totals',
    total: 46.5,
    price_away: -110,
    price_home: -110,
    snapshot_at: '2026-07-15T22:40:00.000Z',
  }
  const afterKickoff = {
    id: 'uuid-late',
    game_id: 'KC_at_BUF',
    book: 'BetMGM',
    market: 'totals',
    total: 49.5,
    price_away: -102,
    price_home: -118,
    snapshot_at: '2026-07-15T23:25:00.000Z',
  }
  const closeRow = {
    id: 'clvclose:kc_at_buf|fanduel|totals',
    game_id: 'KC_at_BUF',
    book: 'FanDuel',
    market: 'totals',
    total: 47.5,
    price_away: -108,
    price_home: -112,
    snapshot_at: '2026-07-15T22:50:00.000Z',
  }
  const attempted = {
    id: 'clvclose:kc_at_buf|attempted|totals',
    game_id: 'KC_at_BUF',
    book: CLOSE_CAPTURE_ATTEMPTED_BOOK,
    market: 'totals',
    total: 47.5,
    price_away: null,
    price_home: null,
    snapshot_at: '2026-07-15T22:51:00.000Z',
  }

  test('prefers a clvclose: total over an earlier morning snapshot', () => {
    const selected = selectClosingTotalRow(
      [morning, attempted, closeRow, t30],
      { kickoff },
    )
    expect(selected).toMatchObject({
      id: closeRow.id,
      total: 47.5,
      book: 'FanDuel',
    })
    expect(closingTotalOverUnderPrices(selected)).toEqual({
      over: -108,
      under: -112,
    })
  })

  test('ignores book=attempted clvclose rows and falls back to latest snapshot before kickoff', () => {
    const withoutT30 = selectClosingTotalRow(
      [morning, attempted, afterKickoff],
      { kickoff },
    )
    expect(withoutT30.id).toBe('uuid-morning')
    const withT30 = selectClosingTotalRow(
      [afterKickoff, morning, t30, attempted],
      { kickoff },
    )
    expect(withT30).toMatchObject({ id: 'uuid-t30', total: 46.5 })
  })

  test('without clvclose rows uses the latest snapshot_at before kickoff', () => {
    const selected = selectClosingTotalRow(
      [afterKickoff, morning, t30],
      { kickoff },
    )
    expect(selected.id).toBe('uuid-t30')
    expect(selectClosingTotalRow([afterKickoff], { kickoff })).toBeNull()
  })

  test('tied snapshot_at breaks deterministically by book then id', () => {
    const tiedB = {
      id: 'snap-b',
      game_id: 'KC_at_BUF',
      book: 'BetMGM',
      market: 'totals',
      total: 45.5,
      snapshot_at: '2026-07-15T22:40:00.000Z',
    }
    const tiedA = {
      id: 'snap-a',
      game_id: 'KC_at_BUF',
      book: 'BetMGM',
      market: 'totals',
      total: 45.0,
      snapshot_at: '2026-07-15T22:40:00.000Z',
    }
    const tiedDk = {
      id: 'snap-dk',
      game_id: 'KC_at_BUF',
      book: 'DraftKings',
      market: 'totals',
      total: 46.0,
      snapshot_at: '2026-07-15T22:40:00.000Z',
    }
    const first = selectClosingTotalRow([tiedDk, tiedB, tiedA], { kickoff })
    const second = selectClosingTotalRow([tiedA, tiedDk, tiedB], { kickoff })
    expect(first.id).toBe('snap-a')
    expect(second.id).toBe(first.id)
  })

  test('closingTotalsByGame keeps Over = price_away and Under = price_home', () => {
    const gamesById = new Map([
      ['KC_at_BUF', { id: 'KC_at_BUF', date: kickoff }],
    ])
    const map = closingTotalsByGame([morning, closeRow, attempted], gamesById)
    expect(map.get('KC_at_BUF')).toMatchObject({
      line: 47.5,
      book: 'FanDuel',
      overPrice: -108,
      underPrice: -112,
    })
  })

  test('ignores non-totals rows even when they carry a numeric total', () => {
    const h2hWithTotal = {
      id: 'clvclose:kc_at_buf|fanduel|h2h',
      game_id: 'KC_at_BUF',
      book: 'FanDuel',
      market: 'h2h',
      total: 99.5,
      price_away: 130,
      price_home: -150,
      snapshot_at: '2026-07-15T22:55:00.000Z',
    }
    expect(selectClosingTotalRow([h2hWithTotal], { kickoff })).toBeNull()
    const selected = selectClosingTotalRow([h2hWithTotal, morning], { kickoff })
    expect(selected).toMatchObject({ id: 'uuid-morning', market: 'totals', total: 44.5 })
  })

  test('research archive export drops book=attempted ClosingOdds rows', () => {
    expect(filterClosingOddsForResearchArchive([closeRow, attempted, morning])).toEqual([
      closeRow,
      morning,
    ])
  })

  test('close-stuck-parlays orders and prefers clvclose totals', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/close-stuck-parlays.js'), 'utf8')
    expect(src).toMatch(/closingTotalsByGame/)
    expect(src).toMatch(/clvclose:%/)
    expect(src).toMatch(/market = 'totals'/)
    expect(src).toMatch(/book IS DISTINCT FROM 'attempted'/)
    expect(src).toMatch(/ORDER BY/)
    expect(src).toMatch(/price_away/)
    expect(src).toMatch(/price_home/)
  })
})

describe('game-line close capture for NHL, MLB, and NFL', () => {
  const now = new Date('2026-07-15T22:46:00.000Z')

  function game(overrides = {}) {
    return {
      id: 'BOS_at_TOR',
      sport: 'nhl',
      date: '2026-07-15T23:10:00.000Z',
      status: 'scheduled',
      oddsApiEventId: 'evt-bos',
      ...overrides,
    }
  }

  function edge(overrides = {}) {
    return {
      id: 'edge-bos',
      gameId: 'BOS_at_TOR',
      edgeMlHome: 0.04,
      edgeMlAway: null,
      edgeTotalO: null,
      edgeTotalU: null,
      ts: '2026-07-15T18:00:00.000Z',
      ...overrides,
    }
  }

  test('keeps today moneyline and total edges inside the early and near-start windows', () => {
    const nhl = game()
    const mlb = game({
      id: 'NYY_at_BOS',
      sport: 'mlb',
      date: '2026-07-15T22:52:00.000Z',
      oddsApiEventId: 'evt-mlb',
    })
    const targets = selectGameLineCloseTargets([
      nhl,
      mlb,
      game({ id: 'NBA', sport: 'nba' }),
      game({ id: 'LIVE', status: 'in_progress' }),
      game({ id: 'TOO_SOON', date: '2026-07-15T22:46:30.000Z' }),
      game({ id: 'TOO_LATE', date: '2026-07-15T23:40:00.000Z' }),
      game({ id: 'NO_EDGE' }),
      game({ id: 'YDAY', oddsApiEventId: 'evt-yday' }),
    ], [
      edge(),
      edge({ id: 'edge-mlb', gameId: 'NYY_at_BOS', edgeMlHome: null, edgeTotalU: -0.02 }),
      edge({ id: 'edge-nba', gameId: 'NBA' }),
      edge({ id: 'edge-live', gameId: 'LIVE' }),
      edge({ id: 'edge-soon', gameId: 'TOO_SOON' }),
      edge({ id: 'edge-late', gameId: 'TOO_LATE' }),
      edge({ id: 'edge-empty', gameId: 'NO_EDGE', edgeMlHome: null }),
      edge({ id: 'edge-yday', gameId: 'YDAY', ts: '2026-07-15T03:00:00.000Z' }),
      edge({ id: 'edge-old', ts: '2026-07-15T16:00:00.000Z', edgeMlHome: 0.01 }),
      edge({ id: 'edge-new', ts: '2026-07-15T20:00:00.000Z', edgeMlHome: 0.09 }),
    ], now)
    expect(targets.map((target) => [target.game.id, target.pass])).toEqual([
      ['BOS_at_TOR', 'early'],
      ['NYY_at_BOS', 'near-start'],
    ])
    expect(targets[0].snapshot.id).toBe('edge-new')
  })

  test('batches one sport call per start cluster and keeps NFL ahead of NHL and MLB', () => {
    const targets = selectGameLineCloseTargets([
      game({ id: 'NHL_A', date: '2026-07-15T23:10:00.000Z' }),
      game({ id: 'NHL_B', date: '2026-07-15T23:20:00.000Z', oddsApiEventId: 'evt-b' }),
      game({ id: 'MLB', sport: 'mlb', date: '2026-07-15T23:12:00.000Z', oddsApiEventId: 'evt-mlb' }),
      game({ id: 'NFL', sport: 'nfl', date: '2026-07-15T23:15:00.000Z', oddsApiEventId: 'evt-nfl' }),
    ], [
      edge({ gameId: 'NHL_A' }),
      edge({ gameId: 'NHL_B' }),
      edge({ gameId: 'MLB', edgeMlHome: null, edgeTotalO: 0.03 }),
      edge({ gameId: 'NFL' }),
    ], now)
    const clusters = clusterGameLineCloseTargets(targets)
    expect(clusters.map((cluster) => cluster.sport)).toEqual(['nfl', 'nhl', 'mlb'])
    expect(clusters[1].gameIds).toEqual(['NHL_A', 'NHL_B'])
    expect(clusters).toHaveLength(3)

    const split = clusterGameLineCloseTargets([
      { game: game({ id: 'EARLY', date: '2026-07-15T23:00:00.000Z' }), pass: 'early' },
      { game: game({ id: 'LATER', date: '2026-07-15T23:40:00.000Z' }), pass: 'early' },
    ])
    expect(split).toHaveLength(2)
    expect(split.map((cluster) => cluster.gameIds)).toEqual([['EARLY'], ['LATER']])
  })

  test('sport odds URL is one h2h,totals call for the cluster region', () => {
    const url = buildSportOddsUrl({
      sportKey: 'icehockey_nhl',
      markets: gameLineCloseMarkets(),
      regions: ['us'],
      apiKey: 'secret',
      commenceTimeFrom: '2026-07-15T23:10:00.000Z',
      commenceTimeTo: '2026-07-15T23:20:00.000Z',
    })
    expect(url).toContain('/v4/sports/icehockey_nhl/odds?')
    expect(url).not.toContain('/events/')
    expect(url).toContain('markets=h2h%2Ctotals')
    expect(url).not.toContain('spreads')
    expect(url).toContain('regions=us')
    const withSpreads = buildSportOddsUrl({
      sportKey: 'baseball_mlb',
      markets: gameLineCloseMarkets({ spreads: true }),
      regions: ['us'],
    })
    expect(withSpreads).toContain('markets=h2h%2Cspreads%2Ctotals')
  })

  test('game-line budget leaves prop calls ahead and stops at the sub-cap', () => {
    const clusters = clusterGameLineCloseTargets([
      { game: game({ id: 'NFL', sport: 'nfl' }), pass: 'early' },
      { game: game({ id: 'NHL' }), pass: 'early' },
    ])
    const capped = selectGameLineClustersWithinBudget(clusters, {
      markets: ['h2h', 'totals'],
      regions: ['us'],
      maxCredits: 2,
      maxGameLineCredits: 12,
      includeQuota: true,
    })
    expect(capped.clusters.map((cluster) => cluster.sport)).toEqual(['nfl'])
    expect(capped.plannedCalls).toBe(2)
    expect(capped.plannedCredits).toBe(2)
    expect(capped.gameLineCredits).toBe(2)
    expect(capped.skipped).toBe(1)
    expect(capped.clusters[0].creditCost).toBe(2)

    const afterProps = selectGameLineClustersWithinBudget(clusters, {
      markets: ['h2h', 'totals'],
      regions: ['us'],
      maxCalls: 2,
      callsAlready: 2,
      creditsAlready: 1,
      capturesAlready: 1,
      includeQuota: false,
    })
    expect(afterProps.clusters).toEqual([])
    expect(afterProps.plannedCalls).toBe(2)
    expect(afterProps.skipped).toBe(2)

    const subCap = selectGameLineClustersWithinBudget(clusters, {
      markets: ['h2h', 'totals'],
      regions: ['us'],
      maxGameLineCredits: 2,
      includeQuota: true,
    })
    expect(subCap.clusters).toHaveLength(1)
    expect(subCap.gameLineCredits).toBe(2)
    expect(subCap.skipped).toBe(1)
  })

  test('NHL sport rows keep quoted_at and a second write does not insert again', async () => {
    const capturedAt = new Date('2026-07-15T22:50:00.000Z')
    const event = {
      id: 'evt-bos',
      home_team: 'Boston Bruins',
      away_team: 'Toronto Maple Leafs',
      bookmakers: [{
        title: 'FanDuel',
        markets: [
          {
            key: 'h2h',
            last_update: '2026-07-15T22:40:00.000Z',
            outcomes: [
              { name: 'Boston Bruins', price: -140 },
              { name: 'Toronto Maple Leafs', price: 120 },
            ],
          },
          {
            key: 'spreads',
            last_update: '2026-07-15T22:40:00.000Z',
            outcomes: [
              { name: 'Boston Bruins', price: -110, point: -1.5 },
              { name: 'Toronto Maple Leafs', price: -110, point: 1.5 },
            ],
          },
          {
            key: 'totals',
            last_update: '2026-07-15T22:41:00.000Z',
            outcomes: [
              { name: 'Over', price: -105, point: 6.5 },
              { name: 'Under', price: -115, point: 6.5 },
            ],
          },
        ],
      }],
    }
    const rows = gameLineClosesForSportEvent(event, game(), capturedAt, {
      markets: ['h2h', 'totals'],
    })
    expect(rows.map((row) => row.market).sort()).toEqual(['h2h', 'totals'])
    expect(rows.every((row) => row.sport === 'nhl')).toBe(true)
    expect(rows.find((row) => row.market === 'h2h').quoted_at).toBe('2026-07-15T22:40:00.000Z')
    expect(rows.find((row) => row.market === 'totals').quoted_at).toBe('2026-07-15T22:41:00.000Z')
    expect(rows.every((row) => row.id.startsWith('clvclose:'))).toBe(true)

    const existing = []
    const inserts = []
    const supabase = {
      from() {
        return {
          select() { return this },
          in() { return Promise.resolve({ data: existing, error: null }) },
          insert(body) {
            inserts.push(...body)
            existing.push(...body)
            return Promise.resolve({ data: body, error: null })
          },
        }
      },
    }
    resetClosingOddsWriteGuard()
    const first = await writeGameLineCloses(supabase, rows)
    expect(first.inserted).toBe(2)
    resetClosingOddsWriteGuard()
    const second = await writeGameLineCloses(supabase, rows)
    expect(second.inserted).toBe(0)
    expect(second.skipped).toBe(2)
    expect(inserts).toHaveLength(2)
  })

  test('drops a quote after the capture and a quote outside the close window', () => {
    const capturedAt = new Date('2026-07-15T22:50:00.000Z')
    const late = gameLineClosesFromEventOdds({
      home_team: 'Boston Bruins',
      away_team: 'Toronto Maple Leafs',
      bookmakers: [{
        title: 'FanDuel',
        markets: [{
          key: 'h2h',
          last_update: '2026-07-15T22:58:00.000Z',
          outcomes: [
            { name: 'Boston Bruins', price: -140 },
            { name: 'Toronto Maple Leafs', price: 120 },
          ],
        }],
      }],
    }, {
      gameId: 'BOS_at_TOR',
      sport: 'nhl',
      capturedAt,
      kickoff: '2026-07-15T23:10:00.000Z',
    })
    expect(late.filter((row) => row.book === 'FanDuel')).toEqual([])
    expect(gameLineQuoteFitsClose({
      quotedAt: '2026-07-15T22:58:00.000Z',
      snapshotAt: '2026-07-15T22:55:00.000Z',
      kickoff: '2026-07-15T23:10:00.000Z',
    })).toBe(false)

    const earlyQuote = gameLineClosesForSportEvent({
      id: 'evt-bos',
      home_team: 'Boston Bruins',
      away_team: 'Toronto Maple Leafs',
      bookmakers: [{
        title: 'FanDuel',
        markets: [{
          key: 'h2h',
          last_update: '2026-07-15T21:00:00.000Z',
          outcomes: [
            { name: 'Boston Bruins', price: -140 },
            { name: 'Toronto Maple Leafs', price: 120 },
          ],
        }],
      }],
    }, game(), capturedAt, { markets: ['h2h'] })
    expect(earlyQuote.filter((row) => row.book === 'FanDuel')).toEqual([])
    expect(earlyQuote.some((row) => row.book === 'attempted' && row.market === 'h2h')).toBe(true)
  })

  test('drops a total when over and under quote different points', () => {
    const rows = gameLineClosesFromEventOdds({
      home_team: 'Boston Bruins',
      away_team: 'Toronto Maple Leafs',
      bookmakers: [{
        title: 'FanDuel',
        markets: [{
          key: 'totals',
          last_update: '2026-07-15T22:40:00.000Z',
          outcomes: [
            { name: 'Over', price: -105, point: 6.5 },
            { name: 'Under', price: -115, point: 6 },
          ],
        }],
      }],
    }, {
      gameId: 'BOS_at_TOR',
      sport: 'nhl',
      capturedAt: new Date('2026-07-15T22:50:00.000Z'),
      kickoff: '2026-07-15T23:10:00.000Z',
    })
    expect(rows).toEqual([])
  })

  test('rejects null total points and accepts the contract quote window', () => {
    const capturedAt = new Date('2026-07-15T22:50:00.000Z')
    const kickoff = '2026-07-15T23:10:00.000Z'
    const base = {
      home_team: 'Boston Bruins',
      away_team: 'Toronto Maple Leafs',
    }
    const totals = (overPoint, underPoint) => gameLineClosesFromEventOdds({
      ...base,
      bookmakers: [{
        title: 'FanDuel',
        markets: [{
          key: 'totals',
          last_update: '2026-07-15T22:40:00.000Z',
          outcomes: [
            { name: 'Over', price: -105, point: overPoint },
            { name: 'Under', price: -115, point: underPoint },
          ],
        }],
      }],
    }, { gameId: 'BOS_at_TOR', sport: 'nhl', capturedAt, kickoff })
    expect(totals(null, null)).toEqual([])
    expect(totals(6.5, null)).toEqual([])
    expect(totals(undefined, undefined)).toEqual([])
    expect(totals(0, 0)).toEqual([
      expect.objectContaining({ market: 'totals', total: 0, book: 'FanDuel' }),
    ])

    expect(gameLineQuoteFitsClose({
      quotedAt: '2026-07-15T22:35:00.000Z',
      snapshotAt: '2026-07-15T22:50:00.000Z',
      kickoff,
    })).toBe(false)
    expect(gameLineQuoteFitsClose({
      quotedAt: '2026-07-15T22:35:00.001Z',
      snapshotAt: '2026-07-15T22:50:00.000Z',
      kickoff,
    })).toBe(true)
    expect(gameLineQuoteFitsClose({
      quotedAt: '2026-07-15T23:09:00.000Z',
      snapshotAt: '2026-07-15T23:09:00.000Z',
      kickoff,
    })).toBe(true)
    expect(gameLineQuoteFitsClose({
      quotedAt: '2026-07-15T23:09:00.001Z',
      snapshotAt: '2026-07-15T23:09:00.001Z',
      kickoff,
    })).toBe(false)
  })

  test('a timezone-less kickoff accepts the same quote in Eastern time and UTC', () => {
    const kickoff = '2026-11-08T14:30:00'
    const quotedAt = '2026-11-08T13:58:00.000Z'
    const snapshotAt = '2026-11-08T13:58:00.000Z'
    const script = `
      import { gameLineQuoteFitsClose, gameLineClusterCommenceBounds } from './lib/closing-line.js'
      import { shouldRecaptureStoredClose } from './scripts/capture-published-closes.js'
      const accepted = gameLineQuoteFitsClose({
        quotedAt: ${JSON.stringify(quotedAt)},
        snapshotAt: ${JSON.stringify(snapshotAt)},
        kickoff: ${JSON.stringify(kickoff)},
      })
      const bounds = gameLineClusterCommenceBounds([{ game: { date: ${JSON.stringify(kickoff)} } }])
      const recapture = shouldRecaptureStoredClose(
        { date: ${JSON.stringify(kickoff)} },
        new Date('2026-11-08T14:25:00.000Z'),
      )
      process.stdout.write(JSON.stringify({ accepted, from: bounds.commenceTimeFrom, recapture }))
    `
    const run = (tz) => {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: process.cwd(),
        env: { ...process.env, TZ: tz, NODE_NO_WARNINGS: '1' },
        encoding: 'utf8',
      })
      expect(result.status).toBe(0)
      const line = result.stdout.trim().split('\n').filter(Boolean).at(-1)
      return JSON.parse(line)
    }
    const eastern = run('America/New_York')
    const utc = run('UTC')
    expect(eastern).toEqual(utc)
    expect(eastern.accepted).toBe(true)
    expect(eastern.from).toBe('2026-11-08T14:29:59.000Z')
    expect(eastern.recapture).toBe(true)

    const decision = gameLineQuoteCloseDecision({ quotedAt, snapshotAt, kickoff })
    expect(decision).toMatchObject({
      ok: true,
      kickoffAt: '2026-11-08T14:30:00.000Z',
      quoteAt: quotedAt,
      captureAt: snapshotAt,
      windowStart: '2026-11-08T13:55:00.000Z',
      windowEnd: '2026-11-08T14:29:00.000Z',
    })
    const logs = []
    const rows = gameLineClosesFromEventOdds({
      home_team: 'Atlanta Falcons',
      away_team: 'Cincinnati Bengals',
      bookmakers: [{
        title: 'FanDuel',
        markets: [{
          key: 'h2h',
          last_update: quotedAt,
          outcomes: [
            { name: 'Atlanta Falcons', price: -150 },
            { name: 'Cincinnati Bengals', price: 130 },
          ],
        }],
      }],
    }, {
      gameId: 'CIN_at_ATL',
      sport: 'nfl',
      capturedAt: new Date(snapshotAt),
      kickoff,
      log: { log: (line) => logs.push(line) },
    })
    expect(rows).toEqual([
      expect.objectContaining({
        book: 'FanDuel',
        market: 'h2h',
        game_id: 'CIN_at_ATL',
        quoted_at: quotedAt,
      }),
    ])
    expect(logs).toEqual([])

    const rejected = []
    gameLineClosesFromEventOdds({
      home_team: 'Atlanta Falcons',
      away_team: 'Cincinnati Bengals',
      bookmakers: [{
        title: 'FanDuel',
        markets: [{
          key: 'h2h',
          last_update: '2026-11-08T13:50:00.000Z',
          outcomes: [
            { name: 'Atlanta Falcons', price: -150 },
            { name: 'Cincinnati Bengals', price: 130 },
          ],
        }],
      }],
    }, {
      gameId: 'CIN_at_ATL',
      sport: 'nfl',
      capturedAt: new Date(snapshotAt),
      kickoff,
      log: { log: (line) => rejected.push(String(line)) },
    })
    expect(rejected[0]).toMatch(/quote before close window/)
    expect(rejected[0]).toMatch(/quote=2026-11-08T13:50:00.000Z/)
    expect(rejected[0]).toMatch(/kickoff=2026-11-08T14:30:00.000Z/)
    expect(rejected[0]).toMatch(/capture=2026-11-08T13:58:00.000Z/)
    expect(rejected[0]).toMatch(/window=\(2026-11-08T13:55:00.000Z, 2026-11-08T14:29:00.000Z\]/)
    expect(rejected[0]).not.toMatch(/apiKey|secret/)
  })

  test('attempted game-line rows do not block a later real close', async () => {
    const game = { id: 'CIN_at_ATL', sport: 'nfl', date: '2026-11-08T14:30:00' }
    const attempted = ['h2h', 'spreads', 'totals'].map((market) => ({
      id: `clvclose:cin_at_atl|attempted|${market}`,
      game_id: 'CIN_at_ATL',
      book: 'attempted',
      market,
    }))
    expect(nflGameLineMarketsAlreadyCaptured(game, attempted)).toBe(false)
    expect(gameLineMarketsAlreadyCaptured(game, attempted, ['h2h', 'totals'])).toBe(false)
    const realRows = ['h2h', 'totals'].map((market) => ({
      id: `clvclose:cin_at_atl|fanduel|${market}`,
      game_id: 'CIN_at_ATL',
      book: 'FanDuel',
      market,
    }))
    expect(gameLineMarketsAlreadyCaptured(game, [...attempted, ...realRows], ['h2h', 'totals'])).toBe(true)
    expect(nflGameLineMarketsAlreadyCaptured(game, [...attempted, ...realRows])).toBe(false)

    const quotedAt = '2026-11-08T13:58:00.000Z'
    const proposed = gameLineClosesFromEventOdds({
      home_team: 'Atlanta Falcons',
      away_team: 'Cincinnati Bengals',
      bookmakers: [{
        title: 'FanDuel',
        markets: [{
          key: 'h2h',
          last_update: quotedAt,
          outcomes: [
            { name: 'Atlanta Falcons', price: -150 },
            { name: 'Cincinnati Bengals', price: 130 },
          ],
        }],
      }],
    }, {
      gameId: 'CIN_at_ATL',
      sport: 'nfl',
      capturedAt: new Date(quotedAt),
      kickoff: game.date,
    })
    expect(proposed.map((row) => row.book)).toEqual(['FanDuel'])
    const existing = [...attempted]
    const inserts = []
    const supabase = {
      from() {
        return {
          select() { return this },
          in() { return Promise.resolve({ data: existing, error: null }) },
          insert(body) {
            inserts.push(...body)
            existing.push(...body)
            return Promise.resolve({ data: body, error: null })
          },
        }
      },
    }
    resetClosingOddsWriteGuard()
    setClosingOddsClock(() => new Date('2026-11-08T13:58:00.000Z'))
    try {
      const first = await writeGameLineCloses(supabase, proposed)
      expect(first.inserted).toBe(1)
      expect(inserts.map((row) => row.id)).toEqual(['clvclose:cin_at_atl|fanduel|h2h'])
      resetClosingOddsWriteGuard()
      const second = await writeGameLineCloses(supabase, proposed)
      expect(second.inserted).toBe(0)
      expect(second.skipped).toBe(1)
      expect(inserts).toHaveLength(1)
    } finally {
      resetClosingOddsWriteGuard()
    }
  })

  test('the close write itself stops during the quiet window', async () => {
    setClosingOddsClock(() => new Date('2026-07-15T16:09:00.000Z'))
    const inserts = []
    const supabase = {
      from() {
        return {
          insert(body) {
            inserts.push(...body)
            return Promise.resolve({ data: body, error: null })
          },
        }
      },
    }
    try {
      const written = await writeGameLineCloses(supabase, [{
        id: 'clvclose:bos_at_tor|fanduel|h2h',
        game_id: 'BOS_at_TOR',
        book: 'FanDuel',
        market: 'h2h',
        price_home: -140,
        price_away: 120,
        snapshot_at: '2026-07-15T22:50:00.000Z',
        quoted_at: '2026-07-15T22:40:00.000Z',
      }])
      expect(written.quiet).toBe(true)
      expect(written.inserted).toBe(0)
      expect(inserts).toEqual([])
    } finally {
      resetClosingOddsWriteGuard()
    }
  })

  test('ClosingOdds load orders by id and follows a second page', async () => {
    const ranges = []
    const rows = [
      { id: 'b', game_id: 'g', book: 'FanDuel', market: 'h2h' },
      { id: 'a', game_id: 'g', book: 'FanDuel', market: 'totals' },
    ]
    const supabase = {
      from() {
        const query = {
          select() { return query },
          in() { return query },
          order() { return query },
          range(from, to) {
            ranges.push([from, to])
            return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
          },
        }
        return query
      },
    }
    const loaded = await loadExistingClosingOdds(supabase, ['g'], { pageSize: 1 })
    expect(ranges).toEqual([[0, 0], [1, 1], [2, 2]])
    expect(loaded.rows.map((row) => row.id)).toEqual(['b', 'a'])
    expect(loaded.error).toBeNull()
  })
})
