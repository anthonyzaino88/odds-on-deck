import { GET } from '../../app/api/nfl/matchups/route.js'
import { analyzeGameMatchup } from '../../lib/nfl-matchups.js'

jest.mock('../../lib/nfl-matchups.js', () => ({
  analyzeGameMatchup: jest.fn(),
  getMatchupHistory: jest.fn(),
  getDefensiveRankings: jest.fn(),
}))

describe('GET /api/nfl/matchups', () => {
  test('a throwing error getter still returns the failed response', async () => {
    const error = new Error('boom')
    Object.defineProperty(error, 'quota', {
      enumerable: true,
      get() { throw new Error('quota getter') },
    })
    analyzeGameMatchup.mockRejectedValue(error)
    const res = await GET(new Request('http://localhost/api/nfl/matchups?gameId=g1'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Failed to analyze matchup')
  })
})
