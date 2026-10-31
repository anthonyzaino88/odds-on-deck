import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  applyStaleStatusPlan,
  classifyStaleCandidate,
  isMoreThanDaysPast,
  planStaleStatusSweep,
  resolveStaleSource,
  runStaleStatusSweep,
  STALE_ACTIVE_STATUSES,
  STALE_APPLY_FLAG,
  STALE_DAYS,
} from '../../lib/stale-game-status.js'

const TODAY = '2026-10-31'

function row(id, overrides = {}) {
  return {
    id,
    sport: 'mlb',
    date: `${id.slice(-10)}T23:10:00.000Z`,
    status: 'scheduled',
    homeScore: null,
    awayScore: null,
    espnGameId: `espn-${id}`,
    ...overrides,
  }
}

function createApplySupabase({ data = [{ id: 'x' }], error = null } = {}) {
  const ops = []
  return {
    ops,
    from(table) {
      return {
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

describe('stale candidate window', () => {
  test('active statuses more than 2 ET days past are candidates', () => {
    expect(STALE_DAYS).toBe(2)
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
  test('maps ESPN final / postponed / missing and reports the rest', () => {
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
    expect(resolveStaleSource({ state: 'missing' }))
      .toMatchObject({ action: 'set_not_needed', status: 'not_needed' })
    expect(resolveStaleSource({
      state: 'ok',
      status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in' } },
    })).toMatchObject({ action: 'report', reason: 'unresolved_still_active' })
    expect(resolveStaleSource({ state: 'unavailable' }))
      .toMatchObject({ action: 'report', reason: 'source_unavailable' })
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
        'CHW_at_HOU_2026-10-26': { state: 'missing' },
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
    })
    expect(plan.actions.find((a) => a.id === 'NYY_at_BOS_2026-10-26')).toMatchObject({
      action: 'report',
      reason: 'unresolved_still_active',
    })
    expect(plan.actions.find((a) => a.id === 'CLE_at_TB_2026-10-30')).toBeUndefined()
  })
})

describe('apply path', () => {
  test('dry-run writes nothing; apply updates status and never deletes', async () => {
    const supabase = createApplySupabase({ data: [{ id: 'ATH_at_TEX_2026-10-26' }] })
    const now = new Date('2026-10-31T16:00:00.000Z')
    const dry = await runStaleStatusSweep({
      apply: false,
      now,
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

    const apply = await applyStaleStatusPlan(supabase, dry, { now, logger: { warn() {}, error() {} } })
    expect(apply.applied).toEqual([{ id: 'ATH_at_TEX_2026-10-26', status: 'final' }])
    expect(supabase.ops[0].payload).toMatchObject({
      status: 'final',
      homeScore: 2,
      awayScore: 0,
    })
    expect(supabase.ops.some((op) => op.type === 'delete')).toBe(false)
    expect(() => supabase.from('Game').delete()).toThrow(/delete must not/)
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
