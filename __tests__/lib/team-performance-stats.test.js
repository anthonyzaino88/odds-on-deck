import {
  extractEspnTeamPerformance,
  interpretTeamSeasonStats,
  parseRecordString,
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
