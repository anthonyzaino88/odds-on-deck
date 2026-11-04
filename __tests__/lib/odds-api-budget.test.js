import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_DAILY_CREDIT_CAP,
  DEFAULT_MONTHLY_CREDIT_CAP,
  DEFAULT_REMAINING_FLOOR,
  createOddsApiBudget,
  estimateCreditsFromOddsEndpoint,
  fetchOddsApiJson,
  formatOddsBudgetStatus,
  parseEnvNonNegInt,
  parseOddsApiQuota,
  readOddsBudgetConfig,
  redactOddsApiKey,
  stripOddsApiKeyFromUrl,
} from '../../lib/odds-api-budget.js'

function headerMap(values) {
  return {
    get: (name) => values[name] || values[String(name).toLowerCase()] || null,
  }
}

function memoryFs(files = new Map()) {
  return {
    files,
    existsSync: (p) => files.has(p),
    mkdirSync() {},
    writeFileSync(p, data) { files.set(p, String(data)) },
    readFileSync(p) {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`)
      return files.get(p)
    },
    renameSync(from, to) {
      files.set(to, files.get(from))
      files.delete(from)
    },
  }
}

describe('parseOddsApiQuota', () => {
  test('reads remaining, used, and last from Headers-like objects', () => {
    expect(parseOddsApiQuota(headerMap({
      'x-requests-remaining': '18420',
      'x-requests-used': '1580',
      'x-requests-last': '5',
    }))).toEqual({ remaining: 18420, used: 1580, last: 5 })
  })

  test('missing headers are null, not zero', () => {
    expect(parseOddsApiQuota(headerMap({}))).toEqual({
      remaining: null,
      used: null,
      last: null,
    })
  })
})

describe('estimateCreditsFromOddsEndpoint', () => {
  test('counts markets and treats the sports list as free', () => {
    expect(estimateCreditsFromOddsEndpoint(
      '/v4/sports/americanfootball_nfl/odds?regions=us&markets=h2h,spreads,totals',
    )).toBe(3)
    expect(estimateCreditsFromOddsEndpoint(
      'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/abc/odds?markets=player_pass_yds,player_rush_yds,player_receptions,player_reception_yds,player_pass_tds&apiKey=secret',
    )).toBe(5)
    expect(estimateCreditsFromOddsEndpoint('https://api.the-odds-api.com/v4/sports?apiKey=secret')).toBe(0)
  })
})

describe('redaction', () => {
  test('strips apiKey from URLs and log text', () => {
    const key = 'super-secret-key'
    expect(stripOddsApiKeyFromUrl(`https://api.the-odds-api.com/v4/sports?apiKey=${key}`))
      .toBe('https://api.the-odds-api.com/v4/sports?apiKey=[redacted]')
    expect(redactOddsApiKey(`Odds API 401: invalid ${key}`, key)).toBe('Odds API 401: invalid [redacted]')
    expect(redactOddsApiKey('no secret here', key)).toBe('no secret here')
  })
})

describe('readOddsBudgetConfig', () => {
  test('uses safe defaults and ignores invalid env', () => {
    expect(readOddsBudgetConfig({})).toEqual({
      dailyCap: DEFAULT_DAILY_CREDIT_CAP,
      monthlyCap: DEFAULT_MONTHLY_CREDIT_CAP,
      remainingFloor: DEFAULT_REMAINING_FLOOR,
      persistPath: '.local/odds-api-budget.json',
    })
    expect(parseEnvNonNegInt('nope', 7)).toBe(7)
    expect(readOddsBudgetConfig({
      ODDS_DAILY_CREDIT_CAP: '200',
      ODDS_MONTHLY_CREDIT_CAP: '9000',
      ODDS_REMAINING_FLOOR: '4000',
      ODDS_BUDGET_PATH: '/tmp/budget.json',
    })).toMatchObject({
      dailyCap: 200,
      monthlyCap: 9000,
      remainingFloor: 4000,
      persistPath: '/tmp/budget.json',
    })
  })
})

describe('createOddsApiBudget', () => {
  test('skips when remaining would fall under the floor', () => {
    const logs = []
    const budget = createOddsApiBudget({
      persist: false,
      log: { log: (msg) => logs.push(msg) },
      state: { lastRemaining: 3002, lastUsed: 1000 },
    })
    expect(budget.allow(1)).toBe(true)
    expect(budget.allow(5)).toBe(false)
    expect(budget.status()).toBe('floor')
    expect(formatOddsBudgetStatus(budget.status())).toBe('ODDS_BUDGET_STATUS=floor')
  })

  test('skips when the daily cap would be crossed and persists the day', () => {
    const fs = memoryFs()
    const budget = createOddsApiBudget({
      env: { ODDS_DAILY_CREDIT_CAP: '10', JEST_WORKER_ID: '1' },
      persist: true,
      filesystem: fs,
      now: new Date('2026-11-04T16:00:00.000Z'),
      log: { log() {} },
      state: { days: { '2026-11-04': { credits: 8, calls: 2 } } },
    })
    expect(budget.allow(2)).toBe(true)
    budget.record({ remaining: 18000, used: 2000, last: 2 })
    expect(budget.todayCredits()).toBe(10)
    expect(budget.allow(1)).toBe(false)
    expect(budget.status()).toBe('daily_cap')
    const saved = [...fs.files.values()].find((value) => String(value).includes('2026-11-04'))
    expect(saved).toMatch(/"credits": 10/)
    expect(saved).not.toMatch(/apiKey/)
    expect(saved).not.toMatch(/secret/)
  })

  test('skips when month-to-date used would exceed the monthly cap', () => {
    const budget = createOddsApiBudget({
      persist: false,
      env: { ODDS_MONTHLY_CREDIT_CAP: '17000' },
      log: { log() {} },
      state: { lastRemaining: 4000, lastUsed: 16998 },
    })
    expect(budget.allow(5)).toBe(false)
    expect(budget.status()).toBe('monthly_cap')
  })

  test('logs remaining without the API key', () => {
    const logs = []
    const budget = createOddsApiBudget({
      persist: false,
      apiKey: 'secret-key-value',
      log: { log: (msg) => logs.push(msg) },
    })
    budget.record({
      remaining: 18420,
      used: 1580,
      last: 5,
    })
    budget.logSummary()
    const text = logs.join('\n')
    expect(text).toMatch(/remaining=18420/)
    expect(text).toMatch(/last=5/)
    expect(text).toMatch(/ODDS_BUDGET_STATUS=ok/)
    expect(text).toMatch(/ODDS_CREDITS_USED=5/)
    expect(text).toMatch(/ODDS_CREDITS_REMAINING=18420/)
    expect(text).not.toMatch(/secret-key-value/)
  })
})

describe('fetchOddsApiJson', () => {
  test('records headers and skips the next call when the floor would be crossed', async () => {
    const logs = []
    const budget = createOddsApiBudget({
      persist: false,
      log: { log: (msg) => logs.push(msg) },
      state: { lastRemaining: 3005, lastUsed: 100 },
    })
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      headers: headerMap({
        'x-requests-remaining': '3000',
        'x-requests-used': '105',
        'x-requests-last': '5',
      }),
      json: async () => ({ ok: true }),
      text: async () => '',
    }))
    const first = await fetchOddsApiJson(
      'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?markets=h2h,spreads,totals,player_pass_yds,player_rush_yds&apiKey=secret-key-value',
      { budget, fetchImpl, estimatedCredits: 5, apiKey: 'secret-key-value', log: { log: (msg) => logs.push(msg) } },
    )
    expect(first.skipped).toBe(false)
    expect(first.data).toEqual({ ok: true })
    expect(first.quota).toEqual({ remaining: 3000, used: 105, last: 5 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const second = await fetchOddsApiJson(
      'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/abc/odds?markets=h2h,spreads,totals&apiKey=secret-key-value',
      { budget, fetchImpl, estimatedCredits: 3, apiKey: 'secret-key-value', log: { log: (msg) => logs.push(msg) } },
    )
    expect(second.skipped).toBe(true)
    expect(second.status).toBe('floor')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(logs.join('\n')).toMatch(/ODDS_BUDGET_STATUS=floor/)
    expect(logs.join('\n')).not.toMatch(/secret-key-value/)
  })
})

describe('ops docs and script wiring', () => {
  test('operations README documents env vars and status lines', () => {
    const readme = readFileSync(join(process.cwd(), 'operations/README.md'), 'utf8')
    expect(readme).toMatch(/ODDS_DAILY_CREDIT_CAP/)
    expect(readme).toMatch(/ODDS_MONTHLY_CREDIT_CAP/)
    expect(readme).toMatch(/ODDS_REMAINING_FLOOR/)
    expect(readme).toMatch(/ODDS_NFL_ADJACENT_PROPS_TTL_HOURS/)
    expect(readme).toMatch(/ODDS_BUDGET_STATUS=ok\|floor\|daily_cap\|monthly_cap/)
    expect(readme).toMatch(/ODDS_CREDITS_USED/)
    expect(readme).toMatch(/ODDS_CREDITS_REMAINING/)
    expect(readme).toMatch(/\.local\/odds-api-budget\.json/)
  })

  test('fetch-live-odds selects Game.date for NFL adjacent cache TTL', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/fetch-live-odds.js'), 'utf8')
    expect(src).toMatch(/select\('id, oddsApiEventId, date'\)/)
    expect(src).toMatch(/propsCacheMaxAgeMs/)
  })
})
