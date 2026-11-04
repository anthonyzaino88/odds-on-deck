import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_CLOSE_CAPTURE_RESERVE,
  DEFAULT_DAILY_CREDIT_CAP,
  DEFAULT_MONTHLY_CREDIT_CAP,
  DEFAULT_PROBE_FAIL_CREDIT_CAP,
  DEFAULT_REMAINING_FLOOR,
  createOddsApiBudget,
  estimateCreditsFromOddsEndpoint,
  fetchOddsApiJson,
  formatOddsBudgetStatus,
  loadOddsBudgetState,
  parseEnvNonNegInt,
  parseOddsApiQuota,
  readOddsBudgetConfig,
  redactOddsApiKey,
  refreshOddsApiQuota,
  resolveOddsBudgetPath,
  runOddsQuotaProbe,
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
    unlinkSync(p) { files.delete(p) },
  }
}

function quietLog() {
  const lines = []
  return {
    lines,
    log: (msg) => lines.push(String(msg)),
    warn: (msg) => lines.push(String(msg)),
  }
}

const NOON_ET = new Date('2026-11-04T16:00:00.000Z')

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
  test('counts markets × regions and treats the sports list as free', () => {
    expect(estimateCreditsFromOddsEndpoint(
      '/v4/sports/americanfootball_nfl/odds?regions=us&markets=h2h,spreads,totals',
    )).toBe(3)
    expect(estimateCreditsFromOddsEndpoint(
      'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/abc/odds?markets=player_pass_yds,player_rush_yds,player_receptions,player_reception_yds,player_pass_tds&apiKey=secret',
    )).toBe(5)
    expect(estimateCreditsFromOddsEndpoint(
      '/v4/sports/americanfootball_nfl/odds?regions=us,us2,us_dfs&markets=h2h,spreads',
    )).toBe(6)
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
      closeCaptureReserve: DEFAULT_CLOSE_CAPTURE_RESERVE,
      probeFailCreditCap: DEFAULT_PROBE_FAIL_CREDIT_CAP,
      persistPath: '.local/odds-api-budget.json',
    })
    expect(parseEnvNonNegInt('nope', 7)).toBe(7)
    expect(readOddsBudgetConfig({
      ODDS_DAILY_CREDIT_CAP: '200',
      ODDS_MONTHLY_CREDIT_CAP: '9000',
      ODDS_REMAINING_FLOOR: '4000',
      ODDS_CLOSE_CAPTURE_RESERVE: '50',
      ODDS_PROBE_FAIL_CREDIT_CAP: '75',
      ODDS_BUDGET_PATH: '/tmp/budget.json',
    })).toMatchObject({
      dailyCap: 200,
      monthlyCap: 9000,
      remainingFloor: 4000,
      closeCaptureReserve: 50,
      probeFailCreditCap: 75,
      persistPath: '/tmp/budget.json',
    })
  })

  test('anchors relative ledger paths to the repo root', () => {
    const resolved = resolveOddsBudgetPath('.local/odds-api-budget.json')
    expect(resolved).toBe(join(process.cwd(), '.local', 'odds-api-budget.json'))
    expect(resolved).toBe(join(__dirname, '../../.local/odds-api-budget.json'))
    expect(resolveOddsBudgetPath('/abs/budget.json')).toBe('/abs/budget.json')
  })
})

describe('createOddsApiBudget', () => {
  test('skips when remaining would fall under the floor', () => {
    const logs = []
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      log: { log: (msg) => logs.push(msg) },
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      state: { lastRemaining: 3002, lastUsed: 1000, quotaDay: '2026-11-04' },
    })
    expect(budget.allow(1)).toBe(true)
    expect(budget.allow(5)).toBe(false)
    expect(budget.status()).toBe('floor')
    expect(formatOddsBudgetStatus(budget.status())).toBe('ODDS_BUDGET_STATUS=floor')
  })

  test('ignores remaining/used saved on a previous ET day', () => {
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      log: { log() {} },
      state: { lastRemaining: 2500, lastUsed: 17000, quotaDay: '2026-11-03' },
    })
    expect(budget.allow(5)).toBe(true)
    expect(budget.status()).toBe('ok')
  })

  test('skips when the daily cap would be crossed and persists the day', () => {
    const fs = memoryFs()
    const budget = createOddsApiBudget({
      env: {
        ODDS_DAILY_CREDIT_CAP: '10',
        ODDS_CLOSE_CAPTURE_RESERVE: '0',
        ODDS_BUDGET_PATH: '/tmp/odds-api-budget.json',
        JEST_WORKER_ID: '1',
      },
      persist: true,
      filesystem: fs,
      now: NOON_ET,
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
    expect([...fs.files.keys()].some((key) => String(key).includes('.tmp'))).toBe(false)
  })

  test('skips when month-to-date used would exceed the monthly cap', () => {
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      env: { ODDS_MONTHLY_CREDIT_CAP: '17000', ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      log: { log() {} },
      state: { lastRemaining: 4000, lastUsed: 16998, quotaDay: '2026-11-04' },
    })
    expect(budget.allow(5)).toBe(false)
    expect(budget.status()).toBe('monthly_cap')
  })

  test('fetch purpose holds back the close-capture reserve', () => {
    const fetchBudget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      purpose: 'fetch',
      env: { ODDS_DAILY_CREDIT_CAP: '1500', ODDS_CLOSE_CAPTURE_RESERVE: '200' },
      log: { log() {} },
      state: { days: { '2026-11-04': { credits: 1300, calls: 10 } } },
    })
    expect(fetchBudget.allow(1)).toBe(false)
    expect(fetchBudget.status()).toBe('daily_cap')

    const closeBudget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      purpose: 'close-capture',
      env: { ODDS_DAILY_CREDIT_CAP: '1500', ODDS_CLOSE_CAPTURE_RESERVE: '200' },
      log: { log() {} },
      state: { days: { '2026-11-04': { credits: 1300, calls: 10 } } },
    })
    expect(closeBudget.allow(50)).toBe(true)
    expect(closeBudget.allow(201)).toBe(false)
    expect(closeBudget.status()).toBe('daily_cap')
  })

  test('merges concurrent ledger writes via pid tmp + rename', () => {
    const fs = memoryFs()
    const env = {
      ODDS_CLOSE_CAPTURE_RESERVE: '0',
      ODDS_BUDGET_PATH: '/tmp/odds-api-budget.json',
    }
    const a = createOddsApiBudget({
      env,
      persist: true,
      filesystem: fs,
      now: NOON_ET,
      log: { log() {} },
    })
    const b = createOddsApiBudget({
      env,
      persist: true,
      filesystem: fs,
      now: NOON_ET,
      log: { log() {} },
    })
    a.record({ remaining: 18000, used: 100, last: 5 })
    b.record({ remaining: 17995, used: 105, last: 3 })
    expect(b.todayCredits()).toBe(8)
    const saved = JSON.parse(fs.files.get('/tmp/odds-api-budget.json'))
    expect(saved.days['2026-11-04'].credits).toBe(8)
  })

  test('warns when the ledger is missing or corrupt', () => {
    const missingLog = quietLog()
    loadOddsBudgetState({
      persistPath: '/tmp/missing-odds-budget.json',
      persist: true,
      filesystem: memoryFs(),
      log: missingLog,
    })
    expect(missingLog.lines.join('\n')).toMatch(/ledger missing/)

    const corruptFs = memoryFs()
    corruptFs.files.set('/tmp/corrupt-odds-budget.json', '{not-json')
    const corruptLog = quietLog()
    loadOddsBudgetState({
      persistPath: '/tmp/corrupt-odds-budget.json',
      persist: true,
      filesystem: corruptFs,
      log: corruptLog,
    })
    expect(corruptLog.lines.join('\n')).toMatch(/ledger corrupt/)
  })

  test('logs remaining without the API key and warns when status is not ok', () => {
    const logs = []
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      apiKey: 'secret-key-value',
      log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) },
      state: { lastRemaining: 2500, lastUsed: 1000, quotaDay: '2026-11-04' },
    })
    budget.record({
      remaining: 2500,
      used: 1000,
      last: 0,
    })
    budget.logSummary()
    const text = logs.join('\n')
    expect(text).toMatch(/ODDS_BUDGET_STATUS=floor/)
    expect(text).toMatch(/treat as WARN in routine reports/)
    expect(text).not.toMatch(/secret-key-value/)
  })
})

describe('fetchOddsApiJson', () => {
  test('records headers and skips the next call when the floor would be crossed', async () => {
    const logs = []
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) },
      state: { lastRemaining: 3005, lastUsed: 100, quotaDay: '2026-11-04' },
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
      { budget, fetchImpl, estimatedCredits: 5, apiKey: 'secret-key-value', log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) } },
    )
    expect(first.skipped).toBe(false)
    expect(first.data).toEqual({ ok: true })
    expect(first.quota).toEqual({ remaining: 3000, used: 105, last: 5 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const second = await fetchOddsApiJson(
      'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/abc/odds?markets=h2h,spreads,totals&apiKey=secret-key-value',
      { budget, fetchImpl, estimatedCredits: 3, apiKey: 'secret-key-value', log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) } },
    )
    expect(second.skipped).toBe(true)
    expect(second.status).toBe('floor')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(logs.join('\n')).toMatch(/ODDS_BUDGET_STATUS=floor/)
    expect(logs.join('\n')).toMatch(/treat as WARN/)
    expect(logs.join('\n')).not.toMatch(/secret-key-value/)
  })

  test('recovers after a floor hit once /v4/sports shows the quota reset', async () => {
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      log: { log() {} },
      state: { lastRemaining: 2500, lastUsed: 1000, quotaDay: '2026-11-03' },
    })
    const fetchImpl = jest.fn(async (url) => ({
      ok: true,
      headers: headerMap({
        'x-requests-remaining': '18000',
        'x-requests-used': '100',
        'x-requests-last': '0',
      }),
      json: async () => [],
      text: async () => '',
      url,
    }))
    const probe = await refreshOddsApiQuota({
      apiKey: 'k',
      budget,
      fetchImpl,
      log: { log() {} },
    })
    expect(probe.skipped).toBe(false)
    expect(probe.quota.remaining).toBe(18000)
    expect(budget.remaining()).toBe(18000)
    expect(budget.status()).toBe('ok')
    expect(budget.allow(5)).toBe(true)
  })

  test('recovers after a monthly-cap hit once /v4/sports shows used reset', async () => {
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      env: { ODDS_MONTHLY_CREDIT_CAP: '17000', ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      log: { log() {} },
      state: { lastRemaining: 3000, lastUsed: 17000, quotaDay: '2026-11-03' },
    })
    expect(budget.allow(1)).toBe(true)
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      headers: headerMap({
        'x-requests-remaining': '19900',
        'x-requests-used': '100',
        'x-requests-last': '0',
      }),
      json: async () => [],
      text: async () => '',
    }))
    await refreshOddsApiQuota({ apiKey: 'k', budget, fetchImpl, log: { log() {} } })
    expect(budget.used()).toBe(100)
    expect(budget.status()).toBe('ok')
    expect(budget.allow(5)).toBe(true)
  })

  test('probe failure without today headers fail-closes at ODDS_PROBE_FAIL_CREDIT_CAP', async () => {
    const logs = []
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      purpose: 'fetch',
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0', ODDS_PROBE_FAIL_CREDIT_CAP: '100' },
      log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) },
    })
    const result = await runOddsQuotaProbe({
      apiKey: 'secret-key-value',
      budget,
      fetchImpl: async () => { throw new Error('ECONNRESET secret-key-value') },
      log: { log: (msg) => logs.push(msg), warn: (msg) => logs.push(msg) },
    })
    expect(result.probeFailed).toBe(true)
    expect(budget.status()).toBe('probe_failed')
    expect(budget.hasFreshQuota()).toBe(false)
    expect(budget.allow(100)).toBe(true)
    expect(budget.allow(101)).toBe(false)
    expect(logs.join('\n')).toMatch(/ODDS_BUDGET_STATUS=probe_failed/)
    expect(logs.join('\n')).toMatch(/treat as WARN/)
    expect(logs.join('\n')).not.toMatch(/secret-key-value/)
  })

  test('probe failure keeps today headers and does not set probe_failed', async () => {
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      log: { log() {} },
      state: { lastRemaining: 18000, lastUsed: 100, quotaDay: '2026-11-04' },
    })
    const result = await runOddsQuotaProbe({
      apiKey: 'k',
      budget,
      fetchImpl: async () => { throw new Error('timeout') },
      log: { log() {} },
    })
    expect(result.probeFailed).toBe(true)
    expect(budget.markProbeFailed()).toBe(false)
    expect(budget.status()).toBe('ok')
    expect(budget.allow(5)).toBe(true)
  })

  test('always issues the 0-credit /v4/sports probe even when leftover remaining is under the floor', async () => {
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      log: { log() {} },
      state: { lastRemaining: 2500, lastUsed: 1000, quotaDay: '2026-11-04' },
    })
    expect(budget.status()).toBe('floor')
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      headers: headerMap({
        'x-requests-remaining': '18000',
        'x-requests-used': '200',
        'x-requests-last': '0',
      }),
      json: async () => [],
      text: async () => '',
    }))
    await refreshOddsApiQuota({ apiKey: 'k', budget, fetchImpl, log: { log() {} } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/\/v4\/sports\?/)
    expect(budget.remaining()).toBe(18000)
    expect(budget.status()).toBe('ok')
    expect(budget.allow(5)).toBe(true)
  })

  test('non-probe /scores or /events with a 0 estimate cannot bypass the floor', async () => {
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0' },
      log: { log() {} },
      state: { lastRemaining: 2500, lastUsed: 1000, quotaDay: '2026-11-04' },
    })
    expect(budget.status()).toBe('floor')
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      headers: headerMap({}),
      json: async () => [],
      text: async () => '',
    }))
    const skipped = await fetchOddsApiJson(
      'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/scores?daysFrom=1&apiKey=secret',
      { budget, fetchImpl, estimatedCredits: 0, log: { log() {} } },
    )
    expect(skipped.skipped).toBe(true)
    expect(skipped.status).toBe('floor')
    expect(fetchImpl).not.toHaveBeenCalled()

    const probe = await fetchOddsApiJson(
      'https://api.the-odds-api.com/v4/sports?apiKey=secret',
      {
        budget,
        fetchImpl,
        estimatedCredits: 0,
        isProbe: true,
        log: { log() {} },
      },
    )
    expect(probe.skipped).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('ops docs and script wiring', () => {
  test('operations README documents env vars, WARN status, and status lines', () => {
    const readme = readFileSync(join(process.cwd(), 'operations/README.md'), 'utf8')
    expect(readme).toMatch(/ODDS_DAILY_CREDIT_CAP/)
    expect(readme).toMatch(/ODDS_MONTHLY_CREDIT_CAP/)
    expect(readme).toMatch(/ODDS_REMAINING_FLOOR/)
    expect(readme).toMatch(/ODDS_CLOSE_CAPTURE_RESERVE/)
    expect(readme).toMatch(/ODDS_PROBE_FAIL_CREDIT_CAP/)
    expect(readme).toMatch(/ODDS_NFL_ADJACENT_PROPS_TTL_HOURS/)
    expect(readme).toMatch(/ODDS_BUDGET_STATUS=ok\|floor\|daily_cap\|monthly_cap\|probe_failed/)
    expect(readme).toMatch(/ODDS_CREDITS_USED/)
    expect(readme).toMatch(/ODDS_CREDITS_REMAINING/)
    expect(readme).toMatch(/\.local\/odds-api-budget\.json/)
    expect(readme).toMatch(/treat as WARN in routine reports/)
    expect(readme).toMatch(/Any value other than ok is WARN/)
  })

  test('fetch-live-odds selects Game.date for NFL adjacent cache TTL and probes first', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/fetch-live-odds.js'), 'utf8')
    expect(src).toMatch(/select\('id, oddsApiEventId, date'\)/)
    expect(src).toMatch(/propsCacheMaxAgeMs/)
    expect(src).toMatch(/runOddsQuotaProbe/)
    expect(src).toMatch(/purpose: 'fetch'/)
    expect(src).not.toMatch(/continuing without a pre-check/)
    const ops = readFileSync(join(process.cwd(), 'operations/fetch-live-odds.js'), 'utf8')
    expect(ops).toMatch(/runOddsQuotaProbe/)
    expect(ops).not.toMatch(/continuing without a pre-check/)
  })
})
