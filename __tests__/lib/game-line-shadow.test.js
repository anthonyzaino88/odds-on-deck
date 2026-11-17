import {
  GAME_LINE_SKIP_REASONS,
  SIDES_TOTALS_COHORT_TAG,
  formatGameLineRecorderSection,
  emptyGameLineRecorderSummary,
  bumpGameLineSkip,
  gradeGameLineFromScores,
  isPublicGameLine,
  selectGameLines,
} from '../../lib/game-lines.js'
import {
  GAME_LINE_SHADOW_SPORTS,
  GAME_LINE_TOTALS_HEURISTIC_TAG,
  attachShadowGameLineCloses,
  gameLineShadowPersistNotes,
  gameLineShadowPropId,
  isReusableShadowGameLineRow,
  inspectGameLineShadowSnapshot,
  isShadowGameLineRecord,
  matchShadowGameLineClosingOdds,
  modelVersionFromNotes,
} from '../../lib/game-line-shadow.js'
import {
  NFL_SELECTION_MODEL_VERSION,
  calculateNFLSelection,
} from '../../lib/nfl-selection-model.js'
import {
  SHADOW_PUBLISHED_COHORT_TAG,
  isPrivateShadowPublished,
  isPublishedPick,
  isSidesTotalsPick,
  filterPublicArchiveRows,
  summarizeSidesTotals,
  withoutPrivateShadowPublished,
} from '../../lib/published-picks.js'
import { inspectGameLineSnapshot } from '../../lib/picks.js'
import {
  formatGameLineShadowGroup,
  groupGameLineShadowPicks,
  runReportGameLineShadow,
  summarizeGameLineShadowGroup,
} from '../../scripts/report-game-line-shadow.js'

const NOW = new Date('2025-12-15T18:00:00.000Z')
const FUTURE = '2025-12-21T18:00:00.000Z'

function scoringTeam(abbr, record, extras = {}) {
  return {
    abbr,
    last10Record: record,
    season: '2025',
    statsKind: 'season',
    statsCapturedAt: '2025-12-12T00:00:00.000Z',
    dataThrough: '2025-12-12T00:00:00.000Z',
    avgPointsLast10: abbr === 'KC' ? 28 : 19,
    avgPointsAllowedLast10: abbr === 'KC' ? 17 : 24,
    gamesPlayed: 16,
    ...extras,
  }
}

const h2h = {
  id: 'odd-h2h-1',
  gameId: 'g-nfl-1',
  book: 'DraftKings',
  market: 'h2h',
  priceHome: -110,
  priceAway: -110,
  ts: '2025-12-15T17:00:00.000Z',
}

const totals = {
  id: 'odd-tot-1',
  gameId: 'g-nfl-1',
  book: 'DraftKings',
  market: 'totals',
  total: 44.5,
  priceHome: -110,
  priceAway: -110,
  ts: '2025-12-15T17:00:00.000Z',
}

function nflGame(overrides = {}) {
  return {
    id: 'g-nfl-1',
    sport: 'nfl',
    season: '2025',
    date: FUTURE,
    status: 'scheduled',
    home: scoringTeam('KC', '12-4'),
    away: scoringTeam('DEN', '4-12'),
    ...overrides,
  }
}

function nflSelection(game = nflGame(), odds = [h2h, totals]) {
  return calculateNFLSelection(game, odds, { now: NOW })
}

function nhlGame(overrides = {}) {
  return {
    id: 'g-nhl-1',
    sport: 'nhl',
    date: FUTURE,
    status: 'scheduled',
    home: { abbr: 'ANA' },
    away: { abbr: 'NSH' },
    ...overrides,
  }
}

describe('inspectGameLineShadowSnapshot', () => {
  test('records one NFL moneyline and one heuristic total while public inspect stays empty', () => {
    const game = nflGame()
    const selection = nflSelection(game)
    const edge = {
      modelRun: NFL_SELECTION_MODEL_VERSION,
      payload: selection,
      eligibleForPublic: false,
    }

    const publicInspect = inspectGameLineSnapshot({
      game,
      edge,
      oddsRows: [h2h, totals],
      now: NOW,
    })
    expect(publicInspect.picks).toEqual([])
    expect(selectGameLines(publicInspect.picks)).toEqual([])

    const shadow = inspectGameLineShadowSnapshot({
      game,
      edge,
      oddsRows: [h2h, totals],
      now: NOW,
    })
    const types = shadow.picks.map((pick) => pick.type).sort()
    expect(types).toEqual(['moneyline', 'total'])
    expect(shadow.picks.every((pick) => pick.shadow === true)).toBe(true)
    expect(shadow.picks.every((pick) => pick.eligibleForPublic === false)).toBe(true)
    expect(shadow.picks.every((pick) => pick.modelVersion === NFL_SELECTION_MODEL_VERSION)).toBe(true)
    expect(shadow.picks.filter((pick) => pick.type === 'moneyline')).toHaveLength(1)
    expect(shadow.picks.filter((pick) => pick.type === 'total')).toHaveLength(1)
    const total = shadow.picks.find((pick) => pick.type === 'total')
    expect(total.totalsHeuristic).toBe(true)
    expect(total.threshold).toBe(44.5)
    expect(shadow.picks.every((pick) => isPublicGameLine(pick, NOW))).toBe(false)
  })

  test('records an NHL moneyline below the 5% floor and still emits one total', () => {
    const game = nhlGame()
    const shadow = inspectGameLineShadowSnapshot({
      game,
      edge: {
        modelRun: 'nhl-gd-v0.2.0',
        edgeMlAway: 0.0318,
        payload: {
          sport: 'nhl',
          modelVersion: 'nhl-gd-v0.2.0',
          rawModelProb: 0.4682,
          home: { gfPerGame: 2.8, gaPerGame: 3.1 },
          away: { gfPerGame: 3.4, gaPerGame: 2.7 },
        },
      },
      oddsRows: [
        { market: 'h2h', priceHome: -110, priceAway: -110, ts: FUTURE },
        { market: 'totals', total: 6.5, priceHome: -110, priceAway: -110, ts: FUTURE },
      ],
      now: NOW,
    })
    expect(shadow.picks.map((pick) => pick.type).sort()).toEqual(['moneyline', 'total'])
    const ml = shadow.picks.find((pick) => pick.type === 'moneyline')
    expect(ml.pick).toBe('NSH')
    expect(ml.edge).toBeGreaterThan(0)
    expect(ml.edge).toBeLessThan(0.05)
    expect(selectGameLines(shadow.picks)).toEqual([])
  })

  test('skips a live game and names the lock-time reason', () => {
    const shadow = inspectGameLineShadowSnapshot({
      game: nhlGame({ date: '2025-12-15T17:00:00.000Z', status: 'in_progress' }),
      edge: { modelRun: 'nhl-gd-v0.2.0', payload: { rawModelProb: 0.56 } },
      oddsRows: [h2h],
      now: NOW,
    })
    expect(shadow.picks).toEqual([])
    expect(shadow.skips[0].reason).toBe(GAME_LINE_SKIP_REASONS.LOCK_TIME)
    expect(shadow.skips[0].gameId).toBe('g-nhl-1')
  })

  test('skips NFL totals when no scoring estimate exists and still records moneyline', () => {
    const game = nflGame({
      home: scoringTeam('KC', '12-4', { avgPointsLast10: null, avgPointsAllowedLast10: null }),
      away: scoringTeam('DEN', '4-12', { avgPointsLast10: null, avgPointsAllowedLast10: null }),
    })
    const selection = nflSelection(game, [h2h, totals])
    const shadow = inspectGameLineShadowSnapshot({
      game,
      edge: { modelRun: NFL_SELECTION_MODEL_VERSION, payload: selection },
      oddsRows: [h2h, totals],
      now: NOW,
    })
    expect(shadow.picks.some((pick) => pick.type === 'moneyline')).toBe(true)
    expect(shadow.picks.some((pick) => pick.type === 'total')).toBe(false)
    expect(shadow.skips.map((skip) => skip.reason)).toContain(GAME_LINE_SKIP_REASONS.MISSING_TOTALS_ESTIMATE)
  })

  test('skips NFL totals as no_odds when the market quote is missing', () => {
    const game = nflGame()
    const selection = nflSelection(game, [h2h])
    const shadow = inspectGameLineShadowSnapshot({
      game,
      edge: { modelRun: NFL_SELECTION_MODEL_VERSION, payload: selection },
      oddsRows: [h2h],
      now: NOW,
    })
    expect(shadow.picks.some((pick) => pick.type === 'moneyline')).toBe(true)
    expect(shadow.skips.map((skip) => skip.reason)).toContain(GAME_LINE_SKIP_REASONS.NO_ODDS)
    expect(shadow.skips.find((skip) => skip.reason === GAME_LINE_SKIP_REASONS.NO_ODDS).market).toBe('total')
  })

  test('leaves MLB unpublished', () => {
    const shadow = inspectGameLineShadowSnapshot({
      game: { id: 'g-mlb-1', sport: 'mlb', date: FUTURE, status: 'scheduled', home: { abbr: 'NYY' }, away: { abbr: 'BOS' } },
      edge: { modelRun: 'v0.2.0', edgeMlHome: 0.08 },
      oddsRows: [h2h],
      now: NOW,
    })
    expect(shadow.picks).toEqual([])
    expect(shadow.skips[0].reason).toBe(GAME_LINE_SKIP_REASONS.UNPUBLISHED)
  })

  test('prop ids are one per game/market/model version so re-runs do not duplicate', () => {
    const a = gameLineShadowPropId({
      gameId: 'g-nfl-1',
      type: 'moneyline',
      pick: 'KC',
      modelVersion: 'nfl-selection-v1.0.1',
    })
    const b = gameLineShadowPropId({
      gameId: 'g-nfl-1',
      type: 'moneyline',
      pick: 'DEN',
      modelVersion: 'nfl-selection-v1.0.1',
    })
    const later = gameLineShadowPropId({
      gameId: 'g-nfl-1',
      type: 'moneyline',
      pick: 'KC',
      modelVersion: 'nfl-selection-v1.1.0',
    })
    expect(a).toBe(b)
    expect(a).toBe('gl-shadow-g-nfl-1-moneyline-nfl-selection-v1.0.1')
    expect(later).toBe('gl-shadow-g-nfl-1-moneyline-nfl-selection-v1.1.0')
  })

  test('reuses a pending legacy NHL gl- id for the same game, market, and model', () => {
    const line = {
      gameId: 'g-nhl-1',
      sport: 'nhl',
      type: 'total',
      modelVersion: 'nhl-gd-v0.2.0',
    }
    const legacy = {
      id: 'pv-old',
      propId: 'gl-g-nhl-1-total-over-6.5',
      gameIdRef: 'g-nhl-1',
      sport: 'nhl',
      source: 'game_line',
      propType: 'total',
      status: 'pending',
      notes: 'cohort:sides_totals | cohort:shadow-published',
    }
    expect(isReusableShadowGameLineRow(legacy, line)).toBe(true)
    expect(isReusableShadowGameLineRow({ ...legacy, status: 'completed' }, line)).toBe(false)
    expect(isReusableShadowGameLineRow({ ...legacy, propType: 'moneyline' }, line)).toBe(false)
    expect(isReusableShadowGameLineRow({
      ...legacy,
      notes: 'cohort:sides_totals | cohort:shadow-published | model:nhl-gd-v0.1.0',
    }, line)).toBe(false)
    expect(isReusableShadowGameLineRow({
      ...legacy,
      sport: 'nfl',
      notes: 'cohort:sides_totals',
    }, { ...line, sport: 'nfl' })).toBe(false)
  })
})

describe('shadow notes and public exclusion', () => {
  test('notes carry the private shadow tag, model version, and heuristic marker', () => {
    const notes = gameLineShadowPersistNotes(null, {
      modelVersion: 'nfl-selection-v1.0.1',
      marketFairProb: 0.5123,
      totalsHeuristic: true,
    })
    expect(notes).toMatch(SIDES_TOTALS_COHORT_TAG)
    expect(notes).toMatch(SHADOW_PUBLISHED_COHORT_TAG)
    expect(notes).toMatch(/model:nfl-selection-v1.0.1/)
    expect(notes).toMatch(GAME_LINE_TOTALS_HEURISTIC_TAG)
    expect(notes).not.toMatch(/auto-saved/)
    expect(modelVersionFromNotes(notes)).toBe('nfl-selection-v1.0.1')
  })

  test('public Published, archive, and sides/totals filters drop shadow NFL game lines', () => {
    const row = {
      sport: 'nfl',
      source: 'game_line',
      propType: 'moneyline',
      prediction: 'KC',
      status: 'completed',
      result: 'correct',
      odds: -110,
      edge: 0.012,
      notes: gameLineShadowPersistNotes(null, { modelVersion: 'nfl-selection-v1.0.1' }),
    }
    expect(isShadowGameLineRecord(row)).toBe(true)
    expect(isPrivateShadowPublished(row)).toBe(true)
    expect(isPublishedPick(row)).toBe(false)
    expect(isSidesTotalsPick(row)).toBe(false)
    expect(isPublicGameLine(row)).toBe(false)
    expect(filterPublicArchiveRows([row])).toEqual([])
    expect(withoutPrivateShadowPublished([row])).toEqual([])
    expect(summarizeSidesTotals([row]).graded).toBe(0)
    expect(isSidesTotalsPick(row, { includeShadow: true, sports: ['nfl'] })).toBe(true)
    expect(summarizeSidesTotals([row], { includeShadow: true, sports: ['nfl'] }).graded).toBe(1)
  })

  test('grades a shadow moneyline from the final score without touching the tag', () => {
    const row = {
      source: 'game_line',
      propType: 'moneyline',
      prediction: 'KC',
      notes: gameLineShadowPersistNotes(null, { modelVersion: 'nfl-selection-v1.0.1' }),
    }
    const outcome = gradeGameLineFromScores(row, {
      homeScore: 27,
      awayScore: 20,
      home: { abbr: 'KC' },
      away: { abbr: 'DEN' },
    })
    expect(outcome).toEqual({ result: 'correct', actualValue: 27 })
    expect(row.notes).toMatch(SHADOW_PUBLISHED_COHORT_TAG)
  })
})

describe('same-line close attach from ClosingOdds', () => {
  test('matches consensus same-line totals and home moneyline prices', () => {
    const game = { id: 'g-nfl-1', home: { abbr: 'KC' }, away: { abbr: 'DEN' } }
    const totalPick = {
      gameIdRef: 'g-nfl-1',
      propType: 'total',
      prediction: 'over',
      threshold: 44.5,
      odds: -110,
    }
    const mlPick = {
      gameIdRef: 'g-nfl-1',
      propType: 'moneyline',
      prediction: 'KC',
      threshold: 0,
      odds: -110,
    }
    const rows = [
      {
        id: 'clvclose:g-nfl-1|fanduel|totals',
        game_id: 'g-nfl-1',
        book: 'FanDuel',
        market: 'totals',
        price_home: -105,
        price_away: -115,
        total: 44.5,
      },
      {
        id: 'clvclose:g-nfl-1|draftkings|totals',
        game_id: 'g-nfl-1',
        book: 'DraftKings',
        market: 'totals',
        price_home: -110,
        price_away: -110,
        total: 44.5,
      },
      {
        id: 'clvclose:g-nfl-1|fanduel|h2h',
        game_id: 'g-nfl-1',
        book: 'FanDuel',
        market: 'h2h',
        price_home: -120,
        price_away: 100,
      },
      {
        id: 'clvclose:g-nfl-1|betmgm|totals',
        game_id: 'g-nfl-1',
        book: 'BetMGM',
        market: 'totals',
        price_home: -110,
        price_away: -110,
        total: 47.5,
      },
    ]
    const totalClose = matchShadowGameLineClosingOdds(totalPick, rows, game)
    expect(totalClose.sameLine).toBe(true)
    expect(totalClose.threshold).toBe(44.5)
    expect(totalClose.odds).toBe(-115)
    expect(matchShadowGameLineClosingOdds({ ...totalPick, threshold: 47.5 }, rows, game).odds).toBe(-110)
    expect(matchShadowGameLineClosingOdds(mlPick, rows, game).odds).toBe(-120)
  })

  test('dry-run attach does not write', async () => {
    const updates = []
    const supabase = {
      from(table) {
        updates.push(table)
        throw new Error('dry-run must not write')
      },
    }
    const attached = await attachShadowGameLineCloses({
      supabase,
      picks: [{
        id: 'pv-1',
        gameIdRef: 'g-nfl-1',
        source: 'game_line',
        propType: 'total',
        prediction: 'over',
        threshold: 44.5,
        odds: -110,
        notes: `${SIDES_TOTALS_COHORT_TAG} | ${SHADOW_PUBLISHED_COHORT_TAG}`,
      }],
      closingOddsRows: [{
        id: 'clvclose:g-nfl-1|fd|totals',
        game_id: 'g-nfl-1',
        book: 'FanDuel',
        market: 'totals',
        price_home: -110,
        price_away: -105,
        total: 44.5,
      }],
      games: [{ id: 'g-nfl-1', home: { abbr: 'KC' }, away: { abbr: 'DEN' } }],
      apply: false,
      log: { log() {}, error() {} },
    })
    expect(attached).toHaveLength(1)
    expect(attached[0].dryRun).toBe(true)
    expect(attached[0].closeOdds).toBe(-105)
    expect(updates).toEqual([])
  })
})

describe('recorder skip details and report grouping', () => {
  test('prints per-game skip lines after the skip counts', () => {
    const summary = emptyGameLineRecorderSummary('nfl')
    summary.activeGames = 1
    summary.edgesRead = 1
    bumpGameLineSkip(summary, GAME_LINE_SKIP_REASONS.MISSING_TOTALS_ESTIMATE, 1, {
      gameId: 'g-nfl-1',
      market: 'total',
      modelVersion: 'nfl-selection-v1.0.1',
    })
    const text = formatGameLineRecorderSection(summary)
    expect(text).toMatch(/skips: missing_totals_estimate=1/)
    expect(text).toMatch(/skip g-nfl-1 total missing_totals_estimate nfl-selection-v1.0.1/)
  })

  test('report groups W-L-P, ROI, and same-line CLV per sport and market', () => {
    const rows = [
      {
        sport: 'nfl',
        source: 'game_line',
        propType: 'moneyline',
        prediction: 'KC',
        status: 'completed',
        result: 'correct',
        odds: 100,
        edge: 0.02,
        notes: `${SIDES_TOTALS_COHORT_TAG} | ${SHADOW_PUBLISHED_COHORT_TAG} | model:nfl-selection-v1.0.1`,
        closeOdds: 120,
        closeLine: 0,
      },
      {
        sport: 'nfl',
        source: 'game_line',
        propType: 'moneyline',
        prediction: 'DEN',
        status: 'completed',
        result: 'incorrect',
        odds: -110,
        edge: 0.01,
        notes: `${SIDES_TOTALS_COHORT_TAG} | ${SHADOW_PUBLISHED_COHORT_TAG} | model:nfl-selection-v1.0.1`,
        closeOdds: -105,
        closeLine: 0,
      },
      {
        sport: 'nhl',
        source: 'game_line',
        propType: 'total',
        prediction: 'over',
        status: 'completed',
        result: 'push',
        odds: -110,
        edge: 0.03,
        notes: `${SIDES_TOTALS_COHORT_TAG} | ${SHADOW_PUBLISHED_COHORT_TAG} | model:nhl-gd-v0.2.0`,
        closeOdds: -110,
        closeLine: 6.5,
        threshold: 6.5,
      },
    ]
    const grouped = groupGameLineShadowPicks(rows)
    expect(GAME_LINE_SHADOW_SPORTS).toEqual(['nfl', 'nhl'])
    expect(grouped.get('nfl:moneyline')).toHaveLength(2)
    expect(grouped.get('nfl:total')).toHaveLength(0)
    expect(grouped.get('nhl:total')).toHaveLength(1)
    const nflMl = summarizeGameLineShadowGroup(grouped.get('nfl:moneyline'), 'nfl')
    expect(nflMl.record.correct).toBe(1)
    expect(nflMl.record.incorrect).toBe(1)
    expect(nflMl.record.record).toBe('1–1')
    expect(nflMl.clv.sameLine).toBe(2)
    const formatted = formatGameLineShadowGroup({
      sport: 'nfl',
      market: 'moneyline',
      record: nflMl.record,
      clv: nflMl.clv,
      versions: nflMl.versions,
    })
    expect(formatted.header).toBe('NFL moneyline')
    expect(formatted.n).toMatch(/n: 2/)
    expect(formatted.models).toMatch(/nfl-selection-v1.0.1/)
  })

  test('read-only report groups private rows and never writes', async () => {
    const lines = []
    const writes = []
    const rows = [
      {
        sport: 'nfl',
        source: 'game_line',
        propType: 'moneyline',
        prediction: 'KC',
        status: 'completed',
        result: 'correct',
        odds: 100,
        edge: 0.02,
        notes: `${SIDES_TOTALS_COHORT_TAG} | ${SHADOW_PUBLISHED_COHORT_TAG} | model:nfl-selection-v1.0.1`,
        closeOdds: 120,
        closeLine: 0,
      },
      {
        sport: 'nhl',
        source: 'game_line',
        propType: 'total',
        prediction: 'over',
        status: 'completed',
        result: 'incorrect',
        odds: -110,
        edge: 0.03,
        notes: `${SIDES_TOTALS_COHORT_TAG} | ${SHADOW_PUBLISHED_COHORT_TAG} | model:nhl-gd-v0.2.0`,
        closeOdds: -105,
        closeLine: 6.5,
        threshold: 6.5,
      },
    ]
    const result = await runReportGameLineShadow({
      createClient: () => ({
        from(table) {
          return {
            select() {
              const terminal = Promise.resolve({ data: rows, error: null })
              const query = {
                eq() { return query },
                in() { return query },
                ilike() { return query },
                order() { return query },
                range() { return terminal },
              }
              return query
            },
            update() {
              writes.push(table)
              throw new Error('report must not write')
            },
            insert() {
              writes.push(table)
              throw new Error('report must not write')
            },
          }
        },
      }),
      log: {
        log: (...args) => lines.push(args.join(' ')),
        error: (...args) => lines.push(args.join(' ')),
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.picks).toHaveLength(2)
    expect(result.groups['nfl:moneyline'].n).toBe(1)
    expect(result.groups['nhl:total'].n).toBe(1)
    expect(writes).toEqual([])
    expect(lines.join('\n')).toMatch(/GAME-LINE SHADOW/)
    expect(lines.join('\n')).toMatch(/NFL moneyline/)
    expect(lines.join('\n')).toMatch(/NHL total/)
    expect(lines.join('\n')).toMatch(/Does not write/)
  })
})
