import {
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

function createSupabase({ teamsBySport }) {
  const updates = []
  return {
    updates,
    from(table) {
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
            async eq(column, id) {
              updates.push({ id, payload })
              return { error: null }
            },
          }
        },
      }
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
    expect(supabase.updates.some((row) => row.id === 'NHL_1')).toBe(false)
    expect(supabase.updates.some((row) => row.id === 'MLB_147')).toBe(true)
    expect(supabase.updates.find((row) => row.id === 'MLB_147').payload.last10Record).toBe('91-71')
    expect(supabase.updates.find((row) => row.id === 'MLB_147').payload.avgPointsLast10).not.toBe(0)
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
