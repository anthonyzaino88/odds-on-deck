import {
  evaluateTeamStatsForEdge,
  mergeStatsDataThrough,
  parseStoredUtcInstantMs,
} from '../../lib/team-performance-stats.js'
import { fetchAndUpdateTeam, loadLatestFinalGameDate } from '../../lib/team-performance-fetch.js'

const NOW = new Date('2026-10-16T12:25:00.000Z')

function gameQuery(rows, calls) {
  const q = {
    select() { return q },
    or(expr) { calls.push(['or', expr]); return q },
    in(col, vals) { calls.push(['in', col, vals]); return q },
    lte(col, val) { calls.push(['lte', col, val]); return q },
    order() { return q },
    async limit() { return { data: rows, error: null } },
  }
  return q
}

function supabaseWith({ games = [], gameThrows = false } = {}) {
  const calls = []
  const updates = []
  return {
    calls,
    updates,
    from(table) {
      if (table === 'Game') {
        if (gameThrows) throw new Error('no Game table')
        return gameQuery(games, calls)
      }
      return {
        update(payload) {
          return { async eq(col, id) { updates.push({ id, payload }); return { error: null } } }
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
    await expect(loadLatestFinalGameDate(sb, { id: 'MLB_139' }, { now: NOW })).resolves.toBe('2026-10-15T17:00:00')
    expect(sb.calls).toContainEqual(['or', 'homeId.eq.MLB_139,awayId.eq.MLB_139'])
    expect(sb.calls.find((c) => c[0] === 'in')[2]).toContain('final')
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
    expect(sb.updates[0].payload.statsDataThrough).toBeUndefined()
  })
})
