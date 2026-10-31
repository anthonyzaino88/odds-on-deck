import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  applyStaleStatusPlan,
  classifyStaleCandidate,
  fetchStaleSources,
  isMoreThanDaysPast,
  planStaleStatusSweep,
  resolveStaleSource,
  runStaleStatusSweep,
  STALE_ACTIVE_STATUSES,
  STALE_APPLY_FLAG,
  STALE_DAYS,
  STALE_NOT_NEEDED_CAP,
} from '../../lib/stale-game-status.js'
import { VANISH_DAILY_MAX_RETIRES } from '../../lib/retire-vanished-games.js'

const TODAY = '2026-10-31'
const NOW_ET_APPLY = new Date('2026-10-31T16:00:00.000Z') // 12:00 PM EDT
const NOW_ET_QUIET = new Date('2026-10-31T15:07:00.000Z') // 11:07 AM EDT

function row(id, overrides = {}) {
  return {
    id,
    sport: 'mlb',
    date: `${id.slice(-10)}T23:10:00.000Z`,
    status: 'scheduled',
    homeScore: null,
    awayScore: null,
    espnGameId: `espn-${id}`,
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

function createApplySupabase({ data = [{ id: 'x' }], error = null, alreadyToday = 0 } = {}) {
  const ops = []
  return {
    ops,
    from(table) {
      return {
        select(cols, opts) {
          if (opts?.count === 'exact') {
            const chain = {
              eq() { return chain },
              gte() { return Promise.resolve({ data: [], count: alreadyToday, error: null }) },
            }
            return chain
          }
          return { eq() { return { gte() { return Promise.resolve({ data: [], count: alreadyToday, error: null }) } } } }
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
              return Promise.resolve({ data, error })
            },
          }
          return chain
        },
        delete() {
          ops.push({ table, type: 'delete' })
          throw new Error('delete must not be called')
        },
      }
    },
  }
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }
}

describe('stale candidate window', () => {
  test('active statuses more than 2 ET days past are candidates', () => {
    expect(STALE_DAYS).toBe(2)
    expect(STALE_NOT_NEEDED_CAP).toBe(VANISH_DAILY_MAX_RETIRES)
    expect(STALE_ACTIVE_STATUSES).toEqual(['scheduled', 'delayed', 'in_progress'])
    expect(isMoreThanDaysPast('2026-10-28', TODAY)).toBe(true)
    expect(isMoreThanDaysPast('2026-10-29', TODAY)).toBe(false)
    expect(isMoreThanDaysPast('2026-10-31', TODAY)).toBe(false)
    expect(classifyStaleCandidate(row('ATH_at_TEX_2026-10-28'), { todayEt: TODAY }))
      .toMatchObject({ candidate: true, date: '2026-10-28' })
    expect(classifyStaleCandidate(row('ATH_at_TEX_2026-10-29'), { todayEt: TODAY }).candidate)
      .toBe(false)
    expect(classifyStaleCandidate(row('ATH_at_TEX_2026-10-28', { status: 'final' }), { todayEt: TODAY }))
      .toMatchObject({ candidate: false, reason: 'not_active_status' })
  })
})

describe('resolveStaleSource', () => {
  test('maps ESPN final / postponed / 404 / cancelled and reports the rest', () => {
    expect(resolveStaleSource({
      state: 'ok',
      status: { type: { name: 'STATUS_FINAL', completed: true } },
      homeScore: '3',
      awayScore: '0',
    })).toMatchObject({
      action: 'set_final',
      status: 'final',
      homeScore: 3,
      awayScore: 0,
    })
    expect(resolveStaleSource({
      state: 'ok',
      status: { type: { name: 'STATUS_POSTPONED', detail: 'Postponed' } },
    })).toMatchObject({ action: 'set_postponed', status: 'postponed' })
    expect(resolveStaleSource(
      { state: 'summary_404', espnGameId: '401908001' },
      { espnGameId: '401908001' },
    )).toMatchObject({ action: 'set_not_needed', status: 'not_needed', reason: 'source_summary_404' })
    expect(resolveStaleSource({
      state: 'ok',
      status: { type: { name: 'STATUS_CANCELED', detail: 'Canceled' } },
    }, { espnGameId: 'espn-1' })).toMatchObject({
      action: 'set_not_needed',
      status: 'not_needed',
      reason: 'source_cancelled',
    })
    expect(resolveStaleSource({ state: 'missing' }))
      .toMatchObject({ action: 'report', reason: 'unresolved_not_on_scoreboard' })
    expect(resolveStaleSource({ state: 'empty_unconfirmed' }))
      .toMatchObject({ action: 'report', reason: 'empty_fetch_unconfirmed' })
    expect(resolveStaleSource({
      state: 'ok',
      status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in' } },
    })).toMatchObject({ action: 'report', reason: 'unresolved_still_active' })
    expect(resolveStaleSource({ state: 'unavailable' }))
      .toMatchObject({ action: 'report', reason: 'source_unavailable' })
  })

  test('STATUS_SUSPENDED is never not_needed or source_cancelled', () => {
    expect(resolveStaleSource({
      state: 'ok',
      status: { type: { name: 'STATUS_SUSPENDED', detail: 'Suspended' } },
    })).toMatchObject({
      action: 'set_suspended',
      status: 'suspended',
      reason: 'source_suspended',
    })
    expect(resolveStaleSource({
      state: 'ok',
      status: { type: { name: 'STATUS_SUSPENDED' } },
    }).reason).not.toBe('source_cancelled')
  })
})

describe('planStaleStatusSweep', () => {
  test('writes resolved rows and only reports unresolved ones', () => {
    const plan = planStaleStatusSweep({
      nowEt: TODAY,
      dbRows: [
        row('ATH_at_TEX_2026-10-26'),
        row('CHW_at_HOU_2026-10-26', { status: 'in_progress' }),
        row('NYY_at_BOS_2026-10-26', { status: 'delayed' }),
        row('CLE_at_TB_2026-10-30'),
      ],
      sourceById: {
        'ATH_at_TEX_2026-10-26': {
          state: 'ok',
          status: { type: { name: 'STATUS_FINAL', completed: true } },
          homeScore: 4,
          awayScore: 0,
        },
        'CHW_at_HOU_2026-10-26': { state: 'summary_404', espnGameId: 'espn-CHW' },
        'NYY_at_BOS_2026-10-26': {
          state: 'ok',
          status: { type: { name: 'STATUS_IN_PROGRESS' } },
        },
      },
    })
    expect(plan.summary.candidates).toBe(3)
    expect(plan.actions.find((a) => a.id === 'ATH_at_TEX_2026-10-26')).toMatchObject({
      action: 'set_final',
      nextStatus: 'final',
      homeScore: 4,
      awayScore: 0,
    })
    expect(plan.actions.find((a) => a.id === 'CHW_at_HOU_2026-10-26')).toMatchObject({
      action: 'set_not_needed',
      nextStatus: 'not_needed',
      reason: 'source_summary_404',
    })
    expect(plan.actions.find((a) => a.id === 'NYY_at_BOS_2026-10-26')).toMatchObject({
      action: 'report',
      reason: 'unresolved_still_active',
    })
    expect(plan.actions.find((a) => a.id === 'CLE_at_TB_2026-10-30')).toBeUndefined()
  })

  test('protected picks skip not_needed', () => {
    const plan = planStaleStatusSweep({
      nowEt: TODAY,
      dbRows: [row('ATH_at_TEX_2026-10-26', {
        dependents: {
          propValidation: 1,
          propValidationPending: 1,
          propValidationGraded: 0,
          propValidationPublished: 0,
          parlayLeg: 0,
          parlayLegPending: 0,
          playerPropCache: 0,
          odds: 0,
          edgeSnapshot: 0,
        },
      })],
      sourceById: {
        'ATH_at_TEX_2026-10-26': { state: 'summary_404', espnGameId: 'espn-1' },
      },
    })
    expect(plan.actions[0]).toMatchObject({
      action: 'report',
      reason: 'protected_has_picks',
    })
    expect(plan.summary.setNotNeeded).toBe(0)
  })

  test('40 stale rows produce at most 5 not_needed actions', () => {
    const rows = Array.from({ length: 40 }, (_, i) => (
      row(`AAA_at_B${String(i).padStart(2, '0')}_2026-10-26`)
    ))
    const sourceById = Object.fromEntries(rows.map((game) => [game.id, {
      state: 'summary_404',
      espnGameId: game.espnGameId,
    }]))
    const plan = planStaleStatusSweep({ nowEt: TODAY, dbRows: rows, sourceById })
    expect(plan.summary.candidates).toBe(40)
    expect(plan.actions.filter((a) => a.action === 'set_not_needed')).toHaveLength(5)
    expect(plan.actions.filter((a) => a.reason === 'cap_exceeded').length).toBe(35)
  })
})

describe('fetchStaleSources empty board and 404', () => {
  test('empty event list with active rows is unconfirmed and does not call summary', async () => {
    const urls = []
    const fetchImpl = async (url) => {
      urls.push(url)
      return jsonResponse({ events: [] })
    }
    const sources = await fetchStaleSources([
      row('ATH_at_TEX_2026-10-26'),
      row('CHW_at_HOU_2026-10-26'),
    ], { fetchImpl, logger: { warn() {} } })
    expect(sources['ATH_at_TEX_2026-10-26'].state).toBe('empty_unconfirmed')
    expect(sources['CHW_at_HOU_2026-10-26'].state).toBe('empty_unconfirmed')
    expect(urls.filter((url) => url.includes('/summary'))).toHaveLength(0)
    expect(urls.filter((url) => url.includes('scoreboard'))).toHaveLength(1)
  })

  test('summary 404 with espn id is the only missing→not_needed path', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('/summary')) return jsonResponse({}, 404)
      return jsonResponse({
        events: [{
          id: 'other',
          competitions: [{
            competitors: [
              { homeAway: 'home', team: { abbreviation: 'BOS' } },
              { homeAway: 'away', team: { abbreviation: 'NYY' } },
            ],
            status: { type: { name: 'STATUS_FINAL', completed: true } },
          }],
        }],
      })
    }
    const withId = row('ATH_at_TEX_2026-10-26', { espnGameId: '401908001' })
    const noId = row('CHW_at_HOU_2026-10-26', { espnGameId: null })
    const sources = await fetchStaleSources([withId, noId], { fetchImpl, logger: { warn() {} } })
    expect(sources[withId.id]).toMatchObject({ state: 'summary_404', espnGameId: '401908001' })
    expect(sources[noId.id].state).toBe('not_on_scoreboard')
    expect(resolveStaleSource(sources[withId.id], withId).action).toBe('set_not_needed')
    expect(resolveStaleSource(sources[noId.id], noId).action).toBe('report')
  })

  test('caches scoreboard and summary URLs per run', async () => {
    let scoreboardCalls = 0
    let summaryCalls = 0
    const fetchImpl = async (url) => {
      if (url.includes('/summary')) {
        summaryCalls += 1
        return jsonResponse({}, 404)
      }
      scoreboardCalls += 1
      return jsonResponse({
        events: [{
          id: 'other',
          competitions: [{
            competitors: [
              { homeAway: 'home', team: { abbreviation: 'BOS' } },
              { homeAway: 'away', team: { abbreviation: 'NYY' } },
            ],
          }],
        }],
      })
    }
    const rows = [
      row('ATH_at_TEX_2026-10-26', { espnGameId: 'id-a' }),
      row('CHW_at_HOU_2026-10-26', { espnGameId: 'id-a' }),
    ]
    await fetchStaleSources(rows, { fetchImpl, logger: { warn() {} } })
    expect(scoreboardCalls).toBe(1)
    expect(summaryCalls).toBe(1)
  })
})

describe('apply path', () => {
  test('dry-run writes nothing; apply updates status and never deletes', async () => {
    const supabase = createApplySupabase({ data: [{ id: 'ATH_at_TEX_2026-10-26' }] })
    const dry = await runStaleStatusSweep({
      apply: false,
      now: NOW_ET_APPLY,
      supabase,
      dbRows: [row('ATH_at_TEX_2026-10-26')],
      sourceById: {
        'ATH_at_TEX_2026-10-26': {
          state: 'ok',
          status: { type: { name: 'STATUS_FINAL', completed: true } },
          homeScore: 2,
          awayScore: 0,
        },
      },
      logger: { log() {}, warn() {}, error() {} },
    })
    expect(dry.dryRun).toBe(true)
    expect(supabase.ops).toEqual([])

    const apply = await applyStaleStatusPlan(supabase, dry, { now: NOW_ET_APPLY, logger: { warn() {}, error() {} } })
    expect(apply.applied).toEqual([{ id: 'ATH_at_TEX_2026-10-26', status: 'final' }])
    expect(supabase.ops[0].payload).toMatchObject({
      status: 'final',
      homeScore: 2,
      awayScore: 0,
    })
    expect(supabase.ops.some((op) => op.type === 'delete')).toBe(false)
    expect(() => supabase.from('Game').delete()).toThrow(/delete must not/)
  })

  test('quiet window refuses --apply-stale', async () => {
    const supabase = createApplySupabase()
    const plan = planStaleStatusSweep({
      nowEt: TODAY,
      dbRows: [row('ATH_at_TEX_2026-10-26')],
      sourceById: {
        'ATH_at_TEX_2026-10-26': { state: 'summary_404', espnGameId: 'espn-1' },
      },
    })
    const result = await applyStaleStatusPlan(supabase, plan, {
      now: NOW_ET_QUIET,
      logger: { warn() {}, error() {} },
    })
    expect(result.refused).toBe(true)
    expect(result.reason).toBe('ops_quiet_period')
    expect(supabase.ops).toEqual([])
  })

  test('40 stale rows produce at most 5 writes', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => (
      row(`AAA_at_B${String(i).padStart(2, '0')}_2026-10-26`)
    ))
    const sourceById = Object.fromEntries(rows.map((game) => [game.id, {
      state: 'summary_404',
      espnGameId: game.espnGameId,
    }]))
    const plan = planStaleStatusSweep({ nowEt: TODAY, dbRows: rows, sourceById })
    const uncapped = {
      ...plan,
      actions: rows.map((game) => ({
        id: game.id,
        sport: 'mlb',
        status: 'scheduled',
        priorStatus: 'scheduled',
        date: '2026-10-26',
        action: 'set_not_needed',
        reason: 'source_summary_404',
        nextStatus: 'not_needed',
        dependents: game.dependents,
        espnGameId: game.espnGameId,
      })),
    }
    const supabase = createApplySupabase({ data: [{ id: 'x' }], alreadyToday: 0 })
    const result = await applyStaleStatusPlan(supabase, uncapped, {
      now: NOW_ET_APPLY,
      alreadyToday: 0,
      logger: { warn() {}, error() {} },
    })
    expect(result.applied).toHaveLength(5)
    expect(supabase.ops.filter((op) => op.type === 'update')).toHaveLength(5)
    expect(result.skipped.filter((item) => item.reason === 'daily_cap_exceeded').length).toBe(35)
  })
})

describe('fetch-fresh-games stale hook', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/fetch-fresh-games.js'), 'utf8')

  test('default path runs a dry-run sweep; apply is opt-in', () => {
    expect(STALE_APPLY_FLAG).toBe('--apply-stale')
    expect(src).toMatch(/sweepStaleAfterFetch/)
    expect(src).toMatch(/runStaleStatusSweep/)
    expect(src).toMatch(/--apply-stale/)
    expect(src).toMatch(/applyStale/)
    expect(src).toMatch(/TOTAL SAVED[\s\S]*sweepStaleAfterFetch/)
    expect(readFileSync(join(process.cwd(), 'lib/stale-game-status.js'), 'utf8')).not.toMatch(/\.delete\s*\(/)
    expect(existsSync(join(process.cwd(), 'operations/fetch-fresh-games.js'))).toBe(false)
  })
})
