import {
  applyTeamPerformanceUpdate,
  extractEspnStatsDataThrough,
  extractEspnTeamPerformance,
  interpretTeamSeasonStats,
  parseRecordString,
  teamPerformanceWritePayload,
} from '../../lib/team-performance-stats.js'
import { calculateNFLEdges } from '../../lib/edge-nfl.js'
import {
  calculateNFLSelection,
  evaluateNflDataEligibility,
  toPublicNflGameLines,
} from '../../lib/nfl-selection-model.js'

const EXTRACTED_AT = new Date('2025-12-15T00:00:00.000Z')
const LAST_GAME_AT = '2025-12-14T21:00:00.000Z'

function fullEspnTeam(overrides = {}) {
  return {
    team: {
      season: { year: 2025 },
      previousEvent: {
        date: LAST_GAME_AT,
        status: { type: { completed: true } },
      },
      record: {
        items: [
          {
            type: 'total',
            summary: '12-4',
            stats: [
              { name: 'avgPointsFor', value: '26.1' },
              { name: 'avgPointsAgainst', value: '18.4' },
              { name: 'gamesPlayed', value: '16' },
            ],
          },
          { type: 'home', summary: '7-1' },
          { type: 'road', summary: '5-3' },
        ],
      },
      ...overrides,
    },
  }
}

describe('team performance field meaning', () => {
  test('last10Record / avgPointsLast10 from ESPN are season averages', () => {
    const extracted = extractEspnTeamPerformance(
      fullEspnTeam(),
      'nfl',
      { extractedAt: EXTRACTED_AT },
    )

    expect(extracted.last10Record).toBe('12-4')
    expect(extracted.avgPointsLast10).toBeCloseTo(26.1, 5)
    expect(extracted.meta.statsKind).toBe('season')
    expect(extracted.statsKind).toBe('season')
    expect(extracted.meta.last10FieldsAreSeasonAverages).toBe(true)
    expect(extracted.meta.gamesPlayed).toBe(16)
    expect(extracted.meta.season).toBe('2025')

    const interpreted = interpretTeamSeasonStats({
      abbr: 'KC',
      last10Record: extracted.last10Record,
      avgPointsLast10: extracted.avgPointsLast10,
      avgPointsAllowedLast10: extracted.avgPointsAllowedLast10,
    })
    expect(interpreted.statsKind).toBe('season')
    expect(interpreted.gamesPlayed).toBe(16)
    expect(interpreted.seasonPointsFor).toBeCloseTo(26.1, 5)
  })

  test('parseRecordString handles NHL OT losses', () => {
    expect(parseRecordString('7-4-2')).toEqual({ wins: 7, losses: 4, otl: 2, games: 13 })
  })
})

describe('full ESPN extract persists freshness fields', () => {
  test('writes season, gamesPlayed, statsKind, and timestamps when ESPN data is complete', () => {
    const extracted = extractEspnTeamPerformance(
      fullEspnTeam(),
      'nfl',
      { extractedAt: EXTRACTED_AT },
    )

    expect(extracted.season).toBe('2025')
    expect(extracted.gamesPlayed).toBe(16)
    expect(extracted.statsKind).toBe('season')
    expect(extracted.statsCapturedAt).toBe(EXTRACTED_AT.toISOString())
    expect(extracted.statsDataThrough).toBe(new Date(LAST_GAME_AT).toISOString())
    expect(extracted.meta.partial).toBe(false)
    expect(extracted.meta.timestampsWritten).toBe(true)

    const write = teamPerformanceWritePayload(extracted)
    expect(write.representsFullRefresh).toBe(true)
    expect(write.freshnessTimestampsWritten).toBe(true)
    expect(write.payload).toEqual(expect.objectContaining({
      last10Record: '12-4',
      homeRecord: '7-1',
      awayRecord: '5-3',
      season: '2025',
      gamesPlayed: 16,
      statsKind: 'season',
      statsCapturedAt: EXTRACTED_AT.toISOString(),
      statsDataThrough: new Date(LAST_GAME_AT).toISOString(),
    }))
    expect(write.payload.avgPointsLast10).toBeCloseTo(26.1, 5)
    expect(write.payload.avgPointsAllowedLast10).toBeCloseTo(18.4, 5)
    expect(write.payload).not.toHaveProperty('meta')
  })

  test('does not invent statsDataThrough from the fetch clock', () => {
    const extracted = extractEspnTeamPerformance({
      team: {
        season: { year: 2025 },
        record: {
          items: [
            {
              type: 'total',
              summary: '12-4',
              stats: [
                { name: 'avgPointsFor', value: '26.1' },
                { name: 'avgPointsAgainst', value: '18.4' },
                { name: 'gamesPlayed', value: '16' },
              ],
            },
            { type: 'home', summary: '7-1' },
            { type: 'road', summary: '5-3' },
          ],
        },
      },
    }, 'nfl', { extractedAt: EXTRACTED_AT })

    expect(extractEspnStatsDataThrough({ team: extracted })).toBeNull()
    expect(extracted.statsCapturedAt).toBe(EXTRACTED_AT.toISOString())
    expect(extracted).not.toHaveProperty('statsDataThrough')
    expect(extracted.meta.dataThrough).toBeNull()

    const write = teamPerformanceWritePayload(extracted)
    expect(write.payload.statsCapturedAt).toBe(EXTRACTED_AT.toISOString())
    expect(write.payload).not.toHaveProperty('statsDataThrough')
    expect(write.retained).toContain('statsDataThrough')
  })

  test('statsKind stays season even when last10* columns are written', () => {
    const extracted = extractEspnTeamPerformance(fullEspnTeam(), 'mlb', { extractedAt: EXTRACTED_AT })
    expect(extracted.statsKind).toBe('season')
    expect(extracted.statsKind).not.toBe('last10')
  })
})

describe('partial ESPN updates do not erase existing stats', () => {
  const existingNfl = {
    last10Record: '12-4',
    homeRecord: '7-1',
    awayRecord: '5-3',
    avgPointsLast10: 26.1,
    avgPointsAllowedLast10: 18.4,
    season: '2025',
    gamesPlayed: 16,
    statsKind: 'season',
    statsCapturedAt: '2025-12-12T00:00:00.000Z',
    statsDataThrough: '2025-12-11T21:00:00.000Z',
  }
  const existingNhl = {
    last10Record: '28-12-5',
    homeRecord: '16-5-2',
    awayRecord: '12-7-3',
    avgPointsLast10: 3.4,
    avgPointsAllowedLast10: 2.7,
    season: '2025',
    gamesPlayed: 45,
    statsKind: 'season',
    statsCapturedAt: '2025-12-12T00:00:00.000Z',
    statsDataThrough: '2025-12-11T00:00:00.000Z',
  }

  test('partial NFL response keeps prior records, scoring averages, and freshness timestamps', () => {
    const extracted = extractEspnTeamPerformance({
      team: { record: { items: [{ type: 'total', summary: '12-5' }] } },
    }, 'nfl')

    expect(extracted.last10Record).toBe('12-5')
    expect(extracted).not.toHaveProperty('homeRecord')
    expect(extracted).not.toHaveProperty('avgPointsLast10')
    expect(extracted).not.toHaveProperty('avgPointsAllowedLast10')
    expect(extracted).not.toHaveProperty('statsCapturedAt')
    expect(extracted).not.toHaveProperty('statsDataThrough')
    expect(extracted.meta.partial).toBe(true)
    expect(extracted.meta.timestampsWritten).toBe(false)
    expect(extracted.meta.omittedFields).toEqual(expect.arrayContaining([
      'homeRecord',
      'awayRecord',
      'avgPointsLast10',
      'avgPointsAllowedLast10',
    ]))

    const write = teamPerformanceWritePayload(extracted)
    expect(write.payload).toEqual({
      last10Record: '12-5',
      gamesPlayed: 17,
      statsKind: 'season',
    })
    expect(write.payload).not.toHaveProperty('avgPointsLast10')
    expect(write.payload).not.toHaveProperty('statsCapturedAt')
    expect(write.payload).not.toHaveProperty('statsDataThrough')
    expect(write.retained).toEqual(expect.arrayContaining([
      'homeRecord',
      'avgPointsLast10',
      'avgPointsAllowedLast10',
      'statsCapturedAt',
      'statsDataThrough',
    ]))
    expect(write.representsFullRefresh).toBe(false)
    expect(write.freshnessTimestampsWritten).toBe(false)

    const applied = applyTeamPerformanceUpdate(existingNfl, extracted)
    expect(applied.next.last10Record).toBe('12-5')
    expect(applied.next.homeRecord).toBe('7-1')
    expect(applied.next.awayRecord).toBe('5-3')
    expect(applied.next.avgPointsLast10).toBe(26.1)
    expect(applied.next.avgPointsAllowedLast10).toBe(18.4)
    expect(applied.next.statsCapturedAt).toBe('2025-12-12T00:00:00.000Z')
    expect(applied.next.statsDataThrough).toBe('2025-12-11T21:00:00.000Z')
    expect(applied.next.season).toBe('2025')
    expect(applied.freshness.retainedFieldsNotFresh).toEqual(write.retained)
    expect(applied.freshness.updatedFields).toEqual(['last10Record', 'gamesPlayed', 'statsKind'])
    expect(applied.freshness.timestampsWritten).toBe(false)
  })

  test('partial NHL response keeps prior records and scoring averages', () => {
    const extracted = extractEspnTeamPerformance({
      team: {
        record: {
          items: [
            { type: 'total', summary: '29-12-5' },
            { type: 'home', summary: '16-6-2' },
          ],
        },
      },
    }, 'nhl')

    expect(extracted.last10Record).toBe('29-12-5')
    expect(extracted.homeRecord).toBe('16-6-2')
    expect(extracted).not.toHaveProperty('avgPointsLast10')
    expect(extracted).not.toHaveProperty('statsCapturedAt')

    const applied = applyTeamPerformanceUpdate(existingNhl, extracted)
    expect(applied.next.last10Record).toBe('29-12-5')
    expect(applied.next.homeRecord).toBe('16-6-2')
    expect(applied.next.awayRecord).toBe('12-7-3')
    expect(applied.next.avgPointsLast10).toBe(3.4)
    expect(applied.next.avgPointsAllowedLast10).toBe(2.7)
    expect(applied.next.statsCapturedAt).toBe('2025-12-12T00:00:00.000Z')
    expect(applied.next.statsDataThrough).toBe('2025-12-11T00:00:00.000Z')
    expect(applied.freshness.retainedFieldsNotFresh).toEqual(expect.arrayContaining([
      'awayRecord',
      'avgPointsLast10',
      'avgPointsAllowedLast10',
      'statsCapturedAt',
    ]))
  })

  test('explicit invalidation is separate from a partial fetch', () => {
    const extracted = extractEspnTeamPerformance({
      team: { record: { items: [{ type: 'total', summary: '12-5' }] } },
    }, 'nfl')
    const applied = applyTeamPerformanceUpdate(existingNfl, extracted, {
      invalidate: ['avgPointsLast10'],
    })
    expect(applied.next.avgPointsLast10).toBeNull()
    expect(applied.next.avgPointsAllowedLast10).toBe(18.4)
    expect(applied.next.statsCapturedAt).toBe('2025-12-12T00:00:00.000Z')
    expect(applied.invalidated).toEqual(['avgPointsLast10'])
    expect(applied.freshness.updatedFields).toEqual(['last10Record', 'gamesPlayed', 'statsKind'])
    expect(applied.freshness.invalidatedFields).toEqual(['avgPointsLast10'])
    expect(applied.freshness.retainedFieldsNotFresh).not.toContain('avgPointsLast10')
  })
})

describe('written freshness still fail-closes public NFL', () => {
  const now = new Date('2025-12-15T18:00:00.000Z')
  const quote = {
    id: 'odd-h2h-1',
    gameId: 'g-nfl-1',
    book: 'DraftKings',
    market: 'h2h',
    priceHome: -110,
    priceAway: -110,
    ts: '2025-12-15T17:00:00.000Z',
  }

  test('missing freshness after a stats-only row stays unavailable and not public', () => {
    const extracted = extractEspnTeamPerformance({
      team: { record: { items: [{ type: 'total', summary: '12-4' }] } },
    }, 'nfl')
    const team = applyTeamPerformanceUpdate({ abbr: 'KC' }, extracted).next
    const stats = interpretTeamSeasonStats(team)

    expect(stats.capturedAt).toBeNull()
    expect(stats.dataThrough).toBeNull()
    expect(evaluateNflDataEligibility({
      home: stats,
      away: { ...stats, abbr: 'DEN' },
      game: { season: '2025' },
      now,
      market: 'moneyline',
    }).reason).toBe('missing_season')

    const seasonOnly = interpretTeamSeasonStats({
      ...team,
      season: '2025',
      gamesPlayed: 16,
    })
    expect(evaluateNflDataEligibility({
      home: seasonOnly,
      away: { ...seasonOnly, abbr: 'DEN' },
      game: { season: '2025' },
      now,
      market: 'moneyline',
    }).reason).toBe('unknown_data_freshness')

    const selection = calculateNFLSelection({
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home: team,
      away: { ...team, abbr: 'DEN' },
    }, [quote], { now })
    expect(selection.eligibility.eligibleForPublic).toBe(false)
    expect(toPublicNflGameLines(selection)).toEqual([])
    expect(calculateNFLEdges({
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home: team,
      away: { ...team, abbr: 'DEN' },
    }, [quote], { now }).eligibleForPublic).toBe(false)
  })

  test('stale captured-at after a full extract stays unavailable', () => {
    const extracted = extractEspnTeamPerformance(
      fullEspnTeam(),
      'nfl',
      { extractedAt: new Date('2025-11-01T00:00:00.000Z') },
    )
    const team = applyTeamPerformanceUpdate({ abbr: 'KC' }, extracted).next
    const stats = interpretTeamSeasonStats(team)
    expect(stats.capturedAt).toBe('2025-11-01T00:00:00.000Z')
    expect(evaluateNflDataEligibility({
      home: stats,
      away: { ...stats, abbr: 'DEN' },
      game: { season: '2025' },
      now,
      market: 'moneyline',
    }).reason).toBe('stale_team_data')
  })

  test('a current full extract can be data-eligible for research and still not public', () => {
    const extracted = extractEspnTeamPerformance(
      fullEspnTeam(),
      'nfl',
      { extractedAt: new Date('2025-12-14T22:00:00.000Z') },
    )
    const home = applyTeamPerformanceUpdate({ abbr: 'KC' }, extracted).next
    const away = applyTeamPerformanceUpdate({ abbr: 'DEN', last10Record: '4-12' }, extracted).next
    away.last10Record = '4-12'
    away.gamesPlayed = 16

    const selection = calculateNFLSelection({
      id: 'g-nfl-1',
      sport: 'nfl',
      season: '2025',
      home,
      away,
    }, [quote], { now })

    expect(selection.moneyline.eligibility.dataEligible).toBe(true)
    expect(selection.moneyline.eligibility.eligibleForPublic).toBe(false)
    expect(selection.moneyline.eligibility.reason).toBe('unvalidated_heuristic')
    expect(selection.totals.reason).toBe('missing_validated_scoring_distribution')
    expect(toPublicNflGameLines(selection)).toEqual([])
  })
})
