import {
  evaluateTeamStatsForEdge,
  extractEspnSeason,
  extractEspnTeamPerformance,
  isTeamSeasonStatsFrozen,
  mergeStatsDataThrough,
  parseStoredUtcInstantMs,
} from '../../lib/team-performance-stats.js'
import {
  countTeamSeasonFinals,
  espnGamesPlayedLooksFrozen,
  fetchAndUpdateTeam,
  loadLatestFinalGameDate,
  regularSeasonStartUtc,
} from '../../lib/team-performance-fetch.js'

const NOW = new Date('2026-10-16T12:25:00.000Z')

function rowDateMs(row) {
  const raw = row?.date
  if (!raw) return null
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}T/.test(raw) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? `${raw}Z` : raw)
  return Number.isFinite(ms) ? ms : null
}

function gameQuery(rows, calls, { count } = {}) {
  const bounds = { gte: null, lte: null }
  const applyBounds = () => rows.filter((row) => {
    const ms = rowDateMs(row)
    if (ms == null) return true
    if (bounds.gte != null && ms < bounds.gte) return false
    if (bounds.lte != null && ms > bounds.lte) return false
    return true
  })
  const resolve = () => {
    const filtered = applyBounds()
    return { data: filtered, error: null, count: count ?? filtered.length }
  }
  const q = {
    select() { return q },
    eq(col, val) { calls.push(['eq', col, val]); return q },
    gte(col, val) {
      calls.push(['gte', col, val])
      if (col === 'date') bounds.gte = Date.parse(val)
      return q
    },
    or(expr) { calls.push(['or', expr]); return q },
    in(col, vals) { calls.push(['in', col, vals]); return q },
    lte(col, val) {
      calls.push(['lte', col, val])
      if (col === 'date') bounds.lte = Date.parse(val)
      return q
    },
    order() { return q },
    async limit() { return resolve() },
    then(resolveP, reject) {
      return Promise.resolve(resolve()).then(resolveP, reject)
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
        return gameQuery(games, calls, finalsCount == null ? {} : { count: finalsCount })
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
  test('queries final home/away games up to now from regular-season start', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-15T17:00:00' }] })
    await expect(loadLatestFinalGameDate(sb, { id: 'MLB_139', sport: 'mlb' }, { now: NOW })).resolves.toBe('2026-10-15T17:00:00')
    expect(sb.calls).toContainEqual(['eq', 'sport', 'mlb'])
    expect(sb.calls).toContainEqual(['gte', 'date', '2026-03-20T00:00:00.000Z'])
    expect(sb.calls).toContainEqual(['or', 'homeId.eq.MLB_139,awayId.eq.MLB_139'])
    expect(sb.calls.find((c) => c[0] === 'in')[2]).toContain('final')
    expect(sb.calls.some((c) => c[0] === 'eq' && c[1] === 'season')).toBe(false)
  })
  test('ignores preseason finals when picking latest date', async () => {
    const sb = supabaseWith({
      games: [
        { date: '2026-02-20T17:00:00', season: null },
        { date: '2026-10-15T17:00:00', season: null },
      ],
    })
    await expect(loadLatestFinalGameDate(sb, { id: 'MLB_139', sport: 'mlb' }, { now: NOW }))
      .resolves.toBe('2026-10-15T17:00:00')
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

describe('extractEspnSeason', () => {
  test('resolves 2026 from data.season / team.season, not a 2027 type-1 next event', () => {
    const data = {
      season: { year: 2026, type: 2 },
      team: {
        season: { year: 2026, type: 2 },
        nextEvent: [{ season: { year: 2027, type: 1 }, seasonType: { type: 1, name: 'Preseason' } }],
      },
    }
    expect(extractEspnSeason(data.team, data)).toBe('2026')
    expect(extractEspnTeamPerformance({
      ...data,
      team: {
        ...data.team,
        record: {
          items: [{
            type: 'total',
            summary: '94-67',
            stats: [
              { name: 'avgPointsFor', value: 5.2 },
              { name: 'avgPointsAgainst', value: 4.1 },
              { name: 'gamesPlayed', value: 161 },
            ],
          }],
        },
      },
    }, 'mlb', { extractedAt: NOW }).season).toBe('2026')
  })
  test('type-1 next event only (NYY spring training) stores year minus 1', () => {
    const team = {
      nextEvent: [{ season: { year: 2027, type: 1 }, seasonType: { type: 1, name: 'Preseason' } }],
      record: {
        items: [{
          type: 'total',
          summary: '94-67',
          stats: [
            { name: 'avgPointsFor', value: 5.2 },
            { name: 'avgPointsAgainst', value: 4.1 },
            { name: 'gamesPlayed', value: 161 },
          ],
        }],
      },
    }
    expect(extractEspnSeason(team, { team })).toBe('2026')
    expect(extractEspnTeamPerformance({ team }, 'mlb', { extractedAt: NOW }).season).toBe('2026')
    expect(extractEspnTeamPerformance({ team }, 'mlb', { extractedAt: NOW }).season).not.toBe('2027')
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
  test('a next event of type 1 (preseason / spring training) means frozen', () => {
    const pre = { team: { nextEvent: [{ season: { year: 2027, type: 1 }, seasonType: { type: 1, name: 'Preseason' } }] } }
    expect(isTeamSeasonStatsFrozen('mlb', { record: '94-67', gamesPlayed: 161, espnData: pre })).toBe(true)
    expect(isTeamSeasonStatsFrozen('mlb', { record: '94-67', gamesPlayed: 161 })).toBe(false)
  })
  test('next event season greater than the record season means frozen', () => {
    const nextYearReg = {
      team: {
        season: { year: 2026 },
        nextEvent: [{ season: { year: 2027, type: 2 }, seasonType: { type: 2, name: 'Regular Season' } }],
      },
    }
    expect(isTeamSeasonStatsFrozen('mlb', {
      record: '94-67',
      gamesPlayed: 161,
      espnData: nextYearReg,
      season: '2026',
    })).toBe(true)
  })
})

describe('fetchAndUpdateTeam in regular season', () => {
  test('early April: spring-training finals before Mar 20 do not withhold timestamps', async () => {
    const april = new Date('2026-04-05T16:00:00.000Z')
    const early = JSON.parse(JSON.stringify(ESPN_TB))
    delete early.team.previousEvent
    early.team.season = { year: 2026, type: 2 }
    early.team.nextEvent = [{ seasonType: { type: 2, name: 'Regular Season' } }]
    early.team.record.items[0].summary = '6-4'
    early.team.record.items[0].stats = early.team.record.items[0].stats.map((st) => (
      st.name === 'gamesPlayed' ? { ...st, value: 10 } : st))
    const sb = supabaseWith({
      games: [
        { date: '2026-03-05T17:00:00' },
        { date: '2026-03-08T17:00:00' },
        { date: '2026-03-12T17:00:00' },
        { date: '2026-03-18T17:00:00' },
        { date: '2026-03-20T17:00:00' },
        { date: '2026-03-22T17:00:00' },
        { date: '2026-03-24T17:00:00' },
        { date: '2026-03-26T17:00:00' },
        { date: '2026-03-28T17:00:00' },
        { date: '2026-03-30T17:00:00' },
        { date: '2026-04-01T17:00:00' },
        { date: '2026-04-02T17:00:00' },
        { date: '2026-04-03T17:00:00' },
        { date: '2026-04-04T17:00:00' },
      ],
    })
    const res = await fetchAndUpdateTeam({ id: 'MLB_139', abbr: 'TB', sport: 'mlb' }, {
      supabase: sb,
      fetchImpl: async () => ({ ok: true, json: async () => early }),
      extractedAt: april,
      logger: { log() {}, error() {} },
    })
    expect(res.updated).toBe(true)
    expect(res.plan.partial).toBe(false)
    expect(sb.updates[0].payload.statsCapturedAt).toBe(april.toISOString())
    expect(sb.calls).toContainEqual(['gte', 'date', '2026-03-20T00:00:00.000Z'])
  })

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

describe('regularSeasonStartUtc', () => {
  test('NHL Oct 1 wrapping Oct–Jun, NFL Sep 1 wrapping Sep–Feb, MLB Mar 20', () => {
    expect(regularSeasonStartUtc('nhl', NHL_NOW).toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(regularSeasonStartUtc('nhl', new Date('2027-01-15T00:00:00.000Z')).toISOString())
      .toBe('2026-10-01T00:00:00.000Z')
    expect(regularSeasonStartUtc('nfl', NHL_NOW).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(regularSeasonStartUtc('nfl', new Date('2027-02-01T00:00:00.000Z')).toISOString())
      .toBe('2026-09-01T00:00:00.000Z')
    expect(regularSeasonStartUtc('mlb', NHL_NOW).toISOString()).toBe('2026-03-20T00:00:00.000Z')
    expect(regularSeasonStartUtc('mlb', new Date('2027-01-15T00:00:00.000Z')).toISOString())
      .toBe('2026-03-20T00:00:00.000Z')
    expect(regularSeasonStartUtc('xyz', NHL_NOW)).toBeNull()
  })
})

describe('espnGamesPlayedLooksFrozen', () => {
  test('is one-way: only DB ahead of ESPN by more than 2 is frozen', () => {
    expect(espnGamesPlayedLooksFrozen(9, 9)).toBe(false)
    expect(espnGamesPlayedLooksFrozen(9, 11)).toBe(false)
    expect(espnGamesPlayedLooksFrozen(9, 12)).toBe(true)
    expect(espnGamesPlayedLooksFrozen(9, 0)).toBe(false)
    expect(espnGamesPlayedLooksFrozen(9, 2)).toBe(false)
    expect(espnGamesPlayedLooksFrozen(9, null)).toBe(false)
    expect(espnGamesPlayedLooksFrozen(null, 12)).toBe(false)
  })
  test('in-season slack is unchanged: DB ahead by 2 is fine, by 3 withholds', () => {
    expect(espnGamesPlayedLooksFrozen(161, 163)).toBe(false)
    expect(espnGamesPlayedLooksFrozen(161, 164)).toBe(true)
    expect(espnGamesPlayedLooksFrozen(10, 12)).toBe(false)
    expect(espnGamesPlayedLooksFrozen(10, 13)).toBe(true)
  })
})

describe('countTeamSeasonFinals', () => {
  test('counts finals on or after the regular-season start, with no season eq', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-19T00:00:00' }], finalsCount: 9 })
    await expect(countTeamSeasonFinals(sb, { id: 'NHL_1', sport: 'nhl' }, {
      now: NHL_NOW,
    })).resolves.toBe(9)
    expect(sb.calls).toContainEqual(['eq', 'sport', 'nhl'])
    expect(sb.calls).toContainEqual(['gte', 'date', '2026-10-01T00:00:00.000Z'])
    expect(sb.calls.some((c) => c[0] === 'eq' && c[1] === 'season')).toBe(false)
  })
  test('counts null-season regular-season rows', async () => {
    const sb = supabaseWith({
      games: [
        { date: '2026-10-12T00:00:00', season: null },
        { date: '2026-10-14T00:00:00', season: null },
        { date: '2026-10-19T00:00:00', season: null },
      ],
    })
    await expect(countTeamSeasonFinals(sb, { id: 'NHL_1', sport: 'nhl' }, { now: NHL_NOW })).resolves.toBe(3)
    expect(sb.calls.some((c) => c[0] === 'eq' && c[1] === 'season')).toBe(false)
  })
  test('excludes preseason rows before the regular-season start', async () => {
    const sb = supabaseWith({
      games: [
        { date: '2026-09-22T00:00:00', season: null },
        { date: '2026-09-28T00:00:00', season: '2026' },
        { date: '2026-10-12T00:00:00', season: null },
        { date: '2026-10-19T00:00:00', season: null },
      ],
    })
    await expect(countTeamSeasonFinals(sb, { id: 'NHL_1', sport: 'nhl' }, { now: NHL_NOW })).resolves.toBe(2)
    expect(sb.calls).toContainEqual(['gte', 'date', '2026-10-01T00:00:00.000Z'])
  })
  test('unknown sport -> no lookup', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-19T00:00:00' }] })
    await expect(countTeamSeasonFinals(sb, { id: 'X_1', sport: 'xyz' }, { now: NHL_NOW })).resolves.toBeNull()
    expect(sb.calls).toHaveLength(0)
  })
  test('spring-training finals before Mar 20 are not counted', async () => {
    const april = new Date('2026-04-05T16:00:00.000Z')
    const sb = supabaseWith({
      games: [
        { date: '2026-03-05T17:00:00', season: null },
        { date: '2026-03-12T17:00:00', season: null },
        { date: '2026-03-19T17:00:00', season: null },
        { date: '2026-03-20T17:00:00', season: null },
        { date: '2026-03-28T17:00:00', season: null },
      ],
    })
    await expect(countTeamSeasonFinals(sb, { id: 'MLB_147', sport: 'mlb' }, { now: april })).resolves.toBe(2)
    expect(sb.calls).toContainEqual(['gte', 'date', '2026-03-20T00:00:00.000Z'])
  })
}

describe('fetchAndUpdateTeam NHL without previousEvent', () => {
  const team = { id: 'NHL_1', abbr: 'BOS', sport: 'nhl', season: '2026' }
  const logger = { log() {}, error() {} }
  const fetchImpl = async () => ({ ok: true, json: async () => ESPN_NHL_NO_SPLITS })

  test('in-season: derives statsDataThrough from regular-season finals (null season ok)', async () => {
    const sb = supabaseWith({
      games: [{ date: '2026-10-19T00:00:00', season: null }],
      finalsCount: 9,
    })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.updated).toBe(true)
    expect(res.plan.partial).toBe(false)
    expect(res.plan.freshnessTimestampsWritten).toBe(true)
    expect(sb.updates[0].payload.statsCapturedAt).toBe(NHL_NOW.toISOString())
    expect(sb.updates[0].payload.statsDataThrough).toBe('2026-10-19T00:00:00.000Z')
    expect(sb.updates[0].payload).not.toHaveProperty('homeRecord')
    expect(sb.calls).toContainEqual(['eq', 'sport', 'nhl'])
    expect(sb.calls).toContainEqual(['gte', 'date', '2026-10-01T00:00:00.000Z'])
    expect(sb.calls.some((c) => c[0] === 'eq' && c[1] === 'season')).toBe(false)
    expect(sb.calls).toContainEqual(['or', 'homeId.eq.NHL_1,awayId.eq.NHL_1'])
  })

  test('in-season: DB finals ahead of ESPN by more than 2 withholds timestamps (frozen ESPN)', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-19T00:00:00' }], finalsCount: 12 })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.updated).toBe(true)
    expect(res.plan.partial).toBe(true)
    expect(res.plan.freshnessTimestampsWritten).toBe(false)
    expect(sb.updates[0].payload.last10Record).toBe('7-2')
    expect(sb.updates[0].payload).not.toHaveProperty('statsCapturedAt')
    expect(sb.updates[0].payload).not.toHaveProperty('statsDataThrough')
  })

  test('in-season: DB behind ESPN still writes capturedAt and does not invent dataThrough', async () => {
    const sb = supabaseWith({ games: [], finalsCount: 0 })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.updated).toBe(true)
    expect(res.plan.partial).toBe(false)
    expect(res.plan.freshnessTimestampsWritten).toBe(true)
    expect(sb.updates[0].payload.statsCapturedAt).toBe(NHL_NOW.toISOString())
    expect(sb.updates[0].payload).not.toHaveProperty('statsDataThrough')
  })

  test('in-season: preseason-only finals do not invent dataThrough', async () => {
    const sb = supabaseWith({
      games: [
        { date: '2026-09-22T00:00:00', season: null },
        { date: '2026-09-28T00:00:00', season: null },
      ],
    })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.updated).toBe(true)
    expect(res.plan.partial).toBe(false)
    expect(sb.updates[0].payload.statsCapturedAt).toBe(NHL_NOW.toISOString())
    expect(sb.updates[0].payload).not.toHaveProperty('statsDataThrough')
  })
})

describe('fetchAndUpdateTeam NFL without previousEvent', () => {
  const team = { id: 'NFL_1', abbr: 'KC', sport: 'nfl', season: '2026' }
  const logger = { log() {}, error() {} }
  const fetchImpl = async () => ({ ok: true, json: async () => ESPN_NFL_NO_PREV })

  test('uses DB finals date when ESPN is not frozen (null season ok)', async () => {
    const sb = supabaseWith({
      games: [{ date: '2026-10-13T00:20:00', season: null }],
      finalsCount: 5,
    })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.updated).toBe(true)
    expect(res.plan.partial).toBe(false)
    expect(sb.updates[0].payload.statsDataThrough).toBe('2026-10-13T00:20:00.000Z')
    expect(sb.calls).toContainEqual(['eq', 'sport', 'nfl'])
    expect(sb.calls).toContainEqual(['gte', 'date', '2026-09-01T00:00:00.000Z'])
    expect(sb.calls.some((c) => c[0] === 'eq' && c[1] === 'season')).toBe(false)
  })

  test('DB behind ESPN is not partial; writes capturedAt', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-09-08T00:20:00', season: null }], finalsCount: 1 })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.plan.partial).toBe(false)
    expect(sb.updates[0].payload.statsCapturedAt).toBe(NHL_NOW.toISOString())
    expect(sb.updates[0].payload.statsDataThrough).toBe('2026-09-08T00:20:00.000Z')
  })

  test('frozen ESPN (DB finals ahead by more than 2) is partial', async () => {
    const sb = supabaseWith({ games: [{ date: '2026-10-13T00:20:00' }], finalsCount: 8 })
    const res = await fetchAndUpdateTeam(team, { supabase: sb, fetchImpl, extractedAt: NHL_NOW, logger })
    expect(res.plan.partial).toBe(true)
    expect(sb.updates[0].payload).not.toHaveProperty('statsCapturedAt')
    expect(sb.updates[0].payload).not.toHaveProperty('statsDataThrough')
  })
})

describe('NYY off-season freshness (161 GP + 2027 spring training next event)', () => {
  const NYY_NOW = new Date('2026-10-27T12:00:00.000Z')
  const ESPN_NYY = {
    team: {
      nextEvent: [{
        season: { year: 2027, type: 1 },
        seasonType: { type: 1, name: 'Preseason' },
      }],
      previousEvent: {
        date: '2026-10-02T00:00Z',
        competitions: [{ status: { type: { completed: true } } }],
      },
      record: {
        items: [{
          type: 'total',
          summary: '94-67',
          stats: [
            { name: 'avgPointsFor', value: 5.2 },
            { name: 'avgPointsAgainst', value: 4.1 },
            { name: 'gamesPlayed', value: 161 },
          ],
        },
        { type: 'home', summary: '50-31' },
        { type: 'road', summary: '44-36' },
        ],
      },
    },
  }

  test('writes timestamps instead of classifying as partial', async () => {
    const sb = supabaseWith({
      games: [
        { date: '2026-03-05T17:00:00' },
        { date: '2026-03-12T17:00:00' },
        { date: '2026-03-15T17:00:00' },
        { date: '2026-03-18T17:00:00' },
        { date: '2026-10-02T00:00:00' },
      ],
      finalsCount: 165,
    })
    const res = await fetchAndUpdateTeam({ id: 'MLB_147', abbr: 'NYY', sport: 'mlb' }, {
      supabase: sb,
      fetchImpl: async () => ({ ok: true, json: async () => ESPN_NYY }),
      extractedAt: NYY_NOW,
      logger: { log() {}, error() {} },
    })
    expect(res.updated).toBe(true)
    expect(res.plan.partial).toBe(false)
    expect(res.plan.freshnessTimestampsWritten).toBe(true)
    expect(sb.updates[0].payload.season).toBe('2026')
    expect(sb.updates[0].payload.statsCapturedAt).toBe(NYY_NOW.toISOString())
    expect(sb.updates[0].payload).toHaveProperty('statsDataThrough')
  })
})
