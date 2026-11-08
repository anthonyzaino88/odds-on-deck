import { spawnSync } from 'node:child_process'
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

  test('accessors are skipped and a throwing getter never runs', () => {
    let reads = 0
    const error = new Error('boom')
    Object.defineProperty(error, 'quota', {
      enumerable: true,
      get() { reads += 1; throw new Error('quota getter') },
    })
    Object.defineProperty(error, 'apiKey', {
      enumerable: true,
      get() { reads += 1; throw new Error('apiKey getter') },
    })
    expect(() => sanitizeOddsApiError(error)).not.toThrow()
    expect(() => sanitizeLoggedValue(error)).not.toThrow()
    const plain = {}
    Object.defineProperty(plain, 'password', {
      enumerable: true,
      get() { reads += 1; throw new Error('password getter') },
    })
    expect(sanitizeLoggedValue(plain).password).toBe('[redacted]')
    expect(reads).toBe(0)
  })

  test('exact env secrets are removed before patterns, including encoded forms', () => {
    const previous = {
      ODDS_API_KEY: process.env.ODDS_API_KEY,
      CRON_SECRET: process.env.CRON_SECRET,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      SERVICE_TOKEN: process.env.SERVICE_TOKEN,
      DATABASE_URL: process.env.DATABASE_URL,
      DIRECT_URL: process.env.DIRECT_URL,
      TINY_TOKEN: process.env.TINY_TOKEN,
    }
    const odds = 'odds-key-fake-991'
    const cron = 'line1\nline2-secret'
    const service = 'service-token-fake'
    const dbPassword = 'db-password-fake-1'
    process.env.ODDS_API_KEY = odds
    process.env.CRON_SECRET = cron
    process.env.SUPABASE_SECRET_KEY = 'supabase-secret-fake'
    process.env.SERVICE_TOKEN = service
    process.env.DATABASE_URL = `postgresql://app:${dbPassword}@localhost:5432/odds`
    process.env.DIRECT_URL = 'postgres://app:direct-password-fake@localhost/odds'
    process.env.TINY_TOKEN = 'short'
    try {
      const encoded = encodeURIComponent(odds)
      const b64 = Buffer.from(cron, 'utf8').toString('base64')
      const escaped = JSON.stringify(cron).slice(1, -1)
      const text = `raw ${odds} enc ${encoded} b64 ${b64} json ${escaped} db ${dbPassword} direct direct-password-fake token ${service} tiny short`
      const out = sanitizeOddsApiLogText(text)
      expect(out).not.toContain(odds)
      expect(out).not.toContain(encoded)
      expect(out).not.toContain(b64)
      expect(out).not.toContain('line2-secret')
      expect(out).not.toContain(dbPassword)
      expect(out).not.toContain('direct-password-fake')
      expect(out).not.toContain(service)
      expect(out).toContain('tiny short')
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value == null) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  test('quoted secrets, unicode-escaped keys, and truncation do not leave a partial secret', () => {
    const secret = 'quoted-secret-value'
    const previous = process.env.CRON_SECRET
    process.env.CRON_SECRET = secret
    try {
      expect(sanitizeOddsApiLogText('{"apiKey":\n"quoted-secret-value"}')).toBe('{"apiKey":\n"[redacted]"}')
      expect(sanitizeOddsApiLogText('{"apiKey":   "quoted-secret-value"}')).toBe('{"apiKey":   "[redacted]"}')
      expect(sanitizeOddsApiLogText('{"api\\u004bey":"quoted-secret-value"}')).toBe('{"api\\u004bey":"[redacted]"}')
      const cause = new Error(`cause ${secret}`)
      const error = new Error(`message ${secret}`)
      error.cause = cause
      Object.defineProperty(error, 'stack', {
        configurable: true,
        enumerable: false,
        value: `stack line ${secret}`,
      })
      const safe = sanitizeOddsApiError(error)
      expect(safe.message).not.toContain(secret)
      expect(safe.cause.message).not.toContain(secret)
      expect(safe.stack).not.toContain(secret)
      expect(safe.stack).toContain('[redacted]')
      const max = 32 * 1024
      const filler = 'x'.repeat(max - 5)
      const out = sanitizeOddsApiLogText(`${filler}"${secret}"`)
      expect(out).toBe(filler)
      expect(out).not.toContain(secret)
      expect(out.length).toBeLessThanOrEqual(max)
      const straddling = `${'y'.repeat(max - 4)}${secret}`
      const cut = sanitizeOddsApiLogText(straddling)
      expect(cut).toBe('y'.repeat(max - 4))
      expect(cut).not.toContain(secret)
      expect(cut).not.toContain('[red')
    } finally {
      if (previous == null) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = previous
    }
  })

  test('fragments, path secrets, repeated at-signs, and protocol-relative userinfo are masked', () => {
    const jwt = JWT
    expect(sanitizeOddsApiLogText(`https://host/cb#access_token=${jwt}`)).toBe('https://host/cb#[redacted]')
    expect(sanitizeOddsApiLogText('https://host/cb#CRON_SECRET=cron-secret-fake-1')).toBe('https://host/cb#[redacted]')
    expect(sanitizeOddsApiLogText(`https://proj.supabase.co/storage/v1/${SECRET}/file`)).toBe('https://proj.supabase.co/storage/v1/sb_secret_[redacted]/file')
    expect(sanitizeOddsApiLogText('https://user:p@ssword@host/path')).toBe('https://[redacted]@host/path')
    expect(sanitizeOddsApiLogText('https://user:p@ssword@host/path')).not.toContain('ssword')
    expect(sanitizeOddsApiLogText('//user:pw@host/path')).toBe('//[redacted]@host/path')
  })

  test('built-in errors keep their type and a sparse array can be stringified', () => {
    const secret = 'builtin-secret-value'
    const previous = process.env.ODDS_API_KEY
    process.env.ODDS_API_KEY = secret
    try {
      const typed = sanitizeOddsApiError(new TypeError(`bad ${secret}`))
      expect(typed).toBeInstanceOf(TypeError)
      expect(typed.name).toBe('TypeError')
      expect(typed.constructor).toBe(TypeError)
      expect(typed.message).toBe('bad [redacted]')
      const proto = DOMException.prototype
      const messageDesc = Object.getOwnPropertyDescriptor(proto, 'message')
      const nameDesc = Object.getOwnPropertyDescriptor(proto, 'name')
      const abortedInput = new DOMException(`stopped ${secret}`, 'AbortError')
      let inheritedReads = 0
      Object.defineProperty(proto, 'message', {
        configurable: true,
        enumerable: messageDesc.enumerable,
        get() {
          if (this === abortedInput) inheritedReads += 1
          return messageDesc.get.call(this)
        },
      })
      Object.defineProperty(proto, 'name', {
        configurable: true,
        enumerable: nameDesc.enumerable,
        get() {
          if (this === abortedInput) inheritedReads += 1
          return nameDesc.get.call(this)
        },
      })
      try {
        const aborted = sanitizeOddsApiError(abortedInput)
        expect(aborted).toBeInstanceOf(DOMException)
        expect(aborted.constructor).toBe(DOMException)
        expect(aborted.message).not.toContain(secret)
        expect(inheritedReads).toBe(0)
      } finally {
        Object.defineProperty(proto, 'message', messageDesc)
        Object.defineProperty(proto, 'name', nameDesc)
      }
      const sparse = []
      sparse[0] = 'keep'
      sparse[100000] = secret
      const safe = sanitizeLoggedValue(sparse)
      expect(safe.length).toBeUndefined()
      expect(() => JSON.stringify(safe)).not.toThrow()
      expect(JSON.stringify(safe)).not.toContain(secret)
      expect(JSON.stringify(safe).length).toBeLessThan(200)
    } finally {
      if (previous == null) delete process.env.ODDS_API_KEY
      else process.env.ODDS_API_KEY = previous
    }
  })

  test('redaction finishes before the length cut, including a JWT that crosses it', () => {
    const max = 32 * 1024
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturevalue'
    const head = 'a'.repeat(max - 8)
    const out = sanitizeOddsApiLogText(head + jwt)
    expect(out.length).toBeLessThanOrEqual(max)
    expect(out).not.toContain('eyJ')
    expect(out).not.toContain('signaturevalue')
    expect(out).not.toContain(jwt.slice(0, 8))
  })

  test('unterminated quoted bearer tokens and jwt forms redact with no env secrets', () => {
    const script = `
      import { sanitizeOddsApiLogText } from './lib/sanitize-error.js'
      const three = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturevalue'
      const two = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0'
      const cases = [
        ['Authorization: Bearer "unterminated-bearer-token', 'unterminated-bearer-token'],
        ['Bearer "unterminated-bearer-token', 'unterminated-bearer-token'],
        ['see ' + three, 'signaturevalue'],
        ['https://cdn.example/v1/' + three + '/file', 'signaturevalue'],
        ['https://host/cb#' + three, 'eyJzdWIi'],
        ['#' + two, 'eyJzdWIi'],
        ['https://host/p/' + two + '/x', 'eyJzdWIi'],
        ['partial ' + two, 'eyJzdWIi'],
      ]
      const out = cases.map(([input, leak]) => {
        const text = sanitizeOddsApiLogText(input)
        return { text, leaked: text.includes(leak) || text.includes('eyJ') }
      })
      process.stdout.write(JSON.stringify(out))
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' },
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    const rows = JSON.parse(result.stdout)
    for (const row of rows) expect(row.leaked).toBe(false)
    expect(rows[0].text).toBe('Authorization: Bearer [redacted]')
    expect(rows[1].text).toBe('Bearer [redacted]')
    expect(rows[3].text).toBe('https://cdn.example/v1/[redacted]/file')
    expect(rows[4].text).toBe('https://host/cb#[redacted]')
    expect(rows[5].text).toBe('#[redacted]')
  })

  test('exact values match percent-encoding case, JSON unicode escapes, and property names', () => {
    const previous = {
      CRON_SECRET: process.env.CRON_SECRET,
      SERVICE_TOKEN: process.env.SERVICE_TOKEN,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    }
    const slashSecret = 'cron/secret'
    const unicodeSecret = 'abc-defg'
    const keySecret = 'bucket-label-99'
    process.env.CRON_SECRET = slashSecret
    process.env.SERVICE_TOKEN = unicodeSecret
    process.env.SUPABASE_SECRET_KEY = keySecret
    try {
      const lower = encodeURIComponent(slashSecret).toLowerCase()
      const mixed = encodeURIComponent(slashSecret).replace('%2F', '%2f')
      expect(sanitizeOddsApiLogText(`encoded ${lower} and ${mixed}`)).not.toContain('cron')
      expect(sanitizeOddsApiLogText('abc\\u002ddefg')).not.toContain('abc\\u002ddefg')
      expect(sanitizeOddsApiLogText('abc\\u002Ddefg')).not.toContain('002D')
      const safe = sanitizeLoggedValue({ [keySecret]: 'kept', other: keySecret })
      expect(JSON.stringify(safe)).not.toContain(keySecret)
      expect(safe['[redacted]']).toBe('kept')
      expect(safe.other).toBe('[redacted]')
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value == null) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  test('secret env names stay in the server-only module', () => {
    const client = [
      readFileSync(require.resolve('../../lib/sanitize-error.client.js'), 'utf8'),
      readFileSync(require.resolve('../../lib/sanitize-error.cjs'), 'utf8'),
    ].join('\n')
    expect(client).not.toMatch(/ODDS_API_KEY|CRON_SECRET|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|DIRECT_URL/)
    const secrets = readFileSync(require.resolve('../../lib/sanitize-secrets.js'), 'utf8')
    expect(secrets).toMatch(/import 'server-only'/)
    const names = readFileSync(require.resolve('../../lib/sanitize-secrets.cjs'), 'utf8')
    expect(names).toMatch(/ODDS_API_KEY/)
    expect(names).toMatch(/DATABASE_URL/)
  })

  test('inherited accessors are not executed', () => {
    const proto = {}
    let reads = 0
    Object.defineProperty(proto, 'token', {
      enumerable: true,
      get() { reads += 1; return 'inherited-secret-value' },
    })
    const obj = Object.create(proto)
    obj.note = 'visible'
    const safe = sanitizeLoggedValue(obj)
    expect(reads).toBe(0)
    expect(safe.note).toBe('visible')
    expect(JSON.stringify(safe)).not.toContain('inherited-secret-value')
  })

  test('malformed nested JSON is scanned in linear time', () => {
    const text = '{"apiKey":'.repeat(4000)
    const started = Date.now()
    const out = sanitizeOddsApiLogText(text)
    expect(Date.now() - started).toBeLessThan(80)
    expect(out.length).toBeLessThan(text.length)
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
