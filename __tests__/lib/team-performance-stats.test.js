import {
  applyTeamPerformanceUpdate,
  extractEspnTeamPerformance,
  interpretTeamSeasonStats,
  parseRecordString,
  teamPerformanceWritePayload,
} from '../../lib/team-performance-stats.js'

describe('team performance field meaning', () => {
  test('last10Record / avgPointsLast10 from ESPN are season averages', () => {
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
    }, 'nfl', { extractedAt: new Date('2025-12-15T00:00:00.000Z') })

    expect(extracted.last10Record).toBe('12-4')
    expect(extracted.avgPointsLast10).toBeCloseTo(26.1, 5)
    expect(extracted.meta.statsKind).toBe('season')
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

describe('partial ESPN updates do not erase existing stats', () => {
  const existingNfl = {
    last10Record: '12-4',
    homeRecord: '7-1',
    awayRecord: '5-3',
    avgPointsLast10: 26.1,
    avgPointsAllowedLast10: 18.4,
  }
  const existingNhl = {
    last10Record: '28-12-5',
    homeRecord: '16-5-2',
    awayRecord: '12-7-3',
    avgPointsLast10: 3.4,
    avgPointsAllowedLast10: 2.7,
  }

  test('partial NFL response keeps prior records and scoring averages', () => {
    const extracted = extractEspnTeamPerformance({
      team: { record: { items: [{ type: 'total', summary: '12-5' }] } },
    }, 'nfl')

    expect(extracted.last10Record).toBe('12-5')
    expect(extracted).not.toHaveProperty('homeRecord')
    expect(extracted).not.toHaveProperty('avgPointsLast10')
    expect(extracted).not.toHaveProperty('avgPointsAllowedLast10')
    expect(extracted.meta.partial).toBe(true)
    expect(extracted.meta.omittedFields).toEqual(expect.arrayContaining([
      'homeRecord',
      'awayRecord',
      'avgPointsLast10',
      'avgPointsAllowedLast10',
    ]))

    const write = teamPerformanceWritePayload(extracted)
    expect(write.payload).toEqual({ last10Record: '12-5' })
    expect(write.payload).not.toHaveProperty('avgPointsLast10')
    expect(write.retained).toEqual(expect.arrayContaining([
      'homeRecord',
      'avgPointsLast10',
      'avgPointsAllowedLast10',
    ]))
    expect(write.representsFullRefresh).toBe(false)

    const applied = applyTeamPerformanceUpdate(existingNfl, extracted)
    expect(applied.next.last10Record).toBe('12-5')
    expect(applied.next.homeRecord).toBe('7-1')
    expect(applied.next.awayRecord).toBe('5-3')
    expect(applied.next.avgPointsLast10).toBe(26.1)
    expect(applied.next.avgPointsAllowedLast10).toBe(18.4)
    expect(applied.freshness.retainedFieldsNotFresh).toEqual(write.retained)
    expect(applied.freshness.updatedFields).toEqual(['last10Record'])
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

    const applied = applyTeamPerformanceUpdate(existingNhl, extracted)
    expect(applied.next.last10Record).toBe('29-12-5')
    expect(applied.next.homeRecord).toBe('16-6-2')
    expect(applied.next.awayRecord).toBe('12-7-3')
    expect(applied.next.avgPointsLast10).toBe(3.4)
    expect(applied.next.avgPointsAllowedLast10).toBe(2.7)
    expect(applied.freshness.retainedFieldsNotFresh).toEqual(expect.arrayContaining([
      'awayRecord',
      'avgPointsLast10',
      'avgPointsAllowedLast10',
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
    expect(applied.invalidated).toEqual(['avgPointsLast10'])
    expect(applied.freshness.updatedFields).toEqual(['last10Record'])
    expect(applied.freshness.invalidatedFields).toEqual(['avgPointsLast10'])
    expect(applied.freshness.retainedFieldsNotFresh).not.toContain('avgPointsLast10')
  })
})

