// Integration tests for the refresh-slate API endpoint

import { GET } from '../../app/api/cron/refresh-slate/route.js'

// Mock the vendor modules
jest.mock('../../lib/vendors/stats.js', () => ({
  fetchSchedule: jest.fn(),
  fetchTeams: jest.fn(),
}))

jest.mock('../../lib/vendors/odds.js', () => ({
  fetchOdds: jest.fn(),
}))

jest.mock('../../lib/db.js', () => ({
  upsertTeam: jest.fn(),
  upsertPlayer: jest.fn(),
  upsertGame: jest.fn(),
  createOdds: jest.fn(),
  createEdgeSnapshot: jest.fn(),
  cleanupOldOdds: jest.fn(),
  cleanupOldEdgeSnapshots: jest.fn(),
}))

import { fetchSchedule, fetchTeams } from '../../lib/vendors/stats.js'
import { fetchOdds } from '../../lib/vendors/odds.js'
import {
  upsertTeam,
  upsertPlayer,
  upsertGame,
  createOdds,
  createEdgeSnapshot,
} from '../../lib/db.js'

describe('/api/cron/refresh-slate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    
    // Setup default mock returns
    fetchTeams.mockResolvedValue([
      {
        id: 'team1',
        name: 'Test Team',
        abbr: 'TST',
        parkFactor: 1.0,
      },
    ])

    fetchSchedule.mockResolvedValue([
      {
        id: 'game1',
        date: new Date(),
        status: 'scheduled',
        home: { id: 'team1', name: 'Home Team', abbr: 'HOM' },
        away: { id: 'team2', name: 'Away Team', abbr: 'AWY' },
        probablePitchers: {
          home: {
            id: 'pitcher1',
            fullName: 'Home Pitcher',
            throws: 'R',
          },
          away: {
            id: 'pitcher2',
            fullName: 'Away Pitcher',
            throws: 'L',
          },
        },
      },
    ])

    fetchOdds.mockResolvedValue([
      {
        gameId: 'game1',
        book: 'Test Book',
        market: 'h2h',
        priceHome: -110,
        priceAway: -110,
      },
    ])

    // Mock successful database operations
    upsertTeam.mockResolvedValue({ id: 'team1' })
    upsertPlayer.mockResolvedValue({ id: 'pitcher1' })
    upsertGame.mockResolvedValue({ id: 'game1' })
    createOdds.mockResolvedValue({ id: 'odds1' })
    createEdgeSnapshot.mockResolvedValue({ id: 'edge1' })
  })

  test('successfully processes complete workflow', async () => {
    const response = await GET()
    const result = await response.json()

    expect(result.success).toBe(true)
    expect(result.stats.teams).toBe(1)
    expect(result.stats.games).toBe(1)
    expect(result.stats.odds).toBe(1)

    // Verify database operations were called
    expect(upsertTeam).toHaveBeenCalledWith({
      id: 'team1',
      name: 'Test Team',
      abbr: 'TST',
      parkFactor: 1.0,
    })

    expect(upsertGame).toHaveBeenCalled()
    expect(upsertPlayer).toHaveBeenCalledTimes(2) // Both pitchers
    expect(createOdds).toHaveBeenCalled()
    expect(createEdgeSnapshot).toHaveBeenCalled()
  })

  test('handles vendor API failures gracefully', async () => {
    fetchSchedule.mockRejectedValue(new Error('API Error'))

    const response = await GET()
    const result = await response.json()

    expect(result.success).toBe(false)
    expect(result.error).toBe('API Error')
    expect(response.status).toBe(500)
  })

  test('handles empty data gracefully', async () => {
    fetchTeams.mockResolvedValue([])
    fetchSchedule.mockResolvedValue([])
    fetchOdds.mockResolvedValue([])

    const response = await GET()
    const result = await response.json()

    expect(result.success).toBe(true)
    expect(result.stats.teams).toBe(0)
    expect(result.stats.games).toBe(0)
    expect(result.stats.odds).toBe(0)
  })

  test('only stores odds for existing games', async () => {
    fetchOdds.mockResolvedValue([
      {
        gameId: 'game1', // Exists
        book: 'Test Book',
        market: 'h2h',
        priceHome: -110,
        priceAway: -110,
      },
      {
        gameId: 'nonexistent-game', // Doesn't exist
        book: 'Test Book',
        market: 'h2h',
        priceHome: -120,
        priceAway: -120,
      },
    ])

    const response = await GET()
    const result = await response.json()

    expect(result.success).toBe(true)
    expect(createOdds).toHaveBeenCalledTimes(1) // Only once for existing game
  })

  test('handles database errors', async () => {
    upsertTeam.mockRejectedValue(new Error('Database Error'))

    const response = await GET()
    const result = await response.json()

    expect(result.success).toBe(false)
    expect(result.error).toBe('Database Error')
    expect(response.status).toBe(500)
  })
})

