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
  looksUnplayedIfNecessary,
  normalizeStatus,
  parseRepairStuckMlbArgs,
  parseStoredGameDate,
  refreshGameScores,
} from '../../lib/score-updater.js'
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
  const calls = { in: [], eq: [], gte: [], lte: [], lt: [], order: [] }
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn((...a) => { calls.eq.push(a); return chain }),
    in: jest.fn((...a) => { calls.in.push(a); return chain }),
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
          eq: async (col, id) => {
            writes.push({ data, id })
            return { error: null }
          },
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

  test('script uses the helper before the dated-before-yesterday final shortcut', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/validate-pending-props.js'), 'utf8')
    expect(src).toMatch(/shouldSkipPlayerStatValidation/)
    expect(src.indexOf('shouldSkipPlayerStatValidation')).toBeLessThan(src.indexOf('gameDate < yesterday'))
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
})

describe('normalizeStatus keeps MLB pre-start aliases', () => {
  test('maps STATUS_ prefixes and hyphen variants', () => {
    expect(normalizeStatus('STATUS_PRE_GAME')).toBe('pre_game')
    expect(normalizeStatus('pre-game')).toBe('pre-game')
    expect(normalizeStatus('warmup')).toBe('warmup')
    expect(normalizeStatus('delayed')).toBe('delayed')
  })
})
