import { generateQuickInsight } from '../../lib/pick-insights.js'

describe('NFL insight labels', () => {
  test('does not call a season record a last-10 hot streak', () => {
    const insight = generateQuickInsight(
      { type: 'moneyline', pick: 'KC', sport: 'nfl', edge: 0.06 },
      { sport: 'nfl', home: { abbr: 'KC', last10Record: '12-4' }, away: { abbr: 'DEN', last10Record: '4-12' } },
    )
    expect(insight).toBe('Season record: 12-4')
    expect(insight).not.toMatch(/recent form/i)
    expect(insight).not.toMatch(/Hot streak/)
  })

  test('MLB copy is unchanged', () => {
    const insight = generateQuickInsight(
      { type: 'moneyline', pick: 'NYY', sport: 'mlb', edge: 0.06 },
      { sport: 'mlb', home: { abbr: 'NYY', last10Record: '8-2' }, away: { abbr: 'BOS', last10Record: '4-6' } },
    )
    expect(insight).toBe('Hot streak: 8-2 recent form')
  })
})
