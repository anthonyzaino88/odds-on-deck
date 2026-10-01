import { readFileSync } from 'fs'
import { join } from 'path'
import { getValidationRecords } from '../../lib/validation.js'
import { generateSimpleParlays } from '../../lib/simple-parlay-generator.js'
import { GET as getValidation } from '../../app/api/validation/route.js'
import { GET as getGenerate, POST as postGenerate } from '../../app/api/parlays/generate/route.js'

jest.mock('../../lib/validation.js', () => ({
  getValidationStats: jest.fn(async () => ({})),
  getValidationRecords: jest.fn(async () => []),
  getAccuracyByEdge: jest.fn(async () => ({})),
  getMostAccuratePropTypes: jest.fn(async () => []),
}))

jest.mock('../../lib/simple-parlay-generator.js', () => ({
  generateSimpleParlays: jest.fn(async () => []),
}))

jest.mock('../../lib/featured-parlay-persist.js', () => ({
  loadFeaturedSnapshotCard: jest.fn(async () => null),
  persistFeaturedClearedParlays: jest.fn(async () => []),
}))

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8')

describe('GET /api/validation records', () => {
  beforeEach(() => {
    getValidationRecords.mockReset()
    getValidationRecords.mockResolvedValue([])
  })

  test('status=pending returns 400 and does not load records', async () => {
    const res = await getValidation(new Request('http://localhost/api/validation?type=records&status=pending'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/pending/i)
    expect(getValidationRecords).not.toHaveBeenCalled()
  })

  test.each([
    ['0', 100],
    ['NaN', 100],
    ['-5', 100],
    ['500', 200],
  ])('limit=%s is clamped to %s and excludes pending', async (raw, expected) => {
    const res = await getValidation(new Request(`http://localhost/api/validation?type=records&limit=${raw}`))
    expect(res.status).toBe(200)
    expect(getValidationRecords).toHaveBeenCalledTimes(1)
    expect(getValidationRecords).toHaveBeenCalledWith(expect.objectContaining({
      limit: expected,
      excludePending: true,
    }))
  })

  test('missing limit defaults to 100 and still excludes pending', async () => {
    const res = await getValidation(new Request('http://localhost/api/validation?type=records'))
    expect(res.status).toBe(200)
    expect(getValidationRecords).toHaveBeenCalledWith(expect.objectContaining({
      limit: 100,
      excludePending: true,
    }))
  })
})

describe('GET/POST /api/parlays/generate clamps', () => {
  beforeEach(() => {
    generateSimpleParlays.mockReset()
    generateSimpleParlays.mockResolvedValue([])
  })

  test('GET clamps legs=-1 and maxParlays=999 before generate', async () => {
    const res = await getGenerate(new Request('http://localhost/api/parlays/generate?sport=mlb&legs=-1&maxParlays=999'))
    expect(res.status).toBe(200)
    expect(generateSimpleParlays).toHaveBeenCalledWith(expect.objectContaining({
      legCount: 2,
      maxParlays: 20,
      featured: false,
    }))
  })

  test('GET clamps legs=10 to 6', async () => {
    const res = await getGenerate(new Request('http://localhost/api/parlays/generate?sport=mlb&legs=10&maxParlays=1'))
    expect(res.status).toBe(200)
    expect(generateSimpleParlays).toHaveBeenCalledWith(expect.objectContaining({
      legCount: 6,
      maxParlays: 1,
    }))
  })

  test('POST truncates fractional legCount before clamping', async () => {
    const res = await postGenerate(new Request('http://localhost/api/parlays/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sport: 'mlb',
        type: 'multi_game',
        legCount: 2.5,
        maxParlays: 4.8,
      }),
    }))
    expect(res.status).toBe(200)
    expect(generateSimpleParlays).toHaveBeenCalledWith(expect.objectContaining({
      legCount: 2,
      maxParlays: 4,
    }))
  })

  test('POST clamps legs and maxParlays the same way', async () => {
    const res = await postGenerate(new Request('http://localhost/api/parlays/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sport: 'mlb',
        type: 'multi_game',
        legCount: -1,
        maxParlays: 50,
      }),
    }))
    expect(res.status).toBe(200)
    expect(generateSimpleParlays).toHaveBeenCalledWith(expect.objectContaining({
      legCount: 2,
      maxParlays: 20,
      featured: false,
    }))
  })

  test('GET featured=1 still uses FEATURED_LEG_COUNT and maxParlays=1', async () => {
    const res = await getGenerate(new Request(
      'http://localhost/api/parlays/generate?sport=mlb&legs=3&maxParlays=1&type=single_game&featured=1'
    ))
    expect(res.status).toBe(200)
    expect(generateSimpleParlays).toHaveBeenCalledWith(expect.objectContaining({
      sport: 'mlb',
      type: 'single_game',
      legCount: 3,
      maxParlays: 1,
      featured: true,
    }))
  })
})

describe('public read-path contracts', () => {
  test('public validation page and API pass excludePending; admin update-result does not', () => {
    const page = read('app/validation/page.js')
    const api = read('app/api/validation/route.js')
    const admin = read('app/api/validation/update-result/route.js')
    const lib = read('lib/validation.js')
    expect(page).toMatch(/getValidationRecords\(\{ limit: 50, excludePending: true \}\)/)
    expect(api).toMatch(/excludePending: true/)
    expect(api).toMatch(/parsePublicValidationStatus/)
    expect(api).toMatch(/clampValidationLimit/)
    expect(admin).toMatch(/getValidationRecords\(\{ gameId, status: 'pending' \}\)/)
    expect(admin).not.toMatch(/excludePending/)
    expect(lib).toMatch(/else if \(options\.excludePending\)/)
    expect(lib).toMatch(/\.in\('status', PUBLIC_VALIDATION_STATUSES\)/)
    expect(lib).not.toMatch(/neq\('status', 'pending'\)/)
    expect(lib.match(/query = applyValidationRecordFilters\(query, options\)/g).length).toBe(2)
  })

  test('generate GET and POST both clamp legs and maxParlays', () => {
    const route = read('app/api/parlays/generate/route.js')
    expect(route).toMatch(/clampParlayLegs\(rawLegCount\)/)
    expect(route).toMatch(/clampMaxParlays\(rawMaxParlays\)/)
    expect(route).toMatch(/clampParlayLegs\(searchParams\.get\('legs'\)\)/)
    expect(route).toMatch(/clampMaxParlays\(searchParams\.get\('maxParlays'\)\)/)
    expect(route).not.toMatch(/Leg count must be between 2 and 10/)
  })

  test('history and props apply upper caps', () => {
    expect(read('app/api/parlays/history/route.js')).toMatch(/clampHistoryLimit/)
    expect(read('app/api/props/route.js')).toMatch(/clampPropsLimit/)
  })
})
