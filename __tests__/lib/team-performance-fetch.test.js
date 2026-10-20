import {
  fetchAndUpdateTeam,
  fetchTeamPerformanceForSports,
  planTeamPerformanceWrite,
} from '../../lib/team-performance-fetch.js'
import {
  extractEspnTeamPerformance,
} from '../../lib/team-performance-stats.js'

const GOOD_EXISTING = {
  id: 'NHL_1',
  abbr: 'BOS',
  sport: 'nhl',
  last10Record: '28-12-5',
  homeRecord: '16-5-2',
  awayRecord: '12-7-3',
  avgPointsLast10: 3.4,
  avgPointsAllowedLast10: 2.7,
  statsCapturedAt: '2025-12-12T00:00:00.000Z',
}

function createSupabase({ teamsBySport, games = [], updateRows } = {}) {
  const updates = []
  const gameCalls = []
  return {
    updates,
    gameCalls,
    from(table) {
      if (table === 'Game') {
        const q = {
          select() { return q },
          eq(col, val) { gameCalls.push(['eq', col, val]); return q },
          or(expr) { gameCalls.push(['or', expr]); return q },
          in(col, vals) { gameCalls.push(['in', col, vals]); return q },
          lte(col, val) { gameCalls.push(['lte', col, val]); return q },
          order() { return q },
          async limit() { return { data: games, error: null } },
        }
        return q
      }
      if (table !== 'Team') throw new Error(`unexpected table ${table}`)
      return {
        select() {
          return {
            eq(column, value) {
              return {
                async order() {
                  return { data: teamsBySport[value] || [], error: null }
                },
              }
            },
          }
        },
        update(payload) {
          return {
            eq(column, id) {
              return {
                async select() {
                  const known = Object.values(teamsBySport || {}).flat()
                  const matched = typeof updateRows === 'function'
                    ? updateRows(id, payload)
                    : known.filter((team) => team.id === id).map((team) => ({ id: team.id }))
                  if (matched.length > 0) updates.push({ id, payload })
                  return { data: matched, error: null }
                },
              }
            },
          }
        },
      }
    },
  }
}

function nhlEspnTeamWithoutSplits() {
  return {
    team: {
      record: {
        items: [
          {
            type: 'total',
            summary: '7-2',
            stats: [
              { name: 'avgPointsFor', value: '3.7777777' },
              { name: 'avgPointsAgainst', value: '2.1111112' },
              { name: 'gamesPlayed', value: '9' },
            ],
          },
        ],
      },
    },
  }
}

describe('planTeamPerformanceWrite', () => {
  test('failed or empty extract does not produce a write payload', () => {
    expect(planTeamPerformanceWrite(null).shouldWrite).toBe(false)
    expect(planTeamPerformanceWrite(null).payload).toEqual({})

    const zeros = extractEspnTeamPerformance({
      team: {
        record: {
          items: [
            { type: 'total', summary: '0-0-0', stats: [{ name: 'avgPointsFor', value: '0' }] },
          ],
        },
      },
    }, 'nhl')
    expect(planTeamPerformanceWrite(zeros).shouldWrite).toBe(false)
    expect(planTeamPerformanceWrite(zeros).payload).toEqual({})
  })

  test('NHL payload without splits is a timestamped write, not a partial', () => {
    const extracted = extractEspnTeamPerformance(
      nhlEspnTeamWithoutSplits(),
      'nhl',
      { extractedAt: new Date('2026-10-20T16:00:00.000Z') },
    )
    const plan = planTeamPerformanceWrite(extracted)
    expect(plan.shouldWrite).toBe(true)
    expect(plan.partial).toBe(false)
    expect(plan.freshnessTimestampsWritten).toBe(true)
    expect(plan.payload.statsCapturedAt).toBe('2026-10-20T16:00:00.000Z')
    expect(plan.payload).not.toHaveProperty('homeRecord')
    expect(plan.payload).not.toHaveProperty('statsDataThrough')
  })

  test('record-only extract is a partial write (no timestamps)', () => {
    const extracted = extractEspnTeamPerformance({
      team: { record: { items: [{ type: 'total', summary: '8-3' }] } },
    }, 'nhl')
    const plan = planTeamPerformanceWrite(extracted)
    expect(plan.shouldWrite).toBe(true)
    expect(plan.partial).toBe(true)
    expect(plan.freshnessTimestampsWritten).toBe(false)
    expect(plan.payload).not.toHaveProperty('statsCapturedAt')
  })
})

describe('fetchTeamPerformanceForSports', () => {
  test('a failed NHL fetch does not overwrite good values and does not abort MLB', async () => {
    const mlbTeam = {
      id: 'MLB_147',
      abbr: 'NYY',
      sport: 'mlb',
      last10Record: '90-72',
      avgPointsLast10: 5.1,
      avgPointsAllowedLast10: 4.2,
    }
    const supabase = createSupabase({
      teamsBySport: {
        nhl: [GOOD_EXISTING],
        mlb: [mlbTeam],
        nfl: [],
      },
    })

    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/hockey/nhl')) {
        throw new Error('ESPN NHL down')
      }
      return {
        ok: true,
        json: async () => ({
          team: {
            season: { year: 2025 },
            previousEvent: {
              date: '2025-12-14T21:00:00.000Z',
              status: { type: { completed: true } },
            },
            record: {
              items: [
                {
                  type: 'total',
                  summary: '91-71',
                  stats: [
                    { name: 'avgPointsFor', value: '5.2' },
                    { name: 'avgPointsAgainst', value: '4.1' },
                    { name: 'gamesPlayed', value: '162' },
                  ],
                },
                { type: 'home', summary: '48-33' },
                { type: 'road', summary: '43-38' },
              ],
            },
          },
        }),
      }
    })

    const summary = await fetchTeamPerformanceForSports({
      supabase,
      sports: ['nhl', 'mlb'],
      fetchImpl,
      delayMs: 0,
      logger: { log: jest.fn(), error: jest.fn() },
    })

    expect(summary.fatal).toBe(false)
    expect(summary.results.find((row) => row.sport === 'nhl').errors).toBeGreaterThan(0)
    expect(summary.results.find((row) => row.sport === 'mlb').updated).toBe(1)
    expect(summary.results.find((row) => row.sport === 'mlb').partial).toBe(0)
    expect(supabase.updates.some((row) => row.id === 'NHL_1')).toBe(false)
    expect(supabase.updates.some((row) => row.id === 'MLB_147')).toBe(true)
    expect(supabase.updates.find((row) => row.id === 'MLB_147').payload.last10Record).toBe('91-71')
    expect(supabase.updates.find((row) => row.id === 'MLB_147').payload.avgPointsLast10).not.toBe(0)
  })

  test('NHL without splits writes timestamps and counts as updated, not partial', async () => {
    const supabase = createSupabase({
      teamsBySport: { nhl: [GOOD_EXISTING], nfl: [], mlb: [] },
      games: [{ date: '2026-10-19T00:00:00' }],
    })
    const extractedAt = new Date('2026-10-20T16:00:00.000Z')
    const summary = await fetchTeamPerformanceForSports({
      supabase,
      sports: ['nhl'],
      fetchImpl: async () => ({ ok: true, json: async () => nhlEspnTeamWithoutSplits() }),
      extractedAt,
      delayMs: 0,
      logger: { log: jest.fn(), error: jest.fn() },
    })
    expect(summary.results[0].updated).toBe(1)
    expect(summary.results[0].partial).toBe(0)
    expect(summary.partial).toBe(0)
    expect(supabase.updates[0].payload.last10Record).toBe('7-2')
    expect(supabase.updates[0].payload.statsCapturedAt).toBe(extractedAt.toISOString())
    expect(supabase.updates[0].payload.statsDataThrough).toBe('2026-10-19T00:00:00.000Z')
    expect(supabase.updates[0].payload).not.toHaveProperty('homeRecord')
  })

  test('record-only NHL write is counted as partial, not updated', async () => {
    const logger = { log: jest.fn(), error: jest.fn() }
    const supabase = createSupabase({
      teamsBySport: { nhl: [GOOD_EXISTING], nfl: [], mlb: [] },
    })
    const summary = await fetchTeamPerformanceForSports({
      supabase,
      sports: ['nhl'],
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ team: { record: { items: [{ type: 'total', summary: '8-3' }] } } }),
      }),
      delayMs: 0,
      logger,
    })
    expect(summary.results[0].updated).toBe(0)
    expect(summary.results[0].partial).toBe(1)
    expect(summary.partial).toBe(1)
    expect(supabase.updates[0].payload.last10Record).toBe('8-3')
    expect(supabase.updates[0].payload).not.toHaveProperty('statsCapturedAt')
    expect(logger.log.mock.calls.flat().join('\n')).toMatch(/partial=1/)
  })

  test('zero-row Team update is an error, not a successful write', async () => {
    const logger = { log: jest.fn(), error: jest.fn() }
    const supabase = createSupabase({
      teamsBySport: { nhl: [GOOD_EXISTING] },
      updateRows: () => [],
    })
    const result = await fetchAndUpdateTeam(GOOD_EXISTING, {
      supabase,
      fetchImpl: async () => ({ ok: true, json: async () => nhlEspnTeamWithoutSplits() }),
      extractedAt: new Date('2026-10-20T16:00:00.000Z'),
      logger,
    })
    expect(result.updated).toBe(false)
    expect(result.reason).toBe('update_no_rows')
    expect(supabase.updates).toEqual([])
    expect(logger.error.mock.calls.flat().join('\n')).toMatch(/matched 0 rows/)
  })

  test('HTTP 500 on one team leaves that row untouched', async () => {
    const supabase = createSupabase({
      teamsBySport: { nhl: [GOOD_EXISTING], nfl: [], mlb: [] },
    })
    const summary = await fetchTeamPerformanceForSports({
      supabase,
      sports: ['nhl'],
      fetchImpl: async () => ({ ok: false, status: 500 }),
      delayMs: 0,
      logger: { log: jest.fn(), error: jest.fn() },
    })
    expect(summary.results[0].errors).toBe(1)
    expect(supabase.updates).toEqual([])
  })
})
