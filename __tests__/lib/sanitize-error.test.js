import { sanitizeLoggedValue, sanitizeOddsApiError, sanitizeOddsApiLogText, sanitizedErrorMessage } from '../../lib/sanitize-error.js'
import { sanitizeOddsApiLogText as fromBudget } from '../../lib/odds-api-budget.js'

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signaturepart'
const SECRET = 'sb_secret_abcdefghijklmnopqrstuvwxyz'
const POOLER = 'postgresql://postgres.abc:super-db-pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require'

describe('sanitize-error', () => {
  test('the budget module re-exports the shared scrubber', () => {
    expect(fromBudget).toBe(sanitizeOddsApiLogText)
  })

  test('redacts postgres URLs, service keys, JWTs, and bearer tokens', () => {
    const text = [
      `connect ${POOLER}`,
      'postgres://app:pw@localhost:5432/odds',
      SECRET,
      JWT,
      'Authorization: Bearer TOKEN',
      'https://abccompany.supabase.co/rest/v1/Game',
      'sb_publishable_publickeyvalue0001',
    ].join(' ')
    const out = sanitizeOddsApiLogText(text)
    expect(out).toContain('postgresql://[redacted]')
    expect(out).toContain('postgres://[redacted]')
    expect(out).toContain('sb_secret_[redacted]')
    expect(out).toContain('Authorization: Bearer [redacted]')
    expect(out).toContain('https://abccompany.supabase.co/rest/v1/Game')
    expect(out).toContain('sb_publishable_publickeyvalue0001')
    expect(out).not.toContain('super-db-pass')
    expect(out).not.toContain('sslmode=require')
    expect(out).not.toContain('pw@localhost')
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(out).not.toContain('signaturepart')
    expect(out).not.toContain('eyJhbGci')
    expect(out).not.toContain('Bearer TOKEN')
  })

  test('a second pass does not eat an already redacted bearer token', () => {
    const once = sanitizeOddsApiLogText('Authorization: Bearer TOKEN')
    expect(sanitizeOddsApiLogText(once)).toBe('Authorization: Bearer [redacted]')
  })

  test('a logged supabase error keeps its code and drops credentials', () => {
    const row = {
      message: `password authentication failed for ${POOLER}`,
      details: SECRET,
      hint: JWT,
      code: '28P01',
    }
    const safe = sanitizeLoggedValue(row)
    expect(safe).not.toBe(row)
    expect(safe.code).toBe('28P01')
    expect(safe.message).toBe('password authentication failed for postgresql://[redacted]')
    expect(safe.details).toBe('sb_secret_[redacted]')
    expect(safe.hint).toBe('[redacted]')
    expect(JSON.stringify(safe)).not.toContain('super-db-pass')
    expect(JSON.stringify(safe)).not.toContain(SECRET.slice('sb_secret_'.length))
    expect(row.details).toBe(SECRET)
  })

  test('a thrown wrapper message is scrubbed and the original error is left intact', () => {
    const error = new Error(`connect failed ${POOLER} ${JWT}`)
    const wrapped = new Error(`db write failed: ${sanitizedErrorMessage(error)}`)
    expect(wrapped.message).toBe('db write failed: connect failed postgresql://[redacted] [redacted]')
    expect(error.message).toContain('super-db-pass')
    expect(error.message).toContain('signaturepart')
    const safe = sanitizeOddsApiError(error)
    expect(safe).not.toBe(error)
    expect(safe.stack || '').not.toContain('super-db-pass')
  })
})
