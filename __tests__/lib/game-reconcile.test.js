import { readFileSync } from 'fs'
import { join } from 'path'
import {
  applyReconcilePlan,
  canApplyReconcile,
  classifyReconcileCandidate,
  DEFAULT_MAX_RETIRES,
  formatReconcilePlanTable,
  mapEspnScoreboardEvents,
  mapStatsApiSchedule,
  parseGameIdParts,
  parseReconcileCliArgs,
  planReconcile,
  shouldAbortReconcileSources,
  RECONCILE_CLI_USAGE,
  runReconcile,
  runReconcileCli,
  unorderedPairKey,
} from '../../lib/game-reconcile.js'

const TODAY = '2026-10-20'
const NOW_ET_APPLY = new Date('2026-10-20T15:30:00.000Z') // 11:30 AM EDT
const NOW_ET_QUIET = new Date('2026-10-20T15:07:00.000Z') // 11:07 AM EDT

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
      parlayLeg: 0,
      parlayLegPending: 0,
      playerPropCache: 0,
      odds: 0,
      edgeSnapshot: 0,
    },
    ...overrides,
  }
}

/** Real games present in both feeds so a date is not "zero events". */
function slateFillers(date = TODAY) {
  const ids = [
    `LAD_at_MIL_${date}`,
    `NYY_at_BOS_${date}`,
    `SEA_at_HOU_${date}`,
  ]
  const rows = ids.map((id) => row(id))
  const espnEvents = rows.map((game) => {
    const parts = parseGameIdParts(game.id)
    return {
      date,
      espnGameId: game.espnGameId,
      awayAbbr: parts.awayAbbr,
      homeAbbr: parts.homeAbbr,
    }
  })
  const statsApiGames = rows.map((game, i) => {
    const parts = parseGameIdParts(game.id)
    return {
      date,
      gamePk: String(800 + i),
      awayAbbr: parts.awayAbbr,
      homeAbbr: parts.homeAbbr,
      doubleHeader: 'N',
    }
  })
  return { rows, espnEvents, statsApiGames }
}

function planWithSlate({ extraRows = [], extraEspn = [], extraStats = [], caps, espnStatusByDate, statsStatusByDate } = {}) {
  const slate = slateFillers()
  return planReconcile({
    dbRows: [...slate.rows, ...extraRows],
    espnEvents: [...slate.espnEvents, ...extraEspn],
    statsApiGames: [...slate.statsApiGames, ...extraStats],
    espnStatusByDate: espnStatusByDate || { [TODAY]: 'ok' },
    statsStatusByDate: statsStatusByDate || { [TODAY]: 'ok' },
    nowEt: TODAY,
    lastFetchedDate: TODAY,
    fetchedDates: [TODAY],
    caps,
  })
}

function memoryStream() {
  const chunks = []
  return {
    write(s) {
      chunks.push(String(s))
      return true
    },
    toString() {
      return chunks.join('')
    },
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

describe('game id / pair helpers', () => {
  test('ALCS fixtures parse and flip to the same unordered pair', () => {
    expect(parseGameIdParts('CLE_at_TB_2026-10-20')).toEqual({
      awayAbbr: 'CLE',
      homeAbbr: 'TB',
      date: '2026-10-20',
      suffix: null,
    })
    expect(unorderedPairKey('CLE', 'TBR')).toBe(unorderedPairKey('TB', 'CLE'))
  })
})

describe('planReconcile ghosts', () => {
  test('ghost missing from both sources is retired', () => {
    const plan = planWithSlate({
      extraRows: [row('CLE_at_TB_2026-10-20')],
    })
    const ghost = plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')
    expect(ghost).toMatchObject({
      action: 'retire_not_needed',
      reason: 'ghost',
      clearOddsApiEventId: true,
    })
    expect(plan.aborts).toEqual([])
    expect(plan.summary.ghosts).toBe(1)
  })

  test('missing from only one source is source_disagree', () => {
    const espnOnly = planWithSlate({
      extraRows: [row('CLE_at_TB_2026-10-20')],
      extraEspn: [{ date: TODAY, espnGameId: 'espn-ghost', awayAbbr: 'CLE', homeAbbr: 'TB' }],
    })
    expect(espnOnly.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'source_disagree',
    })

    const statsOnly = planWithSlate({
      extraRows: [row('CLE_at_TB_2026-10-20')],
      extraStats: [{ date: TODAY, gamePk: '999', awayAbbr: 'CLE', homeAbbr: 'TB', doubleHeader: 'N' }],
    })
    expect(statsOnly.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'source_disagree',
    })
    expect(espnOnly.actions.some((action) => action.action === 'retire_not_needed' && action.id.startsWith('CLE_'))).toBe(false)
  })

  test('same pair on an adjacent ET day is date_drift, not a retire', () => {
    const plan = planWithSlate({
      extraRows: [row('CLE_at_TB_2026-10-20')],
      extraEspn: [{ date: '2026-10-21', espnGameId: 'espn-ghost', awayAbbr: 'CLE', homeAbbr: 'TB' }],
      extraStats: [{ date: '2026-10-21', gamePk: '999', awayAbbr: 'CLE', homeAbbr: 'TB' }],
    })
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'date_drift',
    })
  })
})

describe('planReconcile source aborts', () => {
  test('both valid empty slates agree there are no games, so ghosts retire', () => {
    const plan = planReconcile({
      dbRows: [row('CLE_at_TB_2026-10-20')],
      espnEvents: [],
      statsApiGames: [],
      espnStatusByDate: { [TODAY]: 'empty' },
      statsStatusByDate: { [TODAY]: 'empty' },
      nowEt: TODAY,
      lastFetchedDate: TODAY,
      fetchedDates: [TODAY],
    })
    expect(shouldAbortReconcileSources('empty', 'empty')).toEqual({ abort: false, bothEmpty: true })
    expect(plan.aborts).toEqual([])
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'retire_not_needed',
      reason: 'ghost',
    })
  })

  test('unavailable, malformed, or a one-sided empty abort that date', () => {
    for (const [espn, stats] of [
      ['unavailable', 'ok'],
      ['malformed', 'ok'],
      ['empty', 'ok'],
      ['ok', 'empty'],
    ]) {
      const plan = planReconcile({
        dbRows: [row('CLE_at_TB_2026-10-20')],
        espnEvents: espn === 'ok' ? [{ date: TODAY, awayAbbr: 'LAD', homeAbbr: 'MIL' }] : [],
        statsApiGames: stats === 'ok' ? [{ date: TODAY, gamePk: '1', awayAbbr: 'LAD', homeAbbr: 'MIL' }] : [],
        espnStatusByDate: { [TODAY]: espn },
        statsStatusByDate: { [TODAY]: stats },
        nowEt: TODAY,
        lastFetchedDate: TODAY,
        fetchedDates: [TODAY],
        caps: { maxRetires: 50, maxPct: 1 },
      })
      expect(plan.aborts[0]).toMatchObject({
        date: TODAY,
        reason: 'reconcile_source_unavailable',
      })
      expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
    }
  })

  test('null source arrays abort as unavailable', () => {
    const plan = planReconcile({
      dbRows: [row('CLE_at_TB_2026-10-20')],
      espnEvents: null,
      statsApiGames: [{ date: TODAY, gamePk: '1', awayAbbr: 'LAD', homeAbbr: 'MIL' }],
      nowEt: TODAY,
      lastFetchedDate: TODAY,
      fetchedDates: [TODAY],
      caps: { maxRetires: 50, maxPct: 1 },
    })
    expect(plan.aborts[0].reason).toBe('reconcile_source_unavailable')
    expect(plan.aborts[0].source).toBe('espn')
  })

  test('map helpers mark missing collections as malformed', () => {
    expect(mapEspnScoreboardEvents({}, TODAY).state).toBe('malformed')
    expect(mapStatsApiSchedule({ dates: null }, TODAY).state).toBe('malformed')
    expect(mapEspnScoreboardEvents({ events: [] }, TODAY).state).toBe('empty')
    expect(mapStatsApiSchedule({ dates: [] }, TODAY).state).toBe('empty')
  })
})

describe('planReconcile flips', () => {
  test('both orientations present, feeds say TB@CLE, retire CLE_at_TB only', () => {
    const plan = planWithSlate({
      extraRows: [
        row('TB_at_CLE_2026-10-20'),
        row('CLE_at_TB_2026-10-20'),
      ],
      extraEspn: [{ date: TODAY, espnGameId: 'alcs', awayAbbr: 'TB', homeAbbr: 'CLE' }],
      extraStats: [{ date: TODAY, gamePk: '123', awayAbbr: 'TB', homeAbbr: 'CLE', doubleHeader: 'N' }],
    })
    const retired = plan.actions.filter((action) => action.action === 'retire_not_needed')
    expect(retired).toHaveLength(1)
    expect(retired[0]).toMatchObject({
      id: 'CLE_at_TB_2026-10-20',
      reason: 'flipped_duplicate',
    })
    expect(plan.actions.find((action) => action.id === 'TB_at_CLE_2026-10-20')).toBeUndefined()
    expect(plan.summary.flips).toBe(1)
  })

  test('wrong-orientation row is flipped_duplicate when the keep row is final or in_progress', () => {
    for (const siblingStatus of ['final', 'in_progress']) {
      const plan = planWithSlate({
        extraRows: [
          row('TB_at_CLE_2026-10-20', {
            status: siblingStatus,
            homeScore: siblingStatus === 'final' ? 3 : 1,
            awayScore: siblingStatus === 'final' ? 1 : 0,
          }),
          row('CLE_at_TB_2026-10-20'),
        ],
        extraEspn: [{ date: TODAY, espnGameId: 'alcs', awayAbbr: 'TB', homeAbbr: 'CLE' }],
        extraStats: [{ date: TODAY, gamePk: '123', awayAbbr: 'TB', homeAbbr: 'CLE', doubleHeader: 'N' }],
      })
      expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
        action: 'retire_not_needed',
        reason: 'flipped_duplicate',
      })
      expect(plan.actions.find((action) => action.id === 'TB_at_CLE_2026-10-20')).toBeUndefined()
    }
  })

  test('wrong-orientation row with no vendor id and no twin is flip_no_twin, not a ghost', () => {
    const plan = planWithSlate({
      extraRows: [row('CLE_at_TB_2026-10-20', { espnGameId: null, mlbGameId: null })],
      extraEspn: [{ date: TODAY, espnGameId: 'alcs', awayAbbr: 'TB', homeAbbr: 'CLE' }],
      extraStats: [{ date: TODAY, gamePk: '123', awayAbbr: 'TB', homeAbbr: 'CLE', doubleHeader: 'N' }],
    })
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'flip_no_twin',
    })
    expect(plan.actions.some((action) => action.action === 'retire_not_needed' && action.id === 'CLE_at_TB_2026-10-20')).toBe(false)
  })

  test('feeds disagree on home/away → flip_ambiguous, no retire', () => {
    const plan = planWithSlate({
      extraRows: [
        row('TB_at_CLE_2026-10-20'),
        row('CLE_at_TB_2026-10-20'),
      ],
      extraEspn: [{ date: TODAY, espnGameId: 'alcs', awayAbbr: 'TB', homeAbbr: 'CLE' }],
      extraStats: [{ date: TODAY, gamePk: '123', awayAbbr: 'CLE', homeAbbr: 'TB', doubleHeader: 'N' }],
    })
    const reports = plan.actions.filter((action) => action.reason === 'flip_ambiguous')
    expect(reports).toHaveLength(2)
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
  })
})

describe('planReconcile doubleheaders and non-candidates', () => {
  test('doubleheader pair is never retired', () => {
    const plan = planWithSlate({
      extraRows: [
        row('TB_at_CLE_2026-10-20'),
        row('CLE_at_TB_2026-10-20'),
      ],
      extraEspn: [{ date: TODAY, espnGameId: 'alcs', awayAbbr: 'TB', homeAbbr: 'CLE' }],
      extraStats: [{ date: TODAY, gamePk: '123', awayAbbr: 'TB', homeAbbr: 'CLE', doubleHeader: 'Y' }],
    })
    expect(plan.actions.filter((action) => action.id.includes('CLE') || action.id.includes('TB')).every((action) => action.reason === 'doubleheader')).toBe(true)
    expect(plan.actions.some((action) => action.action === 'retire_not_needed')).toBe(false)
  })

  test('past-dated, live, final, postponed, or scored rows are never candidates', () => {
    const plan = planReconcile({
      dbRows: [
        row('MIL_at_LAD_2026-10-16'),
        row('CLE_at_TB_2026-10-20', { status: 'in_progress' }),
        row('NYY_at_BOS_2026-10-20', { status: 'final', homeScore: 4, awayScore: 2 }),
        row('SEA_at_HOU_2026-10-20', { status: 'postponed' }),
        row('CHC_at_CIN_2026-10-20', { homeScore: 0, awayScore: 0 }),
        row('DET_at_KC_2026-10-20', { status: 'delayed' }),
      ],
      espnEvents: [{ date: TODAY, awayAbbr: 'LAD', homeAbbr: 'MIL' }],
      statsApiGames: [{ date: TODAY, gamePk: '1', awayAbbr: 'LAD', homeAbbr: 'MIL' }],
      espnStatusByDate: { [TODAY]: 'ok' },
      statsStatusByDate: { [TODAY]: 'ok' },
      nowEt: TODAY,
      lastFetchedDate: TODAY,
      fetchedDates: [TODAY],
      caps: { maxRetires: 50, maxPct: 1 },
    })
    expect(plan.summary.candidates).toBe(0)
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
    expect(plan.actions.find((action) => action.id === 'MIL_at_LAD_2026-10-16')).toMatchObject({
      reason: 'out_of_range',
    })
    expect(classifyReconcileCandidate(row('MIL_at_LAD_2026-10-16'), { todayEt: TODAY, lastFetchedDate: TODAY }).reason).toBe('out_of_range')
    expect(classifyReconcileCandidate(row('CLE_at_TB_2026-10-20', { status: 'in_progress' }), { todayEt: TODAY }).candidate).toBe(false)
  })
})

describe('planReconcile protection and dependents', () => {
  test('pending PropValidation or ParlayLeg is protected_has_picks', () => {
    const withProp = planWithSlate({
      extraRows: [row('CLE_at_TB_2026-10-20', {
        dependents: {
          propValidation: 2,
          propValidationPending: 1,
          parlayLeg: 0,
          parlayLegPending: 0,
          playerPropCache: 0,
          odds: 0,
          edgeSnapshot: 0,
        },
      })],
    })
    expect(withProp.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'protected_has_picks',
    })

    const withParlay = planWithSlate({
      extraRows: [row('CLE_at_TB_2026-10-20', {
        dependents: {
          propValidation: 0,
          propValidationPending: 0,
          parlayLeg: 1,
          parlayLegPending: 1,
          playerPropCache: 0,
          odds: 0,
          edgeSnapshot: 0,
        },
      })],
    })
    expect(withParlay.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20').reason).toBe('protected_has_picks')
  })

  test('odds / props / edges only → retire and clear oddsApiEventId', () => {
    const plan = planWithSlate({
      extraRows: [row('CLE_at_TB_2026-10-20', {
        oddsApiEventId: 'odds-ghost',
        dependents: {
          propValidation: 0,
          propValidationPending: 0,
          parlayLeg: 0,
          parlayLegPending: 0,
          playerPropCache: 4,
          odds: 3,
          edgeSnapshot: 1,
        },
      })],
    })
    const action = plan.actions.find((item) => item.id === 'CLE_at_TB_2026-10-20')
    expect(action).toMatchObject({
      action: 'retire_not_needed',
      reason: 'ghost',
      clearOddsApiEventId: true,
    })
    expect(action.dependents).toMatchObject({
      odds: 3,
      playerPropCache: 4,
      edgeSnapshot: 1,
    })
  })
})

describe('planReconcile caps', () => {
  test('6 retires abort with no retire actions', () => {
    const extraRows = [1, 2, 3, 4, 5, 6].map((n) => row(`AAA_at_BB${n}_${TODAY}`))
    const plan = planWithSlate({ extraRows })
    expect(plan.aborts.some((abort) => abort.reason === 'cap_exceeded')).toBe(true)
    expect(plan.aborts[0].retires).toBe(6)
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
    expect(plan.summary.retired).toBe(0)
  })

  test('1 ghost out of 3 candidates is allowed (pct cap needs 5+ candidates)', () => {
    const slate = slateFillers()
    const plan = planReconcile({
      dbRows: [slate.rows[0], slate.rows[1], row('CLE_at_TB_2026-10-20')],
      espnEvents: slate.espnEvents.slice(0, 2),
      statsApiGames: slate.statsApiGames.slice(0, 2),
      espnStatusByDate: { [TODAY]: 'ok' },
      statsStatusByDate: { [TODAY]: 'ok' },
      nowEt: TODAY,
      lastFetchedDate: TODAY,
      fetchedDates: [TODAY],
    })
    expect(plan.summary.candidates).toBe(3)
    expect(plan.aborts).toEqual([])
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'retire_not_needed',
      reason: 'ghost',
    })
  })

  test('>30% aborts only when the date has 5 or more candidates', () => {
    const extraRows = [1, 2].map((n) => row(`AAA_at_BB${n}_${TODAY}`))
    const plan = planWithSlate({ extraRows })
    expect(plan.summary.candidates).toBe(5)
    expect(plan.aborts[0]).toMatchObject({ reason: 'cap_exceeded' })
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
  })

  test('--max-pct overrides the percentage cap', () => {
    const extraRows = [1, 2].map((n) => row(`AAA_at_BB${n}_${TODAY}`))
    const plan = planWithSlate({ extraRows, caps: { maxRetires: 5, maxPct: 0.5 } })
    expect(plan.summary.candidates).toBe(5)
    expect(plan.aborts).toEqual([])
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toHaveLength(2)
  })

  test('--max overrides the retire count cap', () => {
    const extraRows = [1, 2, 3, 4, 5, 6].map((n) => row(`AAA_at_BB${n}_${TODAY}`))
    const plan = planWithSlate({ extraRows, caps: { maxRetires: 6, maxPct: 1 } })
    expect(plan.aborts).toEqual([])
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toHaveLength(6)
  })
})

describe('CLI parse / help', () => {
  test('defaults are dry-run MLB with a 5-row cap', () => {
    expect(parseReconcileCliArgs([])).toMatchObject({
      sport: 'mlb',
      apply: false,
      days: 3,
      includePast: false,
      maxRetires: DEFAULT_MAX_RETIRES,
    })
    expect(parseReconcileCliArgs(['--max-pct', '50'])).toMatchObject({ maxPct: 0.5 })
    expect(parseReconcileCliArgs(['--include-past']).includePast).toBe(true)
    expect(parseReconcileCliArgs(['--sport', 'nhl']).error).toMatch(/mlb/)
    expect(parseReconcileCliArgs(['--explode']).error).toMatch(/Unknown/)
    expect(RECONCILE_CLI_USAGE).toMatch(/Dry-run is the default/)
  })

  test('runReconcileCli --help does not create a client', async () => {
    const stdout = memoryStream()
    const createClient = jest.fn()
    const { exitCode } = await runReconcileCli({
      argv: ['--help'],
      stdout,
      stderr: memoryStream(),
      createClient,
    })
    expect(exitCode).toBe(0)
    expect(stdout.toString()).toContain('Usage:')
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('include-past', () => {
  test('a past --date is out_of_range unless --include-past', () => {
    const past = row('MIL_at_LAD_2026-10-16')
    const without = planReconcile({
      dbRows: [past],
      espnEvents: [],
      statsApiGames: [],
      espnStatusByDate: { '2026-10-16': 'empty' },
      statsStatusByDate: { '2026-10-16': 'empty' },
      nowEt: TODAY,
      lastFetchedDate: '2026-10-16',
      fetchedDates: ['2026-10-16'],
      includePast: false,
    })
    expect(without.actions.find((action) => action.id === past.id)).toMatchObject({
      reason: 'out_of_range',
    })
    expect(without.summary.candidates).toBe(0)

    const withFlag = planReconcile({
      dbRows: [past],
      espnEvents: [],
      statsApiGames: [],
      espnStatusByDate: { '2026-10-16': 'empty' },
      statsStatusByDate: { '2026-10-16': 'empty' },
      nowEt: TODAY,
      lastFetchedDate: '2026-10-16',
      fetchedDates: ['2026-10-16'],
      includePast: true,
    })
    expect(withFlag.actions.find((action) => action.id === past.id)).toMatchObject({
      action: 'retire_not_needed',
      reason: 'ghost',
    })
  })
})

describe('apply path', () => {
  test('quiet window at :07 ET refuses --apply', async () => {
    expect(canApplyReconcile(NOW_ET_QUIET)).toBe(false)
    const supabase = createApplySupabase()
    const plan = planWithSlate({ extraRows: [row('CLE_at_TB_2026-10-20')] })
    const result = await applyReconcilePlan(supabase, plan, { now: NOW_ET_QUIET, logger: { warn() {}, error() {} } })
    expect(result.refused).toBe(true)
    expect(result.reason).toBe('ops_quiet_period')
    expect(supabase.ops).toEqual([])
  })

  test('zero-row update is skipped_changed_concurrently and delete is never called', async () => {
    const supabase = createApplySupabase({ data: [] })
    const plan = planWithSlate({ extraRows: [row('CLE_at_TB_2026-10-20')] })
    const result = await applyReconcilePlan(supabase, plan, { now: NOW_ET_APPLY, logger: { warn() {}, error() {} } })
    expect(result.skipped[0]).toMatchObject({
      id: 'CLE_at_TB_2026-10-20',
      reason: 'skipped_changed_concurrently',
    })
    expect(supabase.ops.every((op) => op.type === 'update')).toBe(true)
    expect(supabase.ops[0].payload).toEqual({ status: 'not_needed', oddsApiEventId: null })
    expect(supabase.ops[0].filters).toEqual([
      ['id', 'CLE_at_TB_2026-10-20'],
      ['status', 'scheduled'],
    ])
    expect(() => supabase.from('Game').delete()).toThrow(/delete must not/)
  })

  test('apply updates matching prior status and never deletes', async () => {
    const supabase = createApplySupabase({ data: [{ id: 'CLE_at_TB_2026-10-20' }] })
    const plan = planWithSlate({ extraRows: [row('CLE_at_TB_2026-10-20')] })
    const result = await applyReconcilePlan(supabase, plan, { now: NOW_ET_APPLY, logger: { warn() {}, error() {} } })
    expect(result.applied).toEqual([{ id: 'CLE_at_TB_2026-10-20', status: 'not_needed' }])
    expect(supabase.ops.some((op) => op.type === 'delete')).toBe(false)
    expect(readFileSync(join(process.cwd(), 'lib/game-reconcile.js'), 'utf8')).not.toMatch(/\.delete\s*\(/)
    expect(readFileSync(join(process.cwd(), 'scripts/reconcile-games.js'), 'utf8')).not.toMatch(/\.delete\s*\(/)
  })

  test('runReconcile dry-run does not write', async () => {
    const supabase = createApplySupabase()
    const slate = slateFillers()
    const result = await runReconcile({
      date: TODAY,
      days: 1,
      apply: false,
      now: NOW_ET_APPLY,
      supabase,
      dbRows: [...slate.rows, row('CLE_at_TB_2026-10-20')],
      espnEvents: slate.espnEvents,
      statsApiGames: slate.statsApiGames,
      espnStatusByDate: { [TODAY]: 'ok' },
      statsStatusByDate: { [TODAY]: 'ok' },
      logger: { log() {}, warn() {}, error() {} },
    })
    expect(result.dryRun).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(supabase.ops).toEqual([])
    expect(formatReconcilePlanTable(result.actions)).toMatch(/CLE_at_TB_2026-10-20/)
  })

  test('source-unavailable run exits non-zero and writes nothing', async () => {
    const supabase = createApplySupabase()
    const result = await runReconcile({
      date: TODAY,
      days: 1,
      apply: true,
      now: NOW_ET_APPLY,
      supabase,
      dbRows: [row('CLE_at_TB_2026-10-20')],
      espnEvents: [],
      statsApiGames: [],
      espnStatusByDate: { [TODAY]: 'unavailable' },
      statsStatusByDate: { [TODAY]: 'ok' },
      logger: { log() {}, warn() {}, error() {} },
    })
    expect(result.exitCode).toBe(1)
    expect(result.aborts[0].reason).toBe('reconcile_source_unavailable')
    expect(supabase.ops).toEqual([])
  })
})

describe('fetch-fresh-games reconcile hook', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/fetch-fresh-games.js'), 'utf8')

  test('possible_flip is batched and only runs with --reconcile', () => {
    expect(src).toMatch(/logPossibleFlipRows/)
    expect(src).toMatch(/if \(logPossibleFlips\)/)
    expect(src).toMatch(/possible_flip/)
    expect(src).toMatch(/fetchState === 'ok' \|\| games\.fetchState === 'empty'/)
    expect(src).not.toMatch(/\.eq\('homeId',\s*game\.awayId\)/)
  })

  test('optional --reconcile hook runs after upsert', () => {
    expect(src).toMatch(/--reconcile/)
    expect(src).toMatch(/maybeReconcileAfterFetch/)
    expect(src).toMatch(/runReconcile/)
    expect(src).toMatch(/TOTAL SAVED[\s\S]*maybeReconcileAfterFetch/)
  })
})
