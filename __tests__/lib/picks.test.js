import { mapCachePropToEditorPick, selectEditorPicks } from '../../lib/picks.js'

function cacheRow(name, overrides = {}) {
  return {
    propId: `p-${name}`,
    gameId: `g-${name}`,
    playerName: name,
    team: 'NYY',
    type: 'batter_hits',
    pick: 'over',
    threshold: 1.5,
    odds: -110,
    edge: 0.05,
    qualityScore: 50,
    sport: 'mlb',
    probability: 0.54,
    bookmaker: 'DraftKings',
    ...overrides,
  }
}

describe('selectEditorPicks', () => {
  test('maps cache rows and applies the Published / Pile B ranker', () => {
    const rows = [
      cacheRow('Keep high', { edge: 0.11, qualityScore: 44 }),
      cacheRow('Keep mid', { edge: 0.04, qualityScore: 62, odds: 1.91 }),
      cacheRow('Juice trap', { pick: 'under', threshold: 0.5, edge: 0.20 }),
      cacheRow('Juice price', { odds: -250, edge: 0.18, qualityScore: 80 }),
      cacheRow('Decimal juice', { odds: 1.40, edge: 0.12, qualityScore: 70 }),
      cacheRow('No edge', { edge: 0, qualityScore: 80 }),
      cacheRow('Low QS', { qualityScore: 30 }),
      cacheRow('NHL', { sport: 'nhl', edge: 0.15, qualityScore: 70 }),
    ]

    const picks = selectEditorPicks(rows)
    expect(picks.map((p) => p.playerName)).toEqual(['Keep high', 'Keep mid'])
    expect(picks.every((p) => p.type === 'player_prop')).toBe(true)
    expect(picks.every((p) => p.sport === 'mlb' || p.sport === 'nfl')).toBe(true)
    expect(picks[0].propType).toBe('batter_hits')
  })

  test('returns an empty list instead of padding', () => {
    expect(selectEditorPicks([
      cacheRow('Trap', { pick: 'under', threshold: 0.5 }),
      cacheRow('NHL', { sport: 'nhl' }),
    ])).toEqual([])
    expect(selectEditorPicks([])).toEqual([])
    expect(selectEditorPicks(null)).toEqual([])
  })

  test('mapped player_prop wrap still drops counting-stat under 0.5', () => {
    const mapped = mapCachePropToEditorPick(cacheRow('Trap', {
      pick: 'under',
      threshold: 0.5,
      type: 'batter_hits',
    }))
    expect(mapped.type).toBe('player_prop')
    expect(mapped.propType).toBe('batter_hits')
    expect(selectEditorPicks([mapped])).toEqual([])
  })
})
