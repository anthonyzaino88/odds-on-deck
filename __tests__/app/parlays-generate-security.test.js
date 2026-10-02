import { GET as getGenerate, POST as postGenerate } from '../../app/api/parlays/generate/route.js'
import { generateSimpleParlays } from '../../lib/simple-parlay-generator.js'
import {
  loadFeaturedSnapshotCard,
  persistFeaturedClearedParlays,
} from '../../lib/featured-parlay-persist.js'

jest.mock('../../lib/simple-parlay-generator.js', () => ({
  generateSimpleParlays: jest.fn(async () => [{ id: 'live-card', legs: [] }]),
}))

jest.mock('../../lib/featured-parlay-persist.js', () => ({
  loadFeaturedSnapshotCard: jest.fn(async () => null),
  persistFeaturedClearedParlays: jest.fn(async (parlays) => (
    (parlays || []).map((parlay) => ({ ok: true, parlay }))
  )),
}))

function withCronSecret(secret, fn) {
  const previous = process.env.CRON_SECRET
  process.env.CRON_SECRET = secret
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.env.CRON_SECRET = previous
    })
}

describe('parlay generate write guard + parse errors', () => {
  beforeEach(() => {
    generateSimpleParlays.mockClear()
    loadFeaturedSnapshotCard.mockReset()
    persistFeaturedClearedParlays.mockClear()
    loadFeaturedSnapshotCard.mockResolvedValue(null)
    persistFeaturedClearedParlays.mockImplementation(async (parlays) => (
      (parlays || []).map((parlay) => ({ ok: true, parlay }))
    ))
  })

  test('POST with an empty body returns 400 and does not leak the parse error', async () => {
    const res = await postGenerate(new Request('http://localhost/api/parlays/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Request body must be valid JSON')
    expect(body.details).toBeUndefined()
    expect(JSON.stringify(body)).not.toMatch(/JSON\.parse|Unexpected|SyntaxError/i)
    expect(generateSimpleParlays).not.toHaveBeenCalled()
    expect(persistFeaturedClearedParlays).not.toHaveBeenCalled()
  })

  test('POST with a non-object JSON body returns 400', async () => {
    const res = await postGenerate(new Request('http://localhost/api/parlays/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Request body must be a JSON object')
  })

  test('GET featured=1 without admin auth generates for display and does not persist', async () => {
    await withCronSecret('test-cron-secret', async () => {
      const res = await getGenerate(new Request(
        'http://localhost/api/parlays/generate?sport=mlb&type=single_game&featured=1',
      ))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.parlays).toEqual([{ id: 'live-card', legs: [] }])
      expect(body.fromSnapshot).toBe(false)
      expect(generateSimpleParlays).toHaveBeenCalled()
      expect(persistFeaturedClearedParlays).not.toHaveBeenCalled()
    })
  })

  test('GET featured=1 with CRON_SECRET persists when the slot is empty', async () => {
    await withCronSecret('test-cron-secret', async () => {
      const res = await getGenerate(new Request(
        'http://localhost/api/parlays/generate?sport=mlb&type=single_game&featured=1',
        { headers: { authorization: 'Bearer test-cron-secret' } },
      ))
      expect(res.status).toBe(200)
      expect(persistFeaturedClearedParlays).toHaveBeenCalledTimes(1)
    })
  })

  test('GET featured=1 serves an existing snapshot and never writes', async () => {
    loadFeaturedSnapshotCard.mockResolvedValue({ id: 'snapped', legs: [] })
    await withCronSecret('test-cron-secret', async () => {
      const res = await getGenerate(new Request(
        'http://localhost/api/parlays/generate?sport=mlb&type=single_game&featured=1',
      ))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.fromSnapshot).toBe(true)
      expect(body.parlays).toEqual([{ id: 'snapped', legs: [] }])
      expect(generateSimpleParlays).not.toHaveBeenCalled()
      expect(persistFeaturedClearedParlays).not.toHaveBeenCalled()
    })
  })

  test('POST featured without admin auth does not persist', async () => {
    await withCronSecret('test-cron-secret', async () => {
      const res = await postGenerate(new Request('http://localhost/api/parlays/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sport: 'mlb', type: 'single_game', featured: true }),
      }))
      expect(res.status).toBe(200)
      expect(persistFeaturedClearedParlays).not.toHaveBeenCalled()
    })
  })
})
