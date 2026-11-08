import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_CLOSE_CAPTURE_DAILY_CAP,
  DEFAULT_CLOSE_CAPTURE_PROP_HEADROOM,
  DEFAULT_CLOSE_CAPTURE_RESERVE,
  DEFAULT_GAME_LINE_CLOSE_DAILY_CAP,
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
      closeCaptureDailyCap: DEFAULT_CLOSE_CAPTURE_DAILY_CAP,
      closeCapturePropHeadroom: DEFAULT_CLOSE_CAPTURE_PROP_HEADROOM,
      gameLineCloseDailyCap: DEFAULT_GAME_LINE_CLOSE_DAILY_CAP,
      probeFailCreditCap: DEFAULT_PROBE_FAIL_CREDIT_CAP,
      persistPath: '.local/odds-api-budget.json',
    })
    expect(DEFAULT_CLOSE_CAPTURE_DAILY_CAP).toBe(40)
    expect(parseEnvNonNegInt('nope', 7)).toBe(7)
    expect(readOddsBudgetConfig({
      ODDS_DAILY_CREDIT_CAP: '200',
      ODDS_MONTHLY_CREDIT_CAP: '9000',
      ODDS_REMAINING_FLOOR: '4000',
      ODDS_CLOSE_CAPTURE_RESERVE: '50',
      ODDS_CLOSE_CAPTURE_DAILY_CAP: '40',
      ODDS_PROBE_FAIL_CREDIT_CAP: '75',
      ODDS_BUDGET_PATH: '/tmp/budget.json',
    })).toMatchObject({
      dailyCap: 200,
      monthlyCap: 9000,
      remainingFloor: 4000,
      closeCaptureReserve: 50,
      closeCaptureDailyCap: 40,
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

  test('close-capture daily cap is 40 event fetches and still honors the reserve', () => {
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      purpose: 'close-capture',
      env: {
        ODDS_DAILY_CREDIT_CAP: '1500',
        ODDS_CLOSE_CAPTURE_RESERVE: '200',
        ODDS_CLOSE_CAPTURE_DAILY_CAP: '40',
      },
      log: { log() {} },
      state: { days: { '2026-11-04': { credits: 10, calls: 10, closeCaptures: 39 } } },
    })
    expect(budget.remainingCloseCaptures()).toBe(1)
    expect(budget.allow(3, { captures: 1 })).toBe(true)
    budget.record({ remaining: 18000, used: 2000, last: 3 }, { captures: 1 })
    expect(budget.todayCloseCaptures()).toBe(40)
    expect(budget.allow(1, { captures: 1 })).toBe(false)
    expect(budget.status()).toBe('close_cap')
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

  test('non-probe 0-credit estimate counts as 1 under probe_failed', () => {
    const budget = createOddsApiBudget({
      persist: false,
      now: NOON_ET,
      purpose: 'fetch',
      env: { ODDS_CLOSE_CAPTURE_RESERVE: '0', ODDS_PROBE_FAIL_CREDIT_CAP: '100' },
      log: { log() {} },
      state: { days: { '2026-11-04': { credits: 100, calls: 4 } } },
    })
    expect(budget.markProbeFailed()).toBe(true)
    expect(budget.status()).toBe('probe_failed')
    expect(budget.allow(0)).toBe(false)
    expect(budget.allow(1)).toBe(false)
  })
})

function lockingFs(files = new Map()) {
  const base = memoryFs(files)
  const locks = new Map()
  const opens = []
  return {
    ...base,
    opens,
    openSync(filePath, flag) {
      opens.push([filePath, flag])
      if (flag !== 'wx') {
        const error = new Error(`unsupported flag ${flag}`)
        error.code = 'EINVAL'
        throw error
      }
      if (locks.has(filePath) || files.has(filePath)) {
        const error = new Error('EEXIST')
        error.code = 'EEXIST'
        throw error
      }
      locks.set(filePath, { mtimeMs: Date.now() })
      files.set(filePath, '')
      return filePath
    },
    closeSync() {},
    statSync(filePath) {
      if (!files.has(filePath)) {
        const error = new Error('ENOENT')
        error.code = 'ENOENT'
        throw error
      }
      return { mtimeMs: locks.get(filePath)?.mtimeMs || Date.now() }
    },
    unlinkSync(filePath) {
      locks.delete(filePath)
      files.delete(filePath)
    },
  }
}

function closeCaptureEnv(path, extra = {}) {
  return {
    ODDS_BUDGET_PATH: path,
    ODDS_CLOSE_CAPTURE_RESERVE: '0',
    ODDS_REMAINING_FLOOR: '0',
    ODDS_DAILY_CREDIT_CAP: '5000',
    ODDS_CLOSE_CAPTURE_DAILY_CAP: '40',
    ODDS_GAME_LINE_CLOSE_DAILY_CAP: '12',
    ODDS_CLOSE_CAPTURE_PROP_HEADROOM: '28',
    ...extra,
  }
}

describe('daily game-line budget and locked reserve', () => {
  const ledgerPath = '/tmp/odds-api-budget-game-lines.json'
  const day = '2026-11-04'

  function budgetOn(fs, state, extraEnv = {}) {
    return createOddsApiBudget({
      persist: true,
      filesystem: fs,
      now: NOON_ET,
      purpose: 'close-capture',
      env: closeCaptureEnv(ledgerPath, extraEnv),
      log: { log() {}, warn() {} },
      state,
    })
  }

  test('game-line credits persist across budget instances and leave prop slots', () => {
    const fs = memoryFs()
    const first = budgetOn(fs)
    const reserved = first.reserve(2, { captures: 1, gameLineCredits: 2 })
    expect(reserved.ok).toBe(true)
    expect(first.todayGameLineCredits()).toBe(2)
    expect(first.todayCloseCaptures()).toBe(1)

    const second = createOddsApiBudget({
      persist: true,
      filesystem: fs,
      now: NOON_ET,
      purpose: 'close-capture',
      env: closeCaptureEnv(ledgerPath),
      log: { log() {}, warn() {} },
    })
    expect(second.todayGameLineCredits()).toBe(2)
    expect(second.remainingGameLineCredits()).toBe(10)
    const again = second.reserve(2, { captures: 1, gameLineCredits: 2 })
    expect(again.ok).toBe(true)
    expect(second.todayGameLineCredits()).toBe(4)

    const capped = createOddsApiBudget({
      persist: true,
      filesystem: fs,
      now: NOON_ET,
      purpose: 'close-capture',
      env: closeCaptureEnv(ledgerPath, { ODDS_GAME_LINE_CLOSE_DAILY_CAP: '4' }),
      log: { log() {}, warn() {} },
    })
    const blocked = capped.reserve(2, { captures: 1, gameLineCredits: 2 })
    expect(blocked.ok).toBe(false)
    expect(blocked.status).toBe('game_line_cap')
    expect(capped.todayGameLineCredits()).toBe(4)

    const propped = capped.reserve(5, { captures: 1 })
    expect(propped.ok).toBe(true)
    expect(capped.allow(5, { captures: 1 })).toBe(true)
    expect(capped.todayCloseCaptures()).toBe(3)
  })

  test('game lines stop at the prop headroom while a later prop reserve still fits', () => {
    const fs = memoryFs()
    const budget = budgetOn(fs, {
      days: { [day]: { credits: 24, calls: 12, closeCaptures: 12, gameLineCredits: 0 } },
    })
    expect(budget.remainingGameLineSlots()).toBe(0)
    const gameLine = budget.reserve(2, { captures: 1, gameLineCredits: 2 })
    expect(gameLine.ok).toBe(false)
    expect(gameLine.status).toBe('game_line_cap')
    expect(budget.todayCloseCaptures()).toBe(12)
    const prop = budget.reserve(5, { captures: 1 })
    expect(prop.ok).toBe(true)
    expect(budget.todayCloseCaptures()).toBe(13)
    expect(budget.allow(5, { captures: 1 })).toBe(true)
  })

  test('two reserves at 39/40 cannot both pass, and a crash keeps the reservation', () => {
    const fs = lockingFs()
    fs.writeFileSync(ledgerPath, JSON.stringify({
      version: 1,
      days: { [day]: { credits: 39, calls: 39, closeCaptures: 39, gameLineCredits: 0 } },
    }))
    const env = closeCaptureEnv(ledgerPath)
    const opts = {
      persist: true,
      filesystem: fs,
      now: NOON_ET,
      purpose: 'close-capture',
      env,
      log: { log() {}, warn() {} },
    }
    const left = createOddsApiBudget(opts)
    const right = createOddsApiBudget(opts)
    expect(left.allow(1, { captures: 1 })).toBe(true)
    expect(right.allow(1, { captures: 1 })).toBe(true)
    const first = left.reserve(1, { captures: 1 })
    const second = right.reserve(1, { captures: 1 })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(second.status).toBe('close_cap')
    const saved = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    expect(saved.days[day].closeCaptures).toBe(40)
    expect(saved.days[day].credits).toBe(40)
    expect(fs.opens.some(([, flag]) => flag === 'wx')).toBe(true)

    const crashPath = '/tmp/odds-api-budget-crash.json'
    const crashFs = lockingFs()
    const crash = createOddsApiBudget({
      ...opts,
      filesystem: crashFs,
      env: closeCaptureEnv(crashPath),
    })
    const held = crash.reserve(4, { captures: 1, gameLineCredits: 4 })
    expect(held.ok).toBe(true)
    const reloaded = createOddsApiBudget({
      persist: true,
      filesystem: crashFs,
      now: NOON_ET,
      purpose: 'close-capture',
      env: closeCaptureEnv(crashPath),
      log: { log() {}, warn() {} },
    })
    expect(reloaded.todayCredits()).toBe(4)
    expect(reloaded.todayGameLineCredits()).toBe(4)
    expect(reloaded.todayCloseCaptures()).toBe(1)
  })

  test('reconcile lowers a reservation to x-requests-last and a thrown fetch keeps it', async () => {
    const fs = lockingFs()
    const budget = budgetOn(fs)
    const held = budget.reserve(5, { captures: 1, gameLineCredits: 5 })
    expect(held.ok).toBe(true)
    budget.reconcile(held, { remaining: 100, used: 2, last: 2 })
    expect(budget.todayCredits()).toBe(2)
    expect(budget.todayGameLineCredits()).toBe(2)
    expect(budget.runCredits()).toBe(2)
    expect(budget.todayCloseCaptures()).toBe(1)
    const saved = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    expect(saved.days[day].credits).toBe(2)
    expect(saved.days[day].gameLineCredits).toBe(2)

    const fetchFsPath = '/tmp/odds-api-budget-fetch.json'
    const fetchFs = lockingFs()
    const paying = createOddsApiBudget({
      persist: true,
      filesystem: fetchFs,
      now: NOON_ET,
      purpose: 'close-capture',
      env: closeCaptureEnv(fetchFsPath),
      log: { log() {}, warn() {} },
    })
    await expect(fetchOddsApiJson(
      'https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds?regions=us&markets=h2h,totals',
      {
        budget: paying,
        estimatedCredits: 2,
        gameLine: true,
        fetchImpl: async () => {
          throw new Error('socket hang up')
        },
        log: { log() {}, warn() {} },
      },
    )).rejects.toThrow('socket hang up')
    const afterThrow = createOddsApiBudget({
      persist: true,
      filesystem: fetchFs,
      now: NOON_ET,
      purpose: 'close-capture',
      env: closeCaptureEnv(fetchFsPath),
      log: { log() {}, warn() {} },
    })
    expect(afterThrow.todayCredits()).toBe(2)
    expect(afterThrow.todayGameLineCredits()).toBe(2)
    expect(afterThrow.todayCloseCaptures()).toBe(1)
  })
})

describe('ops docs and script wiring', () => {
  test('operations README documents env vars, WARN status, and status lines', () => {
    const readme = readFileSync(join(process.cwd(), 'operations/README.md'), 'utf8')
    expect(readme).toMatch(/ODDS_DAILY_CREDIT_CAP/)
    expect(readme).toMatch(/ODDS_MONTHLY_CREDIT_CAP/)
    expect(readme).toMatch(/ODDS_REMAINING_FLOOR/)
    expect(readme).toMatch(/ODDS_CLOSE_CAPTURE_RESERVE/)
    expect(readme).toMatch(/ODDS_CLOSE_CAPTURE_DAILY_CAP/)
    expect(readme).toMatch(/ODDS_PROBE_FAIL_CREDIT_CAP/)
    expect(readme).toMatch(/ODDS_NFL_ADJACENT_PROPS_TTL_HOURS/)
    expect(readme).toMatch(/ODDS_BUDGET_STATUS=ok\|floor\|daily_cap\|monthly_cap\|probe_failed\|close_cap\|game_line_cap/)
    expect(readme).toMatch(/ODDS_GAME_LINE_CLOSE_DAILY_CAP/)
    expect(readme).toMatch(/ODDS_CLOSE_CAPTURE_PROP_HEADROOM/)
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
    expect(existsSync(join(process.cwd(), 'operations/fetch-live-odds.js'))).toBe(false)
  })
})
