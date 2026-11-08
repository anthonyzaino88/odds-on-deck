import { GET } from '../../app/api/games/today/route.js'
import { getTodaysGames } from '../../lib/todays-games.js'

jest.mock('../../lib/todays-games.js', () => ({
  getTodaysGames: jest.fn(),
}))

describe('GET /api/games/today', () => {
  test('a database error in the response keeps its shape and drops secrets', async () => {
    getTodaysGames.mockResolvedValue({
      success: false,
      error: {
        message: 'connect failed',
        details: 'postgresql://user:super-db-pass@db.internal/postgres',
        apiKey: 'live-key',
        code: '28P01',
      },
    })
    const res = await GET()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('28P01')
    expect(body.error.apiKey).toBe('[redacted]')
    expect(body.error.message).toBe('connect failed')
    expect(body.error.details).toBe('postgresql://[redacted]')
    expect(JSON.stringify(body)).not.toContain('super-db-pass')
    expect(JSON.stringify(body)).not.toContain('live-key')
  })
})
