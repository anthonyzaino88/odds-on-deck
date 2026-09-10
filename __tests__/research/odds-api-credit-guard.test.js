import {
  CreditCapError,
  HARD_CREDIT_CAP,
  canAfford,
  createCreditGuard,
  expectedHistoricalOddsCost,
  guardedFetch,
  parseHeaderInt,
  redactOddsApiUrl,
} from '../../lib/research/odds-api-credit-guard.js'

function jsonResponse({ last, remaining, used = 100, status = 200, body = { ok: true } }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const map = {
          'x-requests-last': String(last),
          'x-requests-remaining': String(remaining),
          'x-requests-used': String(used),
        }
        return map[name] ?? null
      },
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

describe('Odds API credit-cap guard', () => {
  test('historical us + h2h,totals costs 20', () => {
    expect(expectedHistoricalOddsCost({ regions: 'us', markets: 'h2h,totals' })).toBe(20)
    expect(expectedHistoricalOddsCost({ regions: 'us', markets: 'h2h' })).toBe(10)
  })

  test('refuses a hard cap above 3000', () => {
    expect(() => createCreditGuard({ hardCap: 3001 })).toThrow(/cannot exceed 3000/)
  })

  test('canAfford is false when the next call would exceed the cap', () => {
    const guard = createCreditGuard({ hardCap: 40, spent: 30 })
    expect(canAfford(guard, 20)).toBe(false)
    expect(canAfford(guard, 10)).toBe(true)
  })

  test('canAfford is false when remaining credits are below the next cost', () => {
    const guard = createCreditGuard({ hardCap: 3000, spent: 0, remaining: 15 })
    expect(canAfford(guard, 20)).toBe(false)
  })

  test('aborts before fetch when the next snapshot would exceed the cap', async () => {
    const fetchImpl = jest.fn()
    const guard = createCreditGuard({ hardCap: 30, spent: 20 })

    await expect(guardedFetch(guard, 'https://api.the-odds-api.com/v4/historical/x?apiKey=secret', {
      expectedCost: 20,
      fetchImpl,
      snapshotId: '2024_W02_early',
    })).rejects.toBeInstanceOf(CreditCapError)

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(guard.aborted).toBe(true)
    expect(guard.spent).toBe(20)
  })

  test('records x-requests-last / remaining after a successful call', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ last: 20, remaining: 980, used: 20 }))
    const guard = createCreditGuard({ hardCap: 3000 })

    const response = await guardedFetch(guard, 'https://api.example.test/odds?apiKey=super-secret', {
      expectedCost: 20,
      fetchImpl,
      snapshotId: '2024_W01_early',
    })

    expect(response.status).toBe(200)
    expect(guard.spent).toBe(20)
    expect(guard.remaining).toBe(980)
    expect(guard.calls[0].cost).toBe(20)
    expect(guard.calls[0].url).toContain('apiKey=REDACTED')
    expect(guard.calls[0].url).not.toContain('super-secret')
    expect(guard.aborted).toBe(false)
  })

  test('second snapshot is blocked after the first spends the remaining budget', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ last: 20, remaining: 10 }))
      .mockResolvedValueOnce(jsonResponse({ last: 20, remaining: 0 }))

    const guard = createCreditGuard({ hardCap: 40 })
    await guardedFetch(guard, 'https://api.example.test/one', {
      expectedCost: 20,
      fetchImpl,
      snapshotId: 'snap_1',
    })

    await expect(guardedFetch(guard, 'https://api.example.test/two', {
      expectedCost: 20,
      fetchImpl,
      snapshotId: 'snap_2',
    })).rejects.toThrow(/would exceed hard cap/)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(guard.spent).toBe(20)
  })

  test('redacts api keys and parses credit headers', () => {
    expect(redactOddsApiUrl('https://api.the-odds-api.com/v4/odds?apiKey=abc123&regions=us'))
      .toBe('https://api.the-odds-api.com/v4/odds?apiKey=REDACTED&regions=us')
    expect(parseHeaderInt({ get: (name) => (name === 'x-requests-last' ? '20' : null) }, 'x-requests-last')).toBe(20)
    expect(HARD_CREDIT_CAP).toBe(3000)
  })
})
