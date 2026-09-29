import { attachDbGameClock } from '../../lib/simple-parlay-generator.js'

describe('attachDbGameClock', () => {
  const bets = [{
    gameId: 'DET_at_CHI_2026-09-20',
    gameTime: '2026-09-21T00:00:00.000Z',
    playerName: 'Jared Goff',
  }]

  test('returns the cache list when Game lookup errors', async () => {
    const client = {
      from(table) {
        expect(table).toBe('Game')
        return {
          select() {
            return {
              in: async () => ({ data: null, error: { message: 'timeout' } }),
            }
          },
        }
      },
    }

    const result = await attachDbGameClock(bets, client)
    expect(result).toEqual(bets)
    expect(result[0].dbGameTime).toBeUndefined()
    expect(result[0].gameTime).toBe('2026-09-21T00:00:00.000Z')
  })

  test('overlays Game.date / status when the lookup succeeds', async () => {
    const client = {
      from() {
        return {
          select() {
            return {
              in: async () => ({
                data: [{
                  id: 'DET_at_CHI_2026-09-20',
                  date: '2026-09-20T17:00:00.000Z',
                  status: 'scheduled',
                }],
                error: null,
              }),
            }
          },
        }
      },
    }

    const result = await attachDbGameClock(bets, client)
    expect(result[0].dbGameTime).toBe('2026-09-20T17:00:00.000Z')
    expect(result[0].gameStatus).toBe('scheduled')
  })
})
