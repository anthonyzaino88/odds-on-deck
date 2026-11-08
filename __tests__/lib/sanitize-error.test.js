import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { sanitizeLoggedValue, sanitizeOddsApiError, sanitizeOddsApiLogText, sanitizedErrorMessage } from '../../lib/sanitize-error.js'
import { sanitizeOddsApiLogText as fromBudget } from '../../lib/odds-api-budget.js'

const require = createRequire(__filename)

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

  test('sensitive object keys and quoted JSON assignments are masked', () => {
    const row = sanitizeLoggedValue({
      apiKey: 'k-api',
      api_key: 'k-snake',
      key: 'k-key',
      token: 'k-token',
      secret: 'k-secret',
      password: 'k-password',
      authorization: 'k-auth',
      cookie: 'k-cookie',
      'x-cron-secret': 'k-cron',
      CRON_SECRET: 'k-cron-secret',
      ODDS_API_KEY: 'k-odds',
      sport: 'nfl',
    })
    expect(row.sport).toBe('nfl')
    for (const key of ['apiKey', 'api_key', 'key', 'token', 'secret', 'password', 'authorization', 'cookie', 'x-cron-secret', 'CRON_SECRET', 'ODDS_API_KEY']) {
      expect(row[key]).toBe('[redacted]')
    }
    expect(JSON.stringify(row)).not.toContain('k-')
    expect(sanitizeOddsApiLogText('{"apiKey":"x","CRON_SECRET":"x"}')).toBe('{"apiKey":"[redacted]","CRON_SECRET":"[redacted]"}')
  })

  test('a bearer token is masked even when it already starts with [redacted]', () => {
    expect(sanitizeOddsApiLogText('Bearer [redacted]x')).toBe('Bearer [redacted]')
    expect(sanitizeOddsApiLogText('Bearer [redacted]x')).not.toContain('x')
    expect(sanitizeOddsApiLogText('Authorization: Bearer [redacted]still-secret')).toBe('Authorization: Bearer [redacted]')
    expect(sanitizeOddsApiLogText('Authorization: Bearer [redacted]still-secret')).not.toContain('still-secret')
  })

  test('urls lose userinfo, every query mark, and postgres passwords with special characters', () => {
    expect(sanitizeOddsApiLogText('https://user:pw@host/path')).toBe('https://[redacted]@host/path')
    expect(sanitizeOddsApiLogText('https://user:pw@host/path')).not.toContain('pw')
    expect(sanitizeOddsApiLogText('https://host/path?auth=x?y=1')).toBe('https://host/path?[redacted]')
    expect(sanitizeOddsApiLogText('?auth=x?y=1')).toBe('?[redacted]')
    const postgres = 'postgresql://user:p)ss@host/db'
    expect(sanitizeOddsApiLogText(postgres)).toBe('postgresql://[redacted]')
    expect(sanitizeOddsApiLogText(postgres)).not.toContain('p)ss')
    expect(sanitizeOddsApiLogText('https://user:p)w@host/x')).toBe('https://[redacted]@host/x')
  })

  test('quota metadata is a fresh tree and cannot reach the original error', () => {
    const error = new Error('boom')
    error.quota = { original: error, apiKey: 'secret-key', remaining: 9 }
    const safe = sanitizeOddsApiError(error)
    expect(safe).not.toBe(error)
    expect(safe.quota).not.toBe(error.quota)
    expect(safe.quota.remaining).toBe(9)
    expect(safe.quota.apiKey).toBe('[redacted]')
    expect(safe.quota.original).not.toBe(error)
    const seen = new Set()
    const reaches = (node) => {
      if (node === error) return true
      if (!node || typeof node !== 'object' || seen.has(node)) return false
      seen.add(node)
      return Object.values(node).some((value) => reaches(value))
    }
    expect(reaches(safe)).toBe(false)
    expect(error.quota.apiKey).toBe('secret-key')
  })

  test('throwing getters fall back to a placeholder and the sanitizer does not throw', () => {
    const error = new Error('boom')
    Object.defineProperty(error, 'quota', {
      enumerable: true,
      get() { throw new Error('quota getter') },
    })
    Object.defineProperty(error, 'apiKey', {
      enumerable: true,
      get() { throw new Error('apiKey getter') },
    })
    expect(() => sanitizeOddsApiError(error)).not.toThrow()
    expect(() => sanitizeLoggedValue(error)).not.toThrow()
    const plain = {}
    Object.defineProperty(plain, 'password', {
      enumerable: true,
      get() { throw new Error('password getter') },
    })
    expect(sanitizeLoggedValue(plain).password).toBe('[redacted]')
  })

  test('long slash strings and wide objects stay fast', () => {
    const slashesStarted = Date.now()
    sanitizeOddsApiLogText('/'.repeat(24 * 1024))
    expect(Date.now() - slashesStarted).toBeLessThan(80)
    const wide = {}
    for (let i = 0; i < 100000; i += 1) wide[`k${i}`] = `secret-${i}`
    const wideStarted = Date.now()
    const safe = sanitizeLoggedValue(wide)
    expect(Date.now() - wideStarted).toBeLessThan(100)
    expect(Object.keys(safe).length).toBeLessThanOrEqual(32)
  })

  test('the commonjs entry loads without esm syntax', () => {
    const source = readFileSync(require.resolve('../../lib/sanitize-error.cjs'), 'utf8')
    expect(source).toContain('module.exports')
    expect(source).not.toMatch(/\bexport\s/)
    const loaded = require('../../lib/sanitize-error.cjs')
    expect(loaded.sanitizeOddsApiLogText('Bearer secret-token')).toBe('Bearer [redacted]')
    expect(loaded.sanitizeLoggedValue).toBe(sanitizeLoggedValue)
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
