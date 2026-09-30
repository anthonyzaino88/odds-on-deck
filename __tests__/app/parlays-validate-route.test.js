import { POST as validateFeaturedParlays } from '../../app/api/parlays/validate/route.js'
import { capturedQueries } from './parlays-validate-route-mock.js'

jest.mock('../../lib/api-security.js', () => ({
  isAuthorizedAdmin: () => true,
  unauthorized: () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
  serverError: () => new Response(JSON.stringify({ error: 'server' }), { status: 500 }),
}))

jest.mock('../../lib/supabase-admin.js', () => {
  const { makeSupabaseAdmin } = require('./parlays-validate-route-mock.js')
  return { supabaseAdmin: makeSupabaseAdmin() }
})

describe('POST /api/parlays/validate', () => {
  test('loads PropValidation by playerName and gameIdRef, not playerName alone', async () => {
    capturedQueries.length = 0
    const res = await validateFeaturedParlays(new Request('http://localhost/api/parlays/validate', {
      method: 'POST',
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    const pvIns = capturedQueries.filter((row) => row.kind === 'PropValidation')
    expect(pvIns.some((row) => row.op === 'in' && row.column === 'playerName')).toBe(true)
    expect(pvIns.some((row) => row.op === 'in' && row.column === 'gameIdRef')).toBe(true)
    expect(pvIns.find((row) => row.column === 'gameIdRef').value).toEqual(['DET_at_CHI_2026-09-20'])
  })
})
