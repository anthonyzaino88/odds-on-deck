import { readFileSync } from 'fs'
import { join } from 'path'
import { applyReconcilePlan, parseGameIdParts } from '../../lib/game-reconcile.js'
import {
  VANISH_DAILY_MAX_RETIRES,
  VANISH_RETIRE_REASON,
  attachFetchMeta,
  canRetireOnCoveredDate,
  classifyEspnScoreboardPayload,
  countNotNeededRetiresSince,
  espnDateParamToKey,
  formatVanishedRetireLog,
  markCoverageUnavailable,
  overallFetchState,
  planVanishedFromFetch,
  runRetireVanishedFromFetch,
} from '../../lib/retire-vanished-games.js'

const TODAY = '2026-10-30'
const TOMORROW = '2026-10-31'
const PAST_NOW = new Date('2026-10-31T12:09:00.000Z') // 8:09 AM EDT Oct 31

function row(id, overrides = {}) {
  const parts = parseGameIdParts(id)
  return {
    id,
    sport: 'mlb',
    date: `${parts.date}T23:10:00.000Z`,
    status: 'scheduled',
    homeScore: null,
    awayScore: null,
    espnGameId: `espn-${id}`,
    mlbGameId: null,
    oddsApiEventId: null,
    dependents: {
      propValidation: 0,
      propValidationPending: 0,
      propValidationGraded: 0,
      propValidationPublished: 0,
      parlayLeg: 0,
      parlayLegPending: 0,
      playerPropCache: 0,
      odds: 0,
      edgeSnapshot: 0,
    },
    ...overrides,
  }
}

function fetched(id, overrides = {}) {
  const parts = parseGameIdParts(id)
  return {
    id,
    sport: 'mlb',
    date: `${parts.date}T23:10:00.000Z`,
    espnGameId: `espn-${id}`,
    ...overrides,
  }
}

describe('ESPN scoreboard coverage helpers', () => {
  test('events:[] is explicit empty; missing events is malformed', () => {
    expect(classifyEspnScoreboardPayload({ events: [] })).toEqual({ state: 'empty', events: [] })
    expect(classifyEspnScoreboardPayload({ events: [{ id: '1' }] }).state).toBe('ok')
    expect(classifyEspnScoreboardPayload({})).toEqual({ state: 'malformed', events: [] })
    expect(classifyEspnScoreboardPayload(null).state).toBe('malformed')
    expect(espnDateParamToKey('20261030')).toBe('2026-10-30')
    expect(espnDateParamToKey('2026-10-30')).toBe('2026-10-30')
  })

  test('overallFetchState never treats an all-failed coverage as empty', () => {
    expect(overallFetchState({ [TODAY]: 'unavailable' }, 0)).toBe('unavailable')
    expect(overallFetchState({ [TODAY]: 'malformed' }, 0)).toBe('unavailable')
    expect(overallFetchState({ [TODAY]: 'empty' }, 0)).toBe('empty')
    expect(overallFetchState({ [TODAY]: 'ok' }, 2)).toBe('ok')
    expect(markCoverageUnavailable({ [TODAY]: 'ok' })).toEqual({ [TODAY]: 'unavailable' })
  })

  test('explicit empty is trusted only for past ET dates or zero pre-start rows', () => {
    expect(canRetireOnCoveredDate('empty', {
      mappedOnDate: 0, dbCandidatesOnDate: 1, date: TODAY, todayEt: TODAY,
    })).toBe(false)
    expect(canRetireOnCoveredDate('empty', {
      mappedOnDate: 0, dbCandidatesOnDate: 1, date: TODAY, todayEt: TOMORROW,
    })).toBe(true)
    expect(canRetireOnCoveredDate('empty', {
      mappedOnDate: 0, dbCandidatesOnDate: 0, date: TODAY, todayEt: TODAY,
    })).toBe(true)
    expect(canRetireOnCoveredDate('ok', { mappedOnDate: 3, dbCandidatesOnDate: 4 })).toBe(true)
    expect(canRetireOnCoveredDate('ok', { mappedOnDate: 0, dbCandidatesOnDate: 2 })).toBe(false)
    expect(canRetireOnCoveredDate('unavailable', { mappedOnDate: 0, dbCandidatesOnDate: 2 })).toBe(false)
    expect(canRetireOnCoveredDate('malformed', { mappedOnDate: 0, dbCandidatesOnDate: 2 })).toBe(false)
  })
})

describe('planVanishedFromFetch', () => {
  test('vanished if-necessary game on a past explicit empty slate is retired', () => {
    const ghost = row('TB_at_MIL_2026-10-30')
    const plan = planVanishedFromFetch({
      dbRows: [ghost],
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'empty' },
      todayEt: TOMORROW,
    })
    expect(plan.actions.find((action) => action.id === ghost.id)).toMatchObject({
      action: 'retire_not_needed',
      reason: VANISH_RETIRE_REASON,
      date: TODAY,
      clearOddsApiEventId: false,
    })
    expect(plan.aborts).toEqual([])
    expect(plan.summary.retired).toBe(1)
    expect(formatVanishedRetireLog(plan.actions[0], 'mlb')).toMatch(/TB_at_MIL_2026-10-30/)
  })

  test('a single events:[] on today does not retire pre-start rows', () => {
    const plan = planVanishedFromFetch({
      dbRows: [row('TB_at_MIL_2026-10-30')],
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'empty' },
      todayEt: TODAY,
    })
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
    expect(plan.aborts[0]).toMatchObject({
      reason: 'empty_fetch_unconfirmed',
      date: TODAY,
    })
  })

  test('1-of-2 on a partial fetch aborts; 1-of-1 and 1-of-3 still retire', () => {
    const two = planVanishedFromFetch({
      dbRows: [
        row('LAD_at_NYY_2026-10-30'),
        row('TB_at_MIL_2026-10-30'),
      ],
      fetchedGames: [fetched('LAD_at_NYY_2026-10-30')],
      coverageByDate: { [TODAY]: 'ok' },
    })
    expect(two.aborts[0]).toMatchObject({
      reason: 'cap_exceeded',
      smallDate: true,
      retires: 1,
      candidates: 2,
    })
    expect(two.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])

    const three = planVanishedFromFetch({
      dbRows: [
        row('LAD_at_NYY_2026-10-30'),
        row('SEA_at_HOU_2026-10-30'),
        row('TB_at_MIL_2026-10-30'),
      ],
      fetchedGames: [
        fetched('LAD_at_NYY_2026-10-30'),
        fetched('SEA_at_HOU_2026-10-30'),
      ],
      coverageByDate: { [TODAY]: 'ok' },
    })
    expect(three.aborts).toEqual([])
    expect(three.actions.find((action) => action.id === 'TB_at_MIL_2026-10-30')).toMatchObject({
      action: 'retire_not_needed',
      reason: VANISH_RETIRE_REASON,
    })
  })

  test('failed fetch never retires games', () => {
    const ghost = row('TB_at_MIL_2026-10-30')
    const plan = planVanishedFromFetch({
      dbRows: [ghost],
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'unavailable' },
    })
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
    expect(plan.aborts[0]).toMatchObject({ reason: 'source_unavailable' })
    expect(plan.summary.retired).toBe(0)
  })

  test('malformed scoreboard (missing events array) never retires', () => {
    const plan = planVanishedFromFetch({
      dbRows: [row('TB_at_MIL_2026-10-30')],
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'malformed' },
    })
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
    expect(plan.aborts[0].reason).toBe('source_unavailable')
  })

  test('ok coverage with 0 mapped games does not retire DB games on that date', () => {
    const plan = planVanishedFromFetch({
      dbRows: [row('TB_at_MIL_2026-10-30')],
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'ok' },
    })
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
    expect(plan.aborts[0]).toMatchObject({
      reason: 'empty_fetch_unconfirmed',
      date: TODAY,
    })
  })

  test('live and final games are never retired', () => {
    const plan = planVanishedFromFetch({
      dbRows: [
        row('TB_at_MIL_2026-10-30', { status: 'in_progress', homeScore: 1, awayScore: 0 }),
        row('LAD_at_NYY_2026-10-30', { status: 'final', homeScore: 4, awayScore: 2 }),
        row('SEA_at_HOU_2026-10-30', { status: 'halftime' }),
      ],
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'empty' },
      todayEt: TOMORROW,
    })
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
    expect(plan.summary.liveOrFinal).toBe(3)
    expect(plan.summary.candidates).toBe(0)
  })

  test('graded or Published PropValidation rows are protected', () => {
    const graded = planVanishedFromFetch({
      dbRows: [row('TB_at_MIL_2026-10-30', {
        dependents: {
          propValidation: 1,
          propValidationPending: 0,
          propValidationGraded: 1,
          propValidationPublished: 0,
          parlayLeg: 0,
          parlayLegPending: 0,
          playerPropCache: 0,
          odds: 0,
          edgeSnapshot: 0,
        },
      })],
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'empty' },
      todayEt: TOMORROW,
    })
    expect(graded.actions[0]).toMatchObject({
      action: 'report',
      reason: 'protected_has_picks',
    })

    const published = planVanishedFromFetch({
      dbRows: [row('TB_at_MIL_2026-10-30', {
        dependents: {
          propValidation: 1,
          propValidationPending: 0,
          propValidationGraded: 0,
          propValidationPublished: 1,
          parlayLeg: 0,
          parlayLegPending: 0,
          playerPropCache: 0,
          odds: 0,
          edgeSnapshot: 0,
        },
      })],
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'empty' },
      todayEt: TOMORROW,
    })
    expect(published.actions[0].reason).toBe('protected_has_picks')
    expect(published.summary.retired).toBe(0)
  })

  test('past-date rows with any props are flagged for review instead of retired', () => {
    const cacheOnly = planVanishedFromFetch({
      dbRows: [row('TB_at_MIL_2026-10-30', {
        dependents: {
          propValidation: 0,
          propValidationPending: 0,
          propValidationGraded: 0,
          propValidationPublished: 0,
          parlayLeg: 0,
          parlayLegPending: 0,
          playerPropCache: 2,
          odds: 0,
          edgeSnapshot: 0,
        },
      })],
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'empty' },
      todayEt: TOMORROW,
    })
    expect(cacheOnly.actions[0]).toMatchObject({
      action: 'report',
      reason: 'review_has_props',
    })
    expect(cacheOnly.summary.retired).toBe(0)

    const settledParlay = planVanishedFromFetch({
      dbRows: [row('TB_at_MIL_2026-10-30', {
        dependents: {
          propValidation: 0,
          propValidationPending: 0,
          propValidationGraded: 0,
          propValidationPublished: 0,
          parlayLeg: 1,
          parlayLegPending: 0,
          playerPropCache: 0,
          odds: 0,
          edgeSnapshot: 0,
        },
      })],
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'empty' },
      todayEt: TOMORROW,
    })
    expect(settledParlay.actions[0].reason).toBe('review_has_props')
    expect(settledParlay.summary.retired).toBe(0)
  })

  test('a failed date does not block retiring a fully covered sibling date', () => {
    const plan = planVanishedFromFetch({
      dbRows: [
        row('TB_at_MIL_2026-10-30'),
        row('LAD_at_NYY_2026-10-31'),
      ],
      fetchedGames: [fetched('SEA_at_HOU_2026-10-31')],
      coverageByDate: {
        [TODAY]: 'unavailable',
        '2026-10-31': 'ok',
      },
    })
    expect(plan.actions.find((action) => action.id === 'TB_at_MIL_2026-10-30')).toBeUndefined()
    expect(plan.actions.find((action) => action.id === 'LAD_at_NYY_2026-10-31')).toMatchObject({
      action: 'retire_not_needed',
    })
  })

  test('same pair on an adjacent fetched date is date_drift, not a retire', () => {
    const plan = planVanishedFromFetch({
      dbRows: [row('TB_at_MIL_2026-10-30')],
      fetchedGames: [fetched('TB_at_MIL_2026-10-31')],
      coverageByDate: { [TODAY]: 'empty', '2026-10-31': 'ok' },
      todayEt: TOMORROW,
    })
    expect(plan.actions.find((action) => action.id === 'TB_at_MIL_2026-10-30')).toMatchObject({
      action: 'report',
      reason: 'date_drift',
    })
    expect(plan.summary.retired).toBe(0)
  })

  test('4 NHL games with a partial fetch of 1 abort instead of retiring 3', () => {
    const ids = [
      'BOS_at_TOR_2026-10-30',
      'NYR_at_NYI_2026-10-30',
      'PIT_at_PHI_2026-10-30',
      'WSH_at_CAR_2026-10-30',
    ]
    const plan = planVanishedFromFetch({
      dbRows: ids.map((id) => row(id, { sport: 'nhl' })),
      fetchedGames: [fetched(ids[0], { sport: 'nhl' })],
      coverageByDate: { [TODAY]: 'ok' },
    })
    expect(plan.summary.candidates).toBe(4)
    expect(plan.aborts[0]).toMatchObject({
      reason: 'cap_exceeded',
      smallDate: true,
      retires: 3,
      candidates: 4,
    })
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
    expect(plan.summary.retired).toBe(0)
  })
})

describe('countNotNeededRetiresSince', () => {
  test('throws retire_count_unavailable when count is not a finite number', async () => {
    const supabase = {
      from() {
        return {
          select() {
            const chain = {
              eq() { return chain },
              gte() { return Promise.resolve({ data: [], count: null, error: null }) },
            }
            return chain
          },
        }
      },
    }
    await expect(countNotNeededRetiresSince(supabase, '2026-10-31T04:00:00.000Z'))
      .rejects.toThrow(/retire_count_unavailable/)
  })
})

describe('runRetireVanishedFromFetch apply', () => {
  function createApplySupabase({
    data = [{ id: 'TB_at_MIL_2026-10-30' }],
    alreadyToday = 0,
    countError = null,
    countValue = alreadyToday,
  } = {}) {
    const ops = []
    return {
      ops,
      from(table) {
        return {
          select() {
            const chain = {
              eq() {
                return chain
              },
              gte() {
                if (countError) {
                  return Promise.resolve({ data: null, count: null, error: countError })
                }
                return Promise.resolve({ data: [], count: countValue, error: null })
              },
            }
            return chain
          },
          update(payload) {
            const op = { table, type: 'update', payload, filters: [] }
            ops.push(op)
            const chain = {
              eq(col, val) {
                op.filters.push([col, val])
                return chain
              },
              select(cols) {
                op.select = cols
                return Promise.resolve({ data, error: null })
              },
            }
            return chain
          },
          delete() {
            throw new Error('delete must not be called')
          },
        }
      },
    }
  }

  test('apply writes not_needed during the ops quiet window and never deletes', async () => {
    const supabase = createApplySupabase()
    const logs = []
    const result = await runRetireVanishedFromFetch({
      sport: 'mlb',
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'empty' },
      dbRows: [row('TB_at_MIL_2026-10-30')],
      supabase,
      apply: true,
      ignoreQuietPeriod: true,
      now: PAST_NOW,
      logger: {
        log: (...args) => logs.push(args.join(' ')),
        warn: (...args) => logs.push(args.join(' ')),
        error: (...args) => logs.push(args.join(' ')),
      },
    })
    expect(result.applied).toEqual([{ id: 'TB_at_MIL_2026-10-30', status: 'not_needed' }])
    expect(supabase.ops[0].payload).toEqual({
      status: 'not_needed',
      lastUpdate: PAST_NOW.toISOString(),
    })
    expect(supabase.ops[0].payload).not.toHaveProperty('oddsApiEventId')
    expect(logs.some((line) => line.includes('TB_at_MIL_2026-10-30'))).toBe(true)
    expect(() => supabase.from('Game').delete()).toThrow(/delete must not/)
  })

  test('daily retire cap aborts apply when 5 games already retired this ET day', async () => {
    const supabase = createApplySupabase({ alreadyToday: VANISH_DAILY_MAX_RETIRES })
    const warns = []
    const result = await runRetireVanishedFromFetch({
      sport: 'nhl',
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'empty' },
      dbRows: [row('BOS_at_TOR_2026-10-30', { sport: 'nhl' })],
      supabase,
      apply: true,
      ignoreQuietPeriod: true,
      now: PAST_NOW,
      logger: {
        log() {},
        warn: (...args) => warns.push(args.join(' ')),
        error() {},
      },
    })
    expect(result.applied).toEqual([])
    expect(supabase.ops).toEqual([])
    expect(result.aborts.some((abort) => abort.reason === 'daily_cap_exceeded')).toBe(true)
    expect(warns.some((line) => line.includes('daily_cap_exceeded'))).toBe(true)
  })

  test('daily cap count:null fails closed and does not retire', async () => {
    const supabase = createApplySupabase({ countValue: null })
    const result = await runRetireVanishedFromFetch({
      sport: 'mlb',
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'empty' },
      dbRows: [row('TB_at_MIL_2026-10-30')],
      supabase,
      apply: true,
      ignoreQuietPeriod: true,
      now: PAST_NOW,
      logger: { log() {}, warn() {}, error() {} },
    })
    expect(result.applied).toEqual([])
    expect(supabase.ops).toEqual([])
    expect(result.skipped).toBe('retire_count_unavailable')
    expect(result.aborts.some((abort) => abort.reason === 'retire_count_unavailable')).toBe(true)
  })

  test('failed coverage dry-run writes nothing', async () => {
    const supabase = createApplySupabase()
    const result = await runRetireVanishedFromFetch({
      sport: 'mlb',
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'unavailable' },
      dbRows: [row('TB_at_MIL_2026-10-30')],
      supabase,
      apply: true,
      logger: { log() {}, warn() {}, error() {} },
    })
    expect(result.applied).toEqual([])
    expect(supabase.ops).toEqual([])
  })

  test('attachFetchMeta stores coverage without enumerating it', () => {
    const games = attachFetchMeta([], {
      fetchState: 'empty',
      coverageByDate: { [TODAY]: 'empty' },
    })
    expect(games.fetchState).toBe('empty')
    expect(games.coverageByDate).toEqual({ [TODAY]: 'empty' })
    expect(Object.keys(games)).toEqual([])
  })
})

describe('fetch-fresh-games vanish-retire hook', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/fetch-fresh-games.js'), 'utf8')

  test('runs after each sport upsert and records per-date coverage', () => {
    expect(src).toMatch(/retireVanishedAfterFetch/)
    expect(src).toMatch(/runRetireVanishedFromFetch/)
    expect(src).toMatch(/classifyEspnScoreboardPayload/)
    expect(src).toMatch(/coverageByDate/)
    expect(src).toMatch(/empty slate/)
    expect(src).toMatch(/saveToSupabase[\s\S]*retireVanishedAfterFetch/)
    expect(src).toMatch(/ignoreQuietPeriod: true/)
    expect(src).toMatch(/ignoreQuietPeriod is true for this write/)
  })
})

describe('applyReconcilePlan ignoreQuietPeriod', () => {
  test('quiet window is skipped when fetch-fresh-games asks to apply', async () => {
    const ops = []
    const supabase = {
      from() {
        return {
          update(payload) {
            const op = { payload, filters: [] }
            ops.push(op)
            const chain = {
              eq(col, val) {
                op.filters.push([col, val])
                return chain
              },
              select() {
                return Promise.resolve({ data: [{ id: 'TB_at_MIL_2026-10-30' }], error: null })
              },
            }
            return chain
          },
        }
      },
    }
    const plan = planVanishedFromFetch({
      dbRows: [row('TB_at_MIL_2026-10-30')],
      fetchedGames: [],
      coverageByDate: { [TODAY]: 'empty' },
      todayEt: TOMORROW,
    })
    const result = await applyReconcilePlan(supabase, plan, {
      now: new Date('2026-10-30T12:09:00.000Z'),
      ignoreQuietPeriod: true,
      logger: { warn() {}, error() {} },
    })
    expect(result.refused).toBe(false)
    expect(result.applied).toEqual([{ id: 'TB_at_MIL_2026-10-30', status: 'not_needed' }])
  })
})

describe('game page not_needed labels', () => {
  const src = readFileSync(join(process.cwd(), 'app/game/[id]/page.js'), 'utf8')

  test('status and subtitle maps include not_needed copy', () => {
    expect(src).toMatch(/'not_needed': 'Not needed'/)
    expect(src).toMatch(/'not_needed': 'Removed from the schedule \(not played\)'/)
  })
})
