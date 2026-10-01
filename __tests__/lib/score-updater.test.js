import { readFileSync } from 'fs'
import { join } from 'path'
import {
  resolveMlbLinescoreStatus,
  resolveMlbStatusForUpdate,
  MLB_RESOLVER_NON_TERMINAL_STATUSES,
  ACTIVE_GAME_STATUSES,
} from '../../lib/mlb-live-status.js'
import {
  buildScoreUpdate,
  decideMissingLiveDataUpdate,
  fetchActiveGamesForSport,
  fetchMlbResumeGames,
  isMlbResumeCandidate,
  looksUnplayedIfNecessary,
  mergeGameLists,
  normalizeStatus,
  assertRepairApplyAllowed,
  parseRepairStuckMlbArgs,
  parseStoredGameDate,
  refreshGameScores,
} from '../../lib/score-updater.js'
import { parseSupabaseDate } from '../../lib/date-utils.js'
import {
  applyRequeueQueryFilters,
  parseRequeueArgs,
  requireRequeueSource,
} from '../../lib/requeue-validations.js'
import { shouldSkipPlayerStatValidation } from '../../lib/pending-props.js'
import { shouldGradeGameLine, gradeGameLineFromScores } from '../../lib/game-lines.js'

const TERMINAL = new Set(['final', 'postponed', 'cancelled', 'canceled', 'suspended'])

const RESOLVER_PAYLOADS = [
  { status: { codedGameState: 'S', detailedState: 'Scheduled', abstractGameState: 'Preview' } },
  { status: { codedGameState: 'P', detailedState: 'Pre-Game' } },
  { status: { codedGameState: 'W', detailedState: 'Warmup' } },
  { status: { codedGameState: 'I', detailedState: 'In Progress', abstractGameState: 'Live' } },
  { status: { codedGameState: 'N', detailedState: 'In Progress', abstractGameState: 'Live' } },
  { status: { codedGameState: 'D', detailedState: 'Delayed: Rain' } },
  { status: { codedGameState: 'F', detailedState: 'Final', abstractGameState: 'Final' } },
  { status: { codedGameState: 'O', detailedState: 'Game Over', abstractGameState: 'Final' } },
  { status: { codedGameState: 'C', detailedState: 'Cancelled' } },
  { status: { codedGameState: 'U', detailedState: 'Suspended' } },
  { status: { detailedState: 'Warmup' } },
  { status: { detailedState: 'Pre-Game' } },
  { status: { detailedState: 'Pregame' } },
  { status: { detailedState: 'Scheduled' } },
  { status: { abstractGameState: 'Preview' } },
  { status: { detailedState: 'Postponed' } },
  { status: { detailedState: 'Cancelled' } },
  { status: { detailedState: 'Suspended' } },
  { status: { detailedState: 'In Progress', abstractGameState: 'Live' } },
  { status: { detailedState: 'Delayed: Rain' } },
  { status: {} },
]

function createSelectChain(result = { data: [], error: null }) {
  const calls = { in: [], eq: [], gte: [], lte: [], lt: [], not: [], order: [] }
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn((...a) => { calls.eq.push(a); return chain }),
    in: jest.fn((...a) => { calls.in.push(a); return chain }),
    not: jest.fn((...a) => { calls.not.push(a); return chain }),
    gte: jest.fn((...a) => { calls.gte.push(a); return chain }),
    lte: jest.fn((...a) => { calls.lte.push(a); return chain }),
    lt: jest.fn((...a) => { calls.lt.push(a); return chain }),
    order: jest.fn((...a) => { calls.order.push(a); return Promise.resolve(result) }),
  }
  return { chain, calls }
}

describe('ACTIVE_GAME_STATUSES covers every MLB resolver non-terminal', () => {
  test('exported resolver list is a subset of the updater query list', () => {
    for (const status of MLB_RESOLVER_NON_TERMINAL_STATUSES) {
      expect(ACTIVE_GAME_STATUSES).toContain(status)
    }
  })

  test('every non-terminal resolveMlbLinescoreStatus value is selectable', () => {
    const seen = new Set()
    for (const payload of RESOLVER_PAYLOADS) {
      seen.add(resolveMlbLinescoreStatus(payload))
    }
    const nonTerminal = [...seen].filter((status) => !TERMINAL.has(status))
    expect(nonTerminal.sort()).toEqual([...MLB_RESOLVER_NON_TERMINAL_STATUSES].sort())
    for (const status of nonTerminal) {
      expect(ACTIVE_GAME_STATUSES).toContain(status)
    }
  })

  test('every non-terminal resolveMlbStatusForUpdate passthrough is selectable', () => {
    const passthrough = ['scheduled', 'pre_game', 'warmup', 'in_progress', 'delayed']
    for (const status of passthrough) {
      expect(resolveMlbStatusForUpdate({ status }, 'scheduled')).toBe(status)
      expect(ACTIVE_GAME_STATUSES).toContain(status)
    }
    expect(resolveMlbStatusForUpdate({ status: 'unknown' }, 'pre_game')).toBe('pre_game')
    expect(ACTIVE_GAME_STATUSES).toContain('pre_game')
  })

  test('postponed/suspended MLB with a gamePk is a resume candidate for 7 days', () => {
    const now = Date.parse('2026-10-01T12:00:00.000Z')
    expect(isMlbResumeCandidate({
      status: 'postponed',
      mlbGameId: '778800',
      date: '2026-09-27T23:05:00.000Z',
    }, { now })).toBe(true)
    expect(isMlbResumeCandidate({
      status: 'suspended',
      mlbGameId: '778801',
      date: '2026-09-29T23:05:00.000Z',
    }, { now })).toBe(true)
    expect(isMlbResumeCandidate({
      status: 'postponed',
      mlbGameId: null,
      date: '2026-09-27T23:05:00.000Z',
    }, { now })).toBe(false)
    expect(isMlbResumeCandidate({
      status: 'postponed',
      mlbGameId: '778800',
      date: '2026-09-20T23:05:00.000Z',
    }, { now })).toBe(false)
  })

  test('makeup final flips a postponed row that still has the same gamePk', () => {
    const plan = buildScoreUpdate({
      game: {
        id: 'BAL_at_NYY_2026-09-27',
        status: 'postponed',
        date: '2026-09-27T23:05:00',
        mlbGameId: '778800',
        homeScore: 0,
        awayScore: 0,
      },
      liveData: { status: 'final', homeScore: 4, awayScore: 2 },
      sport: 'mlb',
      now: Date.parse('2026-09-29T23:00:00.000Z'),
    })
    expect(plan.action).toBe('update')
    expect(plan.updateData.status).toBe('final')
    expect(plan.updateData.homeScore).toBe(4)
    expect(plan.updateData.awayScore).toBe(2)
  })

  test('fetchMlbResumeGames queries postponed/suspended with a gamePk window', async () => {
    const { chain, calls } = createSelectChain({
      data: [{
        id: 'BAL_at_NYY_2026-09-27',
        status: 'postponed',
        mlbGameId: '778800',
        date: '2026-09-27T23:05:00.000Z',
      }],
      error: null,
    })
    const supabase = { from: jest.fn(() => chain) }
    const { games, error } = await fetchMlbResumeGames(supabase, {
      now: Date.parse('2026-10-01T12:00:00.000Z'),
    })
    expect(error).toBeNull()
    expect(calls.in).toContainEqual(['status', ['postponed', 'suspended']])
    expect(calls.not).toContainEqual(['mlbGameId', 'is', null])
    expect(games).toHaveLength(1)
    expect(mergeGameLists([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }])).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  test('hourly updater query uses ACTIVE_GAME_STATUSES', async () => {
    const { chain, calls } = createSelectChain({
      data: [{ id: 'g1', status: 'pre_game' }],
      error: null,
    })
    const supabase = { from: jest.fn(() => chain) }
    const { games, error } = await fetchActiveGamesForSport(supabase, 'mlb', {
      now: Date.parse('2026-10-01T12:00:00Z'),
    })
    expect(error).toBeNull()
    expect(calls.in).toContainEqual(['status', ACTIVE_GAME_STATUSES])
    expect(games).toEqual([{ id: 'g1', status: 'pre_game' }])

    const updaterSrc = readFileSync(join(process.cwd(), 'scripts/update-scores-safely.js'), 'utf8')
    expect(updaterSrc).toMatch(/fetchActiveGamesForSport/)
    expect(updaterSrc).toMatch(/fetchMlbResumeGames/)
    expect(updaterSrc).not.toMatch(/\.in\('status', \['scheduled', 'in_progress', 'in-progress'\]\)/)
  })
})

describe('pre_game / warmup rows are selected and can move to live or final', () => {
  test('buildScoreUpdate moves pre_game to in_progress', () => {
    const game = {
      id: 'NYY_at_BOS_2026-09-29',
      status: 'pre_game',
      date: '2026-09-29T17:08:00',
      homeScore: 0,
      awayScore: 0,
    }
    expect(ACTIVE_GAME_STATUSES).toContain(game.status)
    const plan = buildScoreUpdate({
      game,
      liveData: { status: 'in_progress', homeScore: 2, awayScore: 1, inning: 3 },
      sport: 'mlb',
      now: Date.parse('2026-09-29T20:00:00.000Z'),
    })
    expect(plan.updateData.status).toBe('in_progress')
    expect(plan.updateData.homeScore).toBe(2)
    expect(plan.updateData.awayScore).toBe(1)
  })

  test('refreshGameScores writes final for a warmup row with a Final payload', async () => {
    const game = {
      id: 'CLE_at_DET_2026-09-30',
      status: 'warmup',
      date: '2026-09-30T17:08:00',
      mlbGameId: '824900',
      homeScore: 0,
      awayScore: 0,
      home: { abbr: 'DET' },
      away: { abbr: 'CLE' },
    }
    expect(ACTIVE_GAME_STATUSES).toContain(game.status)

    const writes = []
    const supabase = {
      from: jest.fn(() => ({
        update: (data) => ({
          eq: (col, id) => ({
            select: async () => {
              writes.push({ data, id })
              return { error: null, data: [{ id }] }
            },
          }),
        }),
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: [] }),
          }),
        }),
      })),
    }

    const result = await refreshGameScores({
      sport: 'mlb',
      games: [game],
      supabase,
      apply: true,
      mlbLiveByPk: new Map([['824900', {
        status: 'final',
        homeScore: 6,
        awayScore: 3,
        inning: 9,
      }]]),
      now: Date.parse('2026-09-30T23:00:00.000Z'),
      delayMs: 0,
      log: () => {},
    })

    expect(result.updated).toBe(1)
    expect(writes[0].data.status).toBe('final')
    expect(writes[0].data.homeScore).toBe(6)
    expect(writes[0].data.awayScore).toBe(3)
    expect(result.changes[0].line).toMatch(/warmup → 3-6 final/)
  })
})

describe('stale unplayed if-necessary games are not graded as a push', () => {
  const ifNecessary = {
    id: 'CHW_at_HOU_2026-10-01',
    status: 'scheduled',
    date: '2026-09-30T17:08:00',
    mlbGameId: null,
    espnGameId: null,
    homeScore: 0,
    awayScore: 0,
    sport: 'mlb',
    home: { abbr: 'HOU' },
    away: { abbr: 'CHW' },
  }

  test('looksUnplayedIfNecessary detects the placeholder', () => {
    expect(looksUnplayedIfNecessary(ifNecessary)).toBe(true)
    expect(looksUnplayedIfNecessary({
      id: 'NYY_at_BOS_2026-09-29',
      mlbGameId: '824785',
      homeScore: 0,
      awayScore: 0,
    })).toBe(false)
  })

  test('stale rule marks it postponed, not final 0-0', () => {
    const now = Date.parse('2026-10-01T20:00:00.000Z')
    const plan = decideMissingLiveDataUpdate(ifNecessary, { now })
    expect(plan.updateData.status).toBe('postponed')
    expect(plan.updateData.status).not.toBe('final')

    const fromBuild = buildScoreUpdate({
      game: { ...ifNecessary, status: 'pre_game' },
      liveData: null,
      sport: 'mlb',
      now,
    })
    expect(fromBuild.updateData.status).toBe('postponed')
  })

  test('stale game with scores and no live data is marked final', () => {
    const plan = decideMissingLiveDataUpdate({
      id: 'NYY_at_BOS_2026-09-29',
      status: 'pre_game',
      date: '2026-09-29T17:08:00',
      mlbGameId: '824785',
      homeScore: 5,
      awayScore: 3,
    }, { now: Date.parse('2026-10-01T20:00:00.000Z') })
    expect(plan.action).toBe('update')
    expect(plan.updateData.status).toBe('final')
  })

  test('under-24h missing live data is left alone', () => {
    const plan = decideMissingLiveDataUpdate({
      id: 'CHW_at_HOU_2026-10-01',
      status: 'scheduled',
      date: '2026-10-01T12:00:00',
      homeScore: 0,
      awayScore: 0,
    }, { now: Date.parse('2026-10-01T20:00:00.000Z') })
    expect(plan.action).toBe('skip')
    expect(plan.updateData).toBeUndefined()
  })

  test('gradePendingGameLines gate refuses postponed and 0-0 MLB finals', () => {
    expect(shouldGradeGameLine({ ...ifNecessary, status: 'postponed' })).toBe(false)
    expect(shouldGradeGameLine({ ...ifNecessary, status: 'final' })).toBe(false)
    expect(gradeGameLineFromScores(
      { type: 'moneyline', pick: 'CHW' },
      ifNecessary,
    )).toEqual({ result: 'push', actualValue: 0 })
  })
})

describe('stored Game.date without a timezone is UTC', () => {
  test('parseStoredGameDate appends Z', () => {
    const parsed = parseStoredGameDate('2026-09-30T23:08:00')
    expect(parsed.toISOString()).toBe('2026-09-30T23:08:00.000Z')
    expect(parseStoredGameDate('2026-09-30T23:08:00.000Z').toISOString()).toBe('2026-09-30T23:08:00.000Z')
    expect(parseStoredGameDate('2026-09-30T23:08:00+00:00').toISOString()).toBe('2026-09-30T23:08:00.000Z')
  })

  test('parseSupabaseDate keeps offsets and rejects invalid input', () => {
    expect(parseSupabaseDate('2026-09-30T19:08:00-04:00').toISOString()).toBe('2026-09-30T23:08:00.000Z')
    expect(parseSupabaseDate('not-a-date')).toBeNull()
    expect(parseSupabaseDate('')).toBeNull()
    expect(parseSupabaseDate(null)).toBeNull()
  })

  test('just-started 0-0 stays in_progress instead of being held as scheduled', () => {
    const plan = buildScoreUpdate({
      game: {
        status: 'scheduled',
        date: '2026-09-30T23:08:00',
        homeScore: 0,
        awayScore: 0,
      },
      liveData: { status: 'in_progress', homeScore: 0, awayScore: 0, inning: 1 },
      sport: 'mlb',
      now: Date.parse('2026-09-30T23:20:00.000Z'),
    })
    expect(plan.updateData.status).toBe('in_progress')
  })
})

describe('validate-pending-props skips game_line rows', () => {
  test('helper skips only source=game_line', () => {
    expect(shouldSkipPlayerStatValidation({ source: 'game_line', propType: 'moneyline' })).toBe(true)
    expect(shouldSkipPlayerStatValidation({ source: 'GAME_LINE', propType: 'total' })).toBe(true)
    expect(shouldSkipPlayerStatValidation({ source: 'system_generated', propType: 'batter_hits' })).toBe(false)
    expect(shouldSkipPlayerStatValidation({ source: 'system_generated', propType: 'moneyline' })).toBe(false)
  })

  test('script plans player-stat validation instead of dating-a-game-final', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/validate-pending-props.js'), 'utf8')
    expect(src).toMatch(/planPlayerStatValidation/)
    expect(src).not.toMatch(/gameDate < yesterday/)
  })
})

describe('repair CLI args', () => {
  test('dry-run is default; --apply and --from/--to parse', () => {
    expect(parseRepairStuckMlbArgs([])).toEqual({
      apply: false,
      from: null,
      to: null,
      help: false,
    })
    expect(parseRepairStuckMlbArgs(['--from', '2026-09-25', '--to', '2026-09-30', '--apply'])).toEqual({
      apply: true,
      from: '2026-09-25',
      to: '2026-09-30',
      help: false,
    })
  })

  test('--apply refuses anon / missing write key', () => {
    expect(() => assertRepairApplyAllowed(true, {
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    })).toThrow(/SUPABASE_SECRET_KEY/)
    expect(assertRepairApplyAllowed(true, { SUPABASE_SECRET_KEY: 'secret' })).toBe('secret')
    expect(assertRepairApplyAllowed(true, { SUPABASE_SERVICE_ROLE_KEY: 'role' })).toBe('role')
    expect(assertRepairApplyAllowed(false, { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' })).toBe('anon')
  })

  test('0-row apply update is counted as an error', async () => {
    const game = {
      id: 'ARI_at_SD_2026-09-25',
      status: 'pre_game',
      date: '2026-09-26T01:40:00',
      mlbGameId: '1',
      homeScore: 0,
      awayScore: 0,
      home: { abbr: 'SD' },
      away: { abbr: 'ARI' },
    }
    const result = await refreshGameScores({
      sport: 'mlb',
      games: [game],
      supabase: {
        from: () => ({
          update: () => ({
            eq: () => ({
              select: async () => ({ error: null, data: [] }),
            }),
          }),
        }),
      },
      apply: true,
      mlbLiveByPk: new Map([['1', { status: 'final', homeScore: 4, awayScore: 11 }]]),
      now: Date.parse('2026-09-26T06:00:00.000Z'),
      delayMs: 0,
      log: () => {},
      error: () => {},
    })
    expect(result.updated).toBe(0)
    expect(result.errors).toBe(1)
  })
})

describe('requeue source filter and dry-run', () => {
  test('requires --source or SOURCE=', () => {
    expect(() => requireRequeueSource(null)).toThrow(/--source/)
    expect(() => requireRequeueSource('')).toThrow(/--source/)
    expect(requireRequeueSource('game_line')).toBe('game_line')
  })

  test('parses CLI flags and env, including --dry-run', () => {
    expect(parseRequeueArgs(['--source', 'game_line', '--sport', 'mlb', '--dry-run'])).toMatchObject({
      source: 'game_line',
      sport: 'mlb',
      dryRun: true,
      action: 'requeue',
    })
    expect(parseRequeueArgs([], { SOURCE: 'game_line', SPORT: 'mlb' })).toMatchObject({
      source: 'game_line',
      sport: 'mlb',
      dryRun: false,
    })
  })

  test('applies sport and source on the query before limit', () => {
    const order = []
    const chain = {
      in: (...a) => { order.push(['in', ...a]); return chain },
      eq: (...a) => { order.push(['eq', ...a]); return chain },
      order: (...a) => { order.push(['order', ...a]); return chain },
      limit: (...a) => { order.push(['limit', ...a]); return chain },
    }
    applyRequeueQueryFilters(chain, {
      statuses: ['needs_review'],
      sport: 'mlb',
      source: 'game_line',
      limit: 200,
    })
    expect(order).toEqual([
      ['in', 'status', ['needs_review']],
      ['eq', 'sport', 'mlb'],
      ['eq', 'source', 'game_line'],
      ['order', 'timestamp', { ascending: true }],
      ['limit', 200],
    ])
    expect(order.findIndex((step) => step[0] === 'eq' && step[1] === 'source'))
      .toBeLessThan(order.findIndex((step) => step[0] === 'limit'))
  })

  test('script dry-run path does not update PropValidation', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/requeue-or-close-validations.js'), 'utf8')
    expect(src).toMatch(/requireRequeueSource/)
    expect(src).toMatch(/applyRequeueQueryFilters/)
    expect(src).toMatch(/if \(args\.dryRun\) \{[\s\S]*would requeue[\s\S]*continue/)
  })
})

describe('normalizeStatus keeps MLB pre-start aliases', () => {
  test('maps STATUS_ prefixes and hyphen variants', () => {
    expect(normalizeStatus('STATUS_PRE_GAME')).toBe('pre_game')
    expect(normalizeStatus('pre-game')).toBe('pre-game')
    expect(normalizeStatus('warmup')).toBe('warmup')
    expect(normalizeStatus('delayed')).toBe('delayed')
  })
})
