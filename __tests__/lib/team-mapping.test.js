import { espnEventSeasonYear } from '../../lib/team-mapping.js'

describe('espnEventSeasonYear', () => {
  test('reads event.season.year for Game.season ingest', () => {
    expect(espnEventSeasonYear({ season: { year: 2026, type: 2 } })).toBe('2026')
    expect(espnEventSeasonYear({ season: { year: 2027, type: 1 } })).toBe('2027')
    expect(espnEventSeasonYear({ season: 2026 })).toBe('2026')
    expect(espnEventSeasonYear({})).toBeNull()
    expect(espnEventSeasonYear(null)).toBeNull()
  })
})
