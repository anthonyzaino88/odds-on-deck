import { POST as saveProp } from '../../app/api/props/save/route.js'
import { POST as saveParlay } from '../../app/api/parlays/save/route.js'
import * as validationRoute from '../../app/api/validation/route.js'
import { POST as rosterPost } from '../../app/api/nfl/roster/route.js'
import { fetchAndStoreNFLRosters } from '../../lib/nfl-roster.js'

jest.mock('../../lib/nfl-roster.js', () => ({
  fetchAndStoreNFLRosters: jest.fn(),
  getTeamRoster: jest.fn(),
  getGameStarters: jest.fn(),
  getTeamInjuryReport: jest.fn(),
}))

function jsonRequest(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('anonymous writes cannot change the public record', () => {
  test('POST /api/validation is removed — grading stays on the CRON-gated route', () => {
    expect(validationRoute.POST).toBeUndefined()
    expect(validationRoute.GET).toEqual(expect.any(Function))
  })

  test('POST /api/props/save is a 410 no-op', async () => {
    const res = await saveProp(jsonRequest('http://localhost/api/props/save', {
      prop: {
        playerName: 'Aaron Judge',
        gameId: 'NYY_at_BOS_2026-09-29',
        type: 'batter_hits',
        propId: 'pub-mlb-NYY_at_BOS_2026-09-29-aaron judge-batter_hits-over-1.5',
        edge: 0.99,
        qualityScore: 99,
        odds: -110,
        pick: 'over',
        threshold: 1.5,
        sport: 'mlb',
      },
    }))
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.retired).toBe(true)
    expect(body.success).toBe(true)
    expect(body.skipped).toBe(true)
  })

  test('POST /api/parlays/save is a 410 no-op and does not persist Featured', async () => {
    const res = await saveParlay(jsonRequest('http://localhost/api/parlays/save', {
      parlay: {
        sport: 'nba',
        type: 'multi_game',
        expectedValue: 9.99,
        totalOdds: 12,
        legs: [
          { playerName: 'Crafted', propType: 'batter_hits', threshold: 0.5, pick: 'over', gameTime: '2099-01-01T00:00:00Z' },
        ],
      },
    }))
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.retired).toBe(true)
    expect(body.success).toBe(true)
  })

  test('POST /api/nfl/roster rejects anonymous requests and does not fetch/store', async () => {
    const previous = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'test-cron-secret'
    fetchAndStoreNFLRosters.mockResolvedValue({ success: true, playersAdded: 1, rosterEntries: 1 })

    try {
      const res = await rosterPost(new Request('http://localhost/api/nfl/roster', { method: 'POST' }))
      expect(res.status).toBe(401)
      expect(fetchAndStoreNFLRosters).not.toHaveBeenCalled()
    } finally {
      process.env.CRON_SECRET = previous
    }
  })

  test('POST /api/nfl/roster accepts the admin secret', async () => {
    const previous = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'test-cron-secret'
    fetchAndStoreNFLRosters.mockResolvedValue({ success: true, playersAdded: 3, rosterEntries: 3 })

    try {
      const res = await rosterPost(new Request('http://localhost/api/nfl/roster', {
        method: 'POST',
        headers: { authorization: 'Bearer test-cron-secret' },
      }))
      expect(res.status).toBe(200)
      expect(fetchAndStoreNFLRosters).toHaveBeenCalledTimes(1)
    } finally {
      process.env.CRON_SECRET = previous
    }
  })
})
