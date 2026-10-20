import {
  evaluateTeamStatsForEdge,
  isTeamSeasonStatsFrozen,
  mergeStatsDataThrough,
  parseStoredUtcInstantMs,
} from '../../lib/team-performance-stats.js'
import {
  countTeamSeasonFinals,
  fetchAndUpdateTeam,
  gamesPlayedAgreesWithDbFinals,
  loadLatestFinalGameDate,
} from '../../lib/team-performance-fetch.js'

const NOW = new Date('2026-10-16T12:25:00.000Z')

function gameQuery(rows, calls, { count = rows.length } = {}) {
  const q = {
    select() { return q },
    eq(col, val) { calls.push(['eq', col, val]); return q },
    or(expr) { calls.push(['or', expr]); return q },
    in(col, vals) { calls.push(['in', col, vals]); return q },
    lte(col, val) { calls.push(['lte', col, val]); return q },
    order() { return q },
    async limit() { return { data: rows, error: null, count } },
    then(resolve, reject) {
      return Promise.resolve({ data: rows, error: null, count }).then(resolve, reject)
    },
  }
  return q
}

function supabaseWith({ games = [], finalsCount, gameThrows = false } = {}) {
  const calls = []
  const updates = []
  return {
    calls,
    updates,
    from(table) {
      if (table === 'Game') {
        if (gameThrows) throw new Error('no Game table')
        return gameQuery(games, calls, { count: finalsCount ?? games.length })
      }
      return {
        update(payload) {
          return {
            eq(col, id) {
              return {
                async select() {
                  updates.push({ id, payload })
                  return { data: [{ id }], error: null }
                },
              }
            },
          }
        },
      }
    },
  }
}

const ESPN_TB = {
  team: {
    record: {
      items: [{
        type: 'total',
        summary: '98-64',
        stats: [
          { name: 'avgPointsFor', value: 4.54 },
          { name: 'avgPointsAgainst', value: 4.01 },
          { name: 'gamesPlayed', value: 162 },
        ],
      }],
    },
    previousEvent: { date: '2026-10-08T00:00Z', competitions: [{ status: { type: { completed: true } } }] },
  },
}

describe('parseStoredUtcInstantMs', () => {
  test('zone-less Game.date is treated as UTC', () => {
    expect(parseStoredUtcInstantMs('2026-10-17T00:00:00')).toBe(Date.parse('2026-10-17T00:00:00Z'))
    expect(parseStoredUtcInstantMs('2026-10-17T00:00:00+00:00')).toBe(Date.parse('2026-10-17T00:00:00Z'))
    expect(parseStoredUtcInstantMs(null)).toBeNull()
    expect(parseStoredUtcInstantMs('nope')).toBeNull()
  })
})

describe('mergeStatsDataThrough', () => {
  test('takes the later of ESPN and DB final game', () => {
    expect(mergeStatsDataThrough('2026-10-08T00:00:00Z', '2026-10-15T17:00:00', { now: NOW }))
      .toBe('2026-10-15T17:00:00.000Z')
    expect(mergeStatsDataThrough('2026-10-12T00:00:00Z', '2026-10-10T00:00:00', { now: NOW }))
      .toBe('2026-10-12T00:00:00.000Z')
  })
  test('either side alone; null when neither', () => {
    expect(mergeStatsDataThrough(null, '2026-10-15T17:00:00', { now: NOW })).toBe('2026-10-15T17:00:00.000Z')
    expect(mergeStatsDataThrough('2026-10-08T00:00:00Z', null, { now: NOW })).toBe('2026-10-08T00:00:00.000Z')
    expect(mergeStatsDataThrough(null, null, { now: NOW })).toBeNull()
  })
  test('ignores future dates', () => {
    expect(mergeStatsDataThrough('2026-10-08T00:00:00Z', '2026-10-18T00:00:00', { now: NOW }))
      .toBe('2026-10-08T00:00:00.000Z')
  })
  test('merged postseason date clears the 7-day stale gate (TB 10/16 regression)', () => {
    const base = { abbr: 'TB', last10Record: '98-64', avgPointsLast10: 4.5, avgPointsAllowedLast10: 4.0 }
    expect(evaluateTeamStatsForEdge({ ...base, statsDataThrough: '2026-10-08T00:00:00Z' }, { sport: 'mlb', now: NOW, side: 'away' }).reason)
      .toBe('away_stale_team_stats')
    const merged = mergeStatsDataThrough('2026-10-08T00:00:00Z', '2026-10-15T17:00:00', { now: NOW })
    expect(evaluateTeamStatsForEdge({ ...base, statsDataThrough: merged }, { sport: 'mlb', now: NOW, side: 'away' }).ok).toBe(true)
  })
})

describe('loadLatestFinalGameDate', () => {
  test('queries final home/away games up to now', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-15T17:00:00' }] })
    await expect(loadLatestFinalGameDate(sb, { id: 'MLB_139', sport: 'mlb' }, { now: NOW })).resolves.toBe('2026-10-15T17:00:00')
    expect(sb.calls).toContainEqual(['eq', 'sport', 'mlb'])
    expect(sb.calls).toContainEqual(['or', 'homeId.eq.MLB_139,awayId.eq.MLB_139'])
    expect(sb.calls.find((c) => c[0] === 'in')[2]).toContain('final')
  })
  test('no sport -> no lookup (team ids are not unique across sports)', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-15T17:00:00' }] })
    await expect(loadLatestFinalGameDate(sb, { id: 'MLB_139' }, { now: NOW })).resolves.toBeNull()
    expect(sb.calls).toHaveLength(0)
  })
  test('lookup failure is non-fatal', async () => {
    await expect(loadLatestFinalGameDate(supabaseWith({ gameThrows: true }), { id: 'X' })).resolves.toBeNull()
    await expect(loadLatestFinalGameDate(null, { id: 'X' })).resolves.toBeNull()
  })
})

describe('fetchAndUpdateTeam statsDataThrough', () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ESPN_TB })
  const team = { id: 'MLB_139', abbr: 'TB', sport: 'mlb' }
  const logger = { log() {}, error() {} }

  test('advances statsDataThrough to latest final DB game', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-15T17:00:00' }] })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NOW, logger })
    expect(res.updated).toBe(true)
    expect(sb.updates[0].payload.statsDataThrough).toBe('2026-10-15T17:00:00.000Z')
  })
  test('does not invent a date when DB has no final game', async () => {
    const sb = supabaseWith({ games: [] })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NOW, logger })
    expect(res.updated).toBe(true)
    expect(sb.updates[0].payload.statsDataThrough).toBe('2026-10-08T00:00:00.000Z')
  })
})

describe('isTeamSeasonStatsFrozen', () => {
  test('full regular season by record or gamesPlayed', () => {
    expect(isTeamSeasonStatsFrozen('mlb', { record: '98-64' })).toBe(true)
    expect(isTeamSeasonStatsFrozen('mlb', { record: '80-60' })).toBe(false)
    expect(isTeamSeasonStatsFrozen('mlb', { gamesPlayed: 162 })).toBe(true)
    expect(isTeamSeasonStatsFrozen('nhl', { record: '50-25-7' })).toBe(true)
    expect(isTeamSeasonStatsFrozen('nhl', { record: '5-2-0' })).toBe(false)
    expect(isTeamSeasonStatsFrozen('nfl', { record: '12-5' })).toBe(true)
    expect(isTeamSeasonStatsFrozen('xyz', { record: '200-0' })).toBe(false)
  })
  test('ESPN nextEvent postseason flag', () => {
    const post = { team: { nextEvent: [{ seasonType: { type: 3, name: 'Postseason' } }] } }
    const reg = { team: { nextEvent: [{ seasonType: { type: 2, name: 'Regular Season' } }] } }
    expect(isTeamSeasonStatsFrozen('mlb', { record: '80-60', espnData: post })).toBe(true)
    expect(isTeamSeasonStatsFrozen('mlb', { record: '80-60', espnData: reg })).toBe(false)
  })
})

describe('fetchAndUpdateTeam in regular season', () => {
  test('does NOT bump statsDataThrough from DB finals mid-season', async () => {
    const midSeason = JSON.parse(JSON.stringify(ESPN_TB))
    midSeason.team.record.items[0].summary = '80-60'
    midSeason.team.record.items[0].stats = midSeason.team.record.items[0].stats.map((st) => (
      st.name === 'gamesPlayed' ? { ...st, value: 140 } : st))
    const sb = supabaseWith({ games: [{ date: '2026-10-15T17:00:00' }] })
    const res = await fetchAndUpdateTeam({ id: 'MLB_139', abbr: 'TB', sport: 'mlb' }, {
      supabase: sb, fetchImpl: async () => ({ ok: true, json: async () => midSeason }), extractedAt: NOW, logger: { log() {}, error() {} },
    })
    expect(res.updated).toBe(true)
    expect(sb.updates[0].payload.statsDataThrough).toBe('2026-10-08T00:00:00.000Z')
    expect(sb.calls).toHaveLength(0)
  })
})

const NHL_NOW = new Date('2026-10-20T16:00:00.000Z')
const ESPN_NHL_NO_SPLITS = {
  team: {
    season: { year: 2026 },
    record: {
      items: [{
        type: 'total',
        summary: '7-2',
        stats: [
          { name: 'avgPointsFor', value: 3.7777777 },
          { name: 'avgPointsAgainst', value: 2.1111112 },
          { name: 'gamesPlayed', value: 9 },
        ],
      }],
    },
  },
}

const ESPN_NFL_NO_PREV = {
  team: {
    season: { year: 2026 },
    record: {
      items: [{
        type: 'total',
        summary: '3-2',
        stats: [
          { name: 'avgPointsFor', value: 24.1 },
          { name: 'avgPointsAgainst', value: 20.4 },
          { name: 'gamesPlayed', value: 5 },
        ],
      },
      { type: 'home', summary: '2-1' },
      { type: 'road', summary: '1-1' },
      ],
    },
  },
}

describe('gamesPlayedAgreesWithDbFinals', () => {
  test('allows a slack of 2 and rejects missing counts', () => {
    expect(gamesPlayedAgreesWithDbFinals(9, 9)).toBe(true)
    expect(gamesPlayedAgreesWithDbFinals(9, 7)).toBe(true)
    expect(gamesPlayedAgreesWithDbFinals(9, 11)).toBe(true)
    expect(gamesPlayedAgreesWithDbFinals(9, 6)).toBe(false)
    expect(gamesPlayedAgreesWithDbFinals(9, 12)).toBe(false)
    expect(gamesPlayedAgreesWithDbFinals(9, null)).toBe(false)
    expect(gamesPlayedAgreesWithDbFinals(null, 9)).toBe(false)
  })
})

describe('countTeamSeasonFinals', () => {
  test('counts finals for sport + season + team', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-19T00:00:00' }], finalsCount: 9 })
    await expect(countTeamSeasonFinals(sb, { id: 'NHL_1', sport: 'nhl' }, {
      now: NHL_NOW,
      season: '2026',
    })).resolves.toBe(9)
    expect(sb.calls).toContainEqual(['eq', 'sport', 'nhl'])
    expect(sb.calls).toContainEqual(['eq', 'season', '2026'])
  })
  test('no season -> no lookup', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-19T00:00:00' }] })
    await expect(countTeamSeasonFinals(sb, { id: 'NHL_1', sport: 'nhl' }, { now: NHL_NOW })).resolves.toBeNull()
    expect(sb.calls).toHaveLength(0)
  })
})

describe('fetchAndUpdateTeam NHL without previousEvent', () => {
  const team = { id: 'NHL_1', abbr: 'BOS', sport: 'nhl', season: '2026' }
  const logger = { log() {}, error() {} }
  const fetchImpl = async () => ({ ok: true, json: async () => ESPN_NHL_NO_SPLITS })

  test('in-season: derives statsDataThrough when DB finals agree with gamesPlayed', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-19T00:00:00' }], finalsCount: 9 })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.updated).toBe(true)
    expect(res.plan.partial).toBe(false)
    expect(res.plan.freshnessTimestampsWritten).toBe(true)
    expect(sb.updates[0].payload.statsCapturedAt).toBe(NHL_NOW.toISOString())
    expect(sb.updates[0].payload.statsDataThrough).toBe('2026-10-19T00:00:00.000Z')
    expect(sb.updates[0].payload).not.toHaveProperty('homeRecord')
    expect(sb.calls).toContainEqual(['eq', 'sport', 'nhl'])
    expect(sb.calls).toContainEqual(['eq', 'season', '2026'])
    expect(sb.calls).toContainEqual(['or', 'homeId.eq.NHL_1,awayId.eq.NHL_1'])
  })

  test('in-season: mismatch vs DB finals withholds timestamps (partial)', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-19T00:00:00' }], finalsCount: 2 })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.updated).toBe(true)
    expect(res.plan.partial).toBe(true)
    expect(res.plan.freshnessTimestampsWritten).toBe(false)
    expect(sb.updates[0].payload.last10Record).toBe('7-2')
    expect(sb.updates[0].payload).not.toHaveProperty('statsCapturedAt')
    expect(sb.updates[0].payload).not.toHaveProperty('statsDataThrough')
  })

  test('in-season: does not invent statsDataThrough when DB has no final', async () => {
    const sb = supabaseWith({ games: [], finalsCount: 0 })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.updated).toBe(true)
    expect(res.plan.partial).toBe(true)
    expect(sb.updates[0].payload).not.toHaveProperty('statsCapturedAt')
    expect(sb.updates[0].payload).not.toHaveProperty('statsDataThrough')
  })
})

describe('fetchAndUpdateTeam NFL without previousEvent', () => {
  const team = { id: 'NFL_1', abbr: 'KC', sport: 'nfl', season: '2026' }
  const logger = { log() {}, error() {} }
  const fetchImpl = async () => ({ ok: true, json: async () => ESPN_NFL_NO_PREV })

  test('uses DB finals date when gamesPlayed agrees', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-13T00:20:00' }], finalsCount: 5 })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.updated).toBe(true)
    expect(res.plan.partial).toBe(false)
    expect(sb.updates[0].payload.statsDataThrough).toBe('2026-10-13T00:20:00.000Z')
    expect(sb.calls).toContainEqual(['eq', 'sport', 'nfl'])
    expect(sb.calls).toContainEqual(['eq', 'season', '2026'])
  })

  test('treats a stale ESPN gamesPlayed vs few DB finals as partial', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-09-08T00:20:00' }], finalsCount: 1 })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.plan.partial).toBe(true)
    expect(sb.updates[0].payload).not.toHaveProperty('statsCapturedAt')
    expect(sb.updates[0].payload).not.toHaveProperty('statsDataThrough')
  })
})
