import { readFileSync } from 'fs'
import { join } from 'path'
import {
  applyReconcilePlan,
  canApplyReconcile,
  classifyReconcileCandidate,
  DEFAULT_MAX_RETIRES,
  ENABLE_DRIFT_DUPLICATE_RETIRE,
  formatReconcilePlanTable,
  mapEspnScoreboardEvents,
  mapStatsApiSchedule,
  parseGameIdParts,
  parseMaxPctValue,
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

const CLE_TB_DRIFT_ROW = row('CLE_at_TB_2026-10-20', {
  date: '2026-10-21T00:00:00.000Z',
  homeScore: 0,
  awayScore: 0,
  espnGameId: '401908029',
  mlbGameId: '849814',
})

const CLE_TB_DRIFT_ESPN = [{
  date: '2026-10-19',
  espnGameId: '401908028',
  awayAbbr: 'CLE',
  homeAbbr: 'TB',
  status: 'final',
}]

const CLE_TB_DRIFT_STATS = [{
  date: '2026-10-19',
  gamePk: '849815',
  awayAbbr: 'CLE',
  homeAbbr: 'TB',
  doubleHeader: 'N',
  status: 'final',
}]

const CLE_TB_DRIFT_STATUS = {
  '2026-10-19': 'ok',
  '2026-10-20': 'zero',
  '2026-10-21': 'zero',
}

function planCleTbDrift({
  extraRows = [],
  rowOverride = {},
  espnEvents = CLE_TB_DRIFT_ESPN,
  statsApiGames = CLE_TB_DRIFT_STATS,
  espnStatusByDate = CLE_TB_DRIFT_STATUS,
  statsStatusByDate = CLE_TB_DRIFT_STATUS,
  nowEt = TODAY,
  lastFetchedDate = '2026-10-21',
  fetchedDates = [TODAY, '2026-10-21'],
  caps,
  enableDriftDuplicateRetire = ENABLE_DRIFT_DUPLICATE_RETIRE,
} = {}) {
  return planReconcile({
    dbRows: [{ ...CLE_TB_DRIFT_ROW, ...rowOverride }, ...extraRows],
    espnEvents,
    statsApiGames,
    espnStatusByDate,
    statsStatusByDate,
    nowEt,
    lastFetchedDate,
    fetchedDates,
    caps,
    enableDriftDuplicateRetire,
  })
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

  test('CLE_TB_DRIFT unknown ids retire as ghost_ids_unknown', () => {
    expect(ENABLE_DRIFT_DUPLICATE_RETIRE).toBe(false)
    const plan = planCleTbDrift()
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'retire_not_needed',
      reason: 'ghost_ids_unknown',
    })
    expect(plan.summary.ghosts).toBe(1)
    expect(plan.summary.ghostIdsUnknown).toBe(1)
    expect(plan.dateSummaries.find((entry) => entry.date === '2026-10-20')).toMatchObject({
      ghostIdsUnknown: 1,
    })
  })

  test('CLE_TB matching adjacent espn id is date_drift, or date_drift_duplicate when flag on', () => {
    const matched = planCleTbDrift({ rowOverride: { espnGameId: '401908028' } })
    expect(matched.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'date_drift',
    })
    expect(matched.summary.driftDuplicates).toBe(0)

    const on = planCleTbDrift({
      rowOverride: { espnGameId: '401908028' },
      enableDriftDuplicateRetire: true,
    })
    expect(on.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'retire_not_needed',
      reason: 'date_drift_duplicate',
    })
    expect(on.summary.driftDuplicates).toBe(1)
    expect(on.dateSummaries.find((entry) => entry.date === '2026-10-20').driftDuplicates).toBe(1)
  })

  test('matching adjacent id does not retire when StatsAPI adjacent day is unavailable', () => {
    const plan = planCleTbDrift({
      rowOverride: { espnGameId: '401908028' },
      enableDriftDuplicateRetire: true,
      statsStatusByDate: { ...CLE_TB_DRIFT_STATUS, '2026-10-19': 'unavailable' },
    })
    const action = plan.actions.find((item) => item.id === 'CLE_at_TB_2026-10-20')
    expect(action?.action).not.toBe('retire_not_needed')
    expect(action).toMatchObject({
      action: 'report',
      reason: 'date_drift',
    })
  })

  test('matching adjacent id stays date_drift when only ESPN has the adjacent hit', () => {
    const plan = planCleTbDrift({
      rowOverride: { espnGameId: '401908028' },
      enableDriftDuplicateRetire: true,
      statsApiGames: [],
    })
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'date_drift',
    })
    expect(plan.actions.some((action) => action.action === 'retire_not_needed')).toBe(false)
  })

  test('row without ids plus adjacent pair hit is date_drift', () => {
    const plan = planWithSlate({
      extraRows: [row('CLE_at_TB_2026-10-20', { espnGameId: null, mlbGameId: null })],
      extraEspn: [{ date: '2026-10-21', espnGameId: 'espn-ghost', awayAbbr: 'CLE', homeAbbr: 'TB' }],
      extraStats: [{ date: '2026-10-21', gamePk: '999', awayAbbr: 'CLE', homeAbbr: 'TB' }],
    })
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'date_drift',
    })
  })

  test('unknown ids found on a non-adjacent fetched date are date_drift, not a retire', () => {
    const plan = planCleTbDrift({
      espnEvents: [{
        date: '2026-10-22',
        espnGameId: '401908029',
        awayAbbr: 'CLE',
        homeAbbr: 'TB',
        status: 'final',
      }],
      statsApiGames: [],
      espnStatusByDate: { '2026-10-20': 'zero', '2026-10-21': 'zero', '2026-10-22': 'ok' },
      statsStatusByDate: { '2026-10-20': 'zero', '2026-10-21': 'zero', '2026-10-22': 'zero' },
      lastFetchedDate: '2026-10-22',
      fetchedDates: [TODAY, '2026-10-21', '2026-10-22'],
    })
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'date_drift',
    })
    expect(plan.actions.some((action) => action.action === 'retire_not_needed')).toBe(false)
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

  test('scheduled 0-0 with both sources empty is scoreless and retires', () => {
    const plan = planReconcile({
      dbRows: [row('CLE_at_TB_2026-10-20', { homeScore: 0, awayScore: 0 })],
      espnEvents: [],
      statsApiGames: [],
      espnStatusByDate: { [TODAY]: 'empty' },
      statsStatusByDate: { [TODAY]: 'empty' },
      nowEt: TODAY,
      lastFetchedDate: TODAY,
      fetchedDates: [TODAY],
    })
    expect(classifyReconcileCandidate(
      row('CLE_at_TB_2026-10-20', { homeScore: 0, awayScore: 0 }),
      { todayEt: TODAY, lastFetchedDate: TODAY },
    )).toMatchObject({ candidate: true, date: TODAY })
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'retire_not_needed',
      reason: 'ghost',
    })
    expect(plan.summary.candidates).toBe(1)
    expect(plan.summary.hasScore).toBe(0)
  })

  test('scheduled 1-0 is has_score, reported and counted, not retired', () => {
    const plan = planReconcile({
      dbRows: [row('CLE_at_TB_2026-10-20', { homeScore: 1, awayScore: 0 })],
      espnEvents: [],
      statsApiGames: [],
      espnStatusByDate: { [TODAY]: 'empty' },
      statsStatusByDate: { [TODAY]: 'empty' },
      nowEt: TODAY,
      lastFetchedDate: TODAY,
      fetchedDates: [TODAY],
    })
    expect(classifyReconcileCandidate(
      row('CLE_at_TB_2026-10-20', { homeScore: 1, awayScore: 0 }),
      { todayEt: TODAY, lastFetchedDate: TODAY },
    )).toMatchObject({ candidate: false, reason: 'has_score' })
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'has_score',
    })
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
    expect(plan.summary.candidates).toBe(0)
    expect(plan.summary.hasScore).toBe(1)
    expect(plan.dateSummaries.find((entry) => entry.date === TODAY)).toMatchObject({
      candidates: 0,
      hasScore: 1,
      notPreStart: 0,
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

  test('unknown ids stay ghost_ids_unknown when the adjacent pair is a doubleheader', () => {
    const plan = planCleTbDrift({
      statsApiGames: [
        { date: '2026-10-19', gamePk: '849815', awayAbbr: 'CLE', homeAbbr: 'TB', doubleHeader: 'Y', status: 'final' },
        { date: '2026-10-19', gamePk: '849816', awayAbbr: 'CLE', homeAbbr: 'TB', doubleHeader: 'Y', status: 'final' },
      ],
    })
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'retire_not_needed',
      reason: 'ghost_ids_unknown',
    })
  })

  test('past-dated, live, final, postponed, or scored rows are never candidates', () => {
    const plan = planReconcile({
      dbRows: [
        row('MIL_at_LAD_2026-10-16'),
        row('CLE_at_TB_2026-10-20', { status: 'in_progress' }),
        row('NYY_at_BOS_2026-10-20', { status: 'final', homeScore: 4, awayScore: 2 }),
        row('SEA_at_HOU_2026-10-20', { status: 'postponed' }),
        row('CHC_at_CIN_2026-10-20', { homeScore: 1, awayScore: 0 }),
        row('DET_at_KC_2026-10-20', { status: 'delayed' }),
        row('TOR_at_BAL_2026-10-20', { status: 'unknown' }),
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
    expect(plan.actions.find((action) => action.id === 'CHC_at_CIN_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'has_score',
    })
    expect(plan.actions.find((action) => action.id === 'TOR_at_BAL_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'not_pre_start',
    })
    expect(plan.summary.hasScore).toBe(1)
    expect(plan.summary.notPreStart).toBe(1)
    expect(plan.dateSummaries.find((entry) => entry.date === TODAY)).toMatchObject({
      candidates: 0,
      hasScore: 1,
      notPreStart: 1,
    })
    expect(classifyReconcileCandidate(row('MIL_at_LAD_2026-10-16'), { todayEt: TODAY, lastFetchedDate: TODAY }).reason).toBe('out_of_range')
    expect(classifyReconcileCandidate(row('CLE_at_TB_2026-10-20', { status: 'in_progress' }), { todayEt: TODAY }).candidate).toBe(false)
    expect(classifyReconcileCandidate(row('CHC_at_CIN_2026-10-20', { homeScore: 1, awayScore: 0 }), { todayEt: TODAY }).reason).toBe('has_score')
    expect(classifyReconcileCandidate(row('TOR_at_BAL_2026-10-20', { status: 'unknown' }), { todayEt: TODAY }).reason).toBe('not_pre_start')
  })

  test('a row already not_needed is not_retirable_status and prints nothing', () => {
    const dead = row('CLE_at_TB_2026-10-20', {
      status: 'not_needed',
      espnGameId: '401908029',
      mlbGameId: '849814',
    })
    expect(classifyReconcileCandidate(dead, {
      todayEt: TODAY,
      lastFetchedDate: TODAY,
    })).toMatchObject({
      candidate: false,
      reason: 'not_retirable_status',
    })
    const plan = planReconcile({
      dbRows: [dead],
      espnEvents: CLE_TB_DRIFT_ESPN,
      statsApiGames: CLE_TB_DRIFT_STATS,
      espnStatusByDate: CLE_TB_DRIFT_STATUS,
      statsStatusByDate: CLE_TB_DRIFT_STATUS,
      nowEt: TODAY,
      lastFetchedDate: '2026-10-21',
      fetchedDates: [TODAY, '2026-10-21'],
    })
    expect(plan.actions.find((action) => action.id === dead.id)).toBeUndefined()
    expect(plan.actions).toEqual([])
    expect(formatReconcilePlanTable(plan.actions)).not.toMatch(/CLE_at_TB_2026-10-20/)
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

  test('CLE_TB_DRIFT with a pending ParlayLeg is protected_has_picks', () => {
    const plan = planCleTbDrift({
      rowOverride: {
        dependents: {
          propValidation: 0,
          propValidationPending: 0,
          parlayLeg: 1,
          parlayLegPending: 1,
          playerPropCache: 0,
          odds: 0,
          edgeSnapshot: 0,
        },
      },
    })
    expect(plan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20')).toMatchObject({
      action: 'report',
      reason: 'protected_has_picks',
    })
    expect(plan.summary.ghosts).toBe(0)
    expect(plan.summary.ghostIdsUnknown).toBe(0)
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

  test('6 ghost_ids_unknown rows abort with cap_exceeded and zero retires', () => {
    const pairs = [
      ['CLE', 'TB'],
      ['LAD', 'MIL'],
      ['NYY', 'BOS'],
      ['SEA', 'HOU'],
      ['CHC', 'CIN'],
      ['DET', 'KC'],
    ]
    const extraRows = []
    const espnEvents = []
    const statsApiGames = []
    pairs.forEach(([away, home], i) => {
      extraRows.push(row(`${away}_at_${home}_2026-10-20`, {
        date: '2026-10-21T00:00:00.000Z',
        espnGameId: `4019081${i}`,
        mlbGameId: `84982${i}`,
      }))
      espnEvents.push({
        date: '2026-10-19',
        espnGameId: `4019071${i}`,
        awayAbbr: away,
        homeAbbr: home,
        status: 'final',
      })
      statsApiGames.push({
        date: '2026-10-19',
        gamePk: `84971${i}`,
        awayAbbr: away,
        homeAbbr: home,
        doubleHeader: 'N',
        status: 'final',
      })
    })
    const plan = planReconcile({
      dbRows: extraRows,
      espnEvents,
      statsApiGames,
      espnStatusByDate: CLE_TB_DRIFT_STATUS,
      statsStatusByDate: CLE_TB_DRIFT_STATUS,
      nowEt: TODAY,
      lastFetchedDate: '2026-10-21',
      fetchedDates: [TODAY, '2026-10-21'],
    })
    expect(plan.aborts.some((abort) => abort.reason === 'cap_exceeded')).toBe(true)
    expect(plan.actions.filter((action) => action.action === 'retire_not_needed')).toEqual([])
    expect(plan.summary.retired).toBe(0)
    expect(plan.summary.ghosts).toBe(0)
    expect(plan.summary.ghostIdsUnknown).toBe(0)
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
    expect(parseReconcileCliArgs(['--max-pct', '30'])).toMatchObject({ maxPct: 0.3 })
    expect(parseMaxPctValue('0')).toEqual({ value: 0 })
    expect(parseMaxPctValue('100')).toEqual({ value: 1 })
    expect(parseMaxPctValue('101').error).toMatch(/0 and 100/)
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

  test('out_of_range reports under the row date bucket, not a later fetched date', () => {
    const plan = planReconcile({
      dbRows: [CLE_TB_DRIFT_ROW],
      espnEvents: CLE_TB_DRIFT_ESPN,
      statsApiGames: CLE_TB_DRIFT_STATS,
      espnStatusByDate: {
        '2026-10-21': 'zero',
        '2026-10-22': 'zero',
        '2026-10-23': 'zero',
      },
      statsStatusByDate: {
        '2026-10-21': 'zero',
        '2026-10-22': 'zero',
        '2026-10-23': 'zero',
      },
      nowEt: '2026-10-21',
      lastFetchedDate: '2026-10-23',
      fetchedDates: ['2026-10-21', '2026-10-22', '2026-10-23'],
    })
    const action = plan.actions.find((item) => item.id === 'CLE_at_TB_2026-10-20')
    expect(action).toMatchObject({
      action: 'report',
      reason: 'out_of_range',
      date: '2026-10-20',
    })
    expect(plan.summary.candidates).toBe(0)
    expect(plan.summary.outOfRange).toBe(1)
    expect(plan.dateSummaries.find((entry) => entry.date === '2026-10-20')).toMatchObject({
      outOfRange: 1,
      candidates: 0,
    })
    const later = plan.dateSummaries.find((entry) => entry.date === '2026-10-23')
    expect(later == null || (later.candidates === 0 && later.outOfRange === 0 && later.ghosts === 0)).toBe(true)
    expect(plan.dateSummaries.every((entry) => (
      !plan.actions.some((item) => item.date === entry.date) || entry.date
    ))).toBe(true)
    for (const item of plan.actions) {
      const bucket = plan.dateSummaries.find((entry) => entry.date === item.date)
      expect(bucket).toBeTruthy()
    }
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

  test('logPlan summary prints the new counter keys', async () => {
    const logs = []
    const slate = slateFillers()
    await runReconcile({
      date: TODAY,
      days: 1,
      apply: false,
      now: NOW_ET_APPLY,
      supabase: createApplySupabase(),
      dbRows: [...slate.rows, CLE_TB_DRIFT_ROW],
      espnEvents: [...slate.espnEvents, ...CLE_TB_DRIFT_ESPN],
      statsApiGames: [...slate.statsApiGames, ...CLE_TB_DRIFT_STATS],
      espnStatusByDate: { [TODAY]: 'ok', '2026-10-19': 'ok' },
      statsStatusByDate: { [TODAY]: 'ok', '2026-10-19': 'ok' },
      logger: {
        log: (...args) => logs.push(args.join(' ')),
        warn() {},
        error() {},
      },
    })
    const summary = logs.find((line) => String(line).startsWith('summary:'))
    expect(summary).toMatch(/out_of_range=/)
    expect(summary).toMatch(/date_drift=/)
    expect(summary).toMatch(/source_disagree=/)
    expect(summary).toMatch(/flip_ambiguous=/)
    expect(summary).toMatch(/flip_no_twin=/)
    expect(summary).toMatch(/doubleheader=/)
    expect(summary).toMatch(/protected=/)
    expect(summary).toMatch(/ghost_ids_unknown=/)
    expect(summary).toMatch(/drift_duplicates=/)
    expect(summary).toMatch(/aborted=/)
    const dateLine = logs.find((line) => String(line).startsWith('date '))
    expect(dateLine).toMatch(/out_of_range=/)
    expect(dateLine).toMatch(/date_drift=/)
    expect(dateLine).toMatch(/ghost_ids_unknown=/)
    expect(dateLine).toMatch(/drift_duplicates=/)
  })

  test('apply uses priorStatus for ghost_ids_unknown and date_drift_duplicate and never deletes', async () => {
    const ghostPlan = planCleTbDrift()
    const ghostSupabase = createApplySupabase({ data: [{ id: 'CLE_at_TB_2026-10-20' }] })
    const ghostResult = await applyReconcilePlan(ghostSupabase, ghostPlan, {
      now: NOW_ET_APPLY,
      logger: { warn() {}, error() {} },
    })
    expect(ghostResult.applied).toEqual([{ id: 'CLE_at_TB_2026-10-20', status: 'not_needed' }])
    expect(ghostSupabase.ops[0].filters).toEqual([
      ['id', 'CLE_at_TB_2026-10-20'],
      ['status', 'scheduled'],
    ])
    expect(ghostSupabase.ops.some((op) => op.type === 'delete')).toBe(false)

    const driftPlan = planCleTbDrift({
      rowOverride: { espnGameId: '401908028' },
      enableDriftDuplicateRetire: true,
    })
    const driftSupabase = createApplySupabase({ data: [{ id: 'CLE_at_TB_2026-10-20' }] })
    const driftResult = await applyReconcilePlan(driftSupabase, driftPlan, {
      now: NOW_ET_APPLY,
      logger: { warn() {}, error() {} },
    })
    expect(driftPlan.actions.find((action) => action.id === 'CLE_at_TB_2026-10-20').reason).toBe('date_drift_duplicate')
    expect(driftResult.applied).toEqual([{ id: 'CLE_at_TB_2026-10-20', status: 'not_needed' }])
    expect(driftSupabase.ops[0].filters).toEqual([
      ['id', 'CLE_at_TB_2026-10-20'],
      ['status', 'scheduled'],
    ])
    expect(driftSupabase.ops.some((op) => op.type === 'delete')).toBe(false)
    expect(() => driftSupabase.from('Game').delete()).toThrow(/delete must not/)
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
    expect(src).toMatch(/fetchedDates/)
    expect(src).toMatch(/\.gte\('date'/)
    expect(src).toMatch(/\.lte\('date'/)
    expect(src).toMatch(/parseMaxPctValue/)
    expect(src).toMatch(/fetchState === 'ok' \|\| games\.fetchState === 'empty'/)
    expect(src).not.toMatch(/\.eq\('homeId',\s*game\.awayId\)/)
  })

  test('optional --reconcile hook runs after upsert', () => {
    expect(src).toMatch(/--reconcile/)
    expect(src).toMatch(/maybeReconcileAfterFetch/)
    expect(src).toMatch(/runReconcile/)
    expect(src).toMatch(/TOTAL SAVED[\s\S]*maybeReconcileAfterFetch/)
  })

  test('writes Game.season from the ESPN event at ingest (no schema change)', () => {
    expect(src).toMatch(/espnEventSeasonYear/)
    expect(src).toMatch(/season:\s*espnEventSeasonYear\(event\)/)
    expect(src).toMatch(/if \(g\.season\) obj\.season = g\.season/)
  })
})
