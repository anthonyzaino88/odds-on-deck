import { fork } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  const mtimes = new Map()
  return {
    files,
    mtimes,
    setMtime(p, ms) { mtimes.set(p, ms) },
    statSync(p) {
      if (!files.has(p)) {
        const error = new Error(`ENOENT ${p}`)
        error.code = 'ENOENT'
        throw error
      }
      return { mtimeMs: mtimes.has(p) ? mtimes.get(p) : Date.now() }
    },
    existsSync(p) {
      if (files.has(p)) return true
      const prefix = String(p).endsWith('/') ? String(p) : `${p}/`
      for (const key of files.keys()) {
        if (String(key).startsWith(prefix)) return true
      }
      return false
    },
    mkdirSync() {},
    writeFileSync(p, data) {
      files.set(p, String(data))
      if (!mtimes.has(p)) mtimes.set(p, Date.now())
    },
    readFileSync(p) {
      if (!files.has(p)) {
        const error = new Error(`ENOENT ${p}`)
        error.code = 'ENOENT'
        throw error
      }
      return files.get(p)
    },
    renameSync(from, to) {
      if (!files.has(from)) {
        const error = new Error(`ENOENT ${from}`)
        error.code = 'ENOENT'
        throw error
      }
      files.set(to, files.get(from))
      files.delete(from)
    },
    unlinkSync(p) { files.delete(p) },
    linkSync(from, to) {
      if (!files.has(from)) {
        const error = new Error(`ENOENT ${from}`)
        error.code = 'ENOENT'
        throw error
      }
      if (files.has(to)) {
        const error = new Error(`EEXIST ${to}`)
        error.code = 'EEXIST'
        throw error
      }
      files.set(to, files.get(from))
      if (!mtimes.has(to)) mtimes.set(to, mtimes.get(from) ?? Date.now())
    },
    readdirSync(dir) {
      const prefix = String(dir).endsWith('/') ? String(dir) : `${dir}/`
      const names = new Set()
      for (const key of files.keys()) {
        const name = String(key)
        if (!name.startsWith(prefix)) continue
        const rest = name.slice(prefix.length)
        if (!rest) continue
        names.add(rest.split('/')[0])
      }
      return [...names]
    },
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

  test('adopts a fence commit when the ledger pointer is missing or stale', () => {
    const fs = memoryFs()
    const stalePath = '/tmp/odds-api-budget-stale-pointer.json'
    const dayRow = { credits: 3, calls: 3, closeCaptures: 3, gameLineCredits: 0 }
    fs.writeFileSync(stalePath, JSON.stringify({
      version: 1,
      fence: 1,
      days: { '2026-11-04': dayRow },
    }))
    fs.writeFileSync(`${stalePath}.fences/2`, JSON.stringify({
      version: 1,
      fence: 2,
      fenceDay: '2026-11-04',
      days: { '2026-11-04': { credits: 9, calls: 9, closeCaptures: 9, gameLineCredits: 1 } },
      settled: { 'res-1': { day: '2026-11-04', actual: 9 } },
    }))
    const stale = loadOddsBudgetState({
      persistPath: stalePath,
      filesystem: fs,
      log: { log() {}, warn() {} },
    })
    expect(stale.fence).toBe(2)
    expect(stale.days['2026-11-04'].credits).toBe(9)
    expect(stale.settled['res-1'].actual).toBe(9)

    const orphanPath = '/tmp/odds-api-budget-orphan-fence.json'
    for (const fence of [1, 2, 3]) {
      fs.writeFileSync(`${orphanPath}.fences/${fence}`, JSON.stringify({
        version: 1,
        fence,
        fenceDay: '2026-11-04',
        days: { '2026-11-04': { credits: 1, calls: 1, closeCaptures: 1, gameLineCredits: 0 } },
      }))
    }
    fs.writeFileSync(`${orphanPath}.fences/4`, JSON.stringify({
      version: 1,
      fence: 4,
      fenceDay: '2026-11-04',
      days: { '2026-11-04': { credits: 11, calls: 11, closeCaptures: 11, gameLineCredits: 0 } },
    }))
    const orphanLog = quietLog()
    const orphan = loadOddsBudgetState({
      persistPath: orphanPath,
      filesystem: fs,
      log: orphanLog,
    })
    expect(orphan.fence).toBe(4)
    expect(orphan.days['2026-11-04'].credits).toBe(11)
    expect(orphanLog.lines.join('\n')).not.toMatch(/starting empty/)
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
    mtimes: new Map(),
    setMtime(filePath, mtimeMs) { this.mtimes.set(filePath, mtimeMs) },
    statSync(filePath) {
      if (!files.has(filePath)) {
        const error = new Error('ENOENT')
        error.code = 'ENOENT'
        throw error
      }
      if (this.mtimes.has(filePath)) return { mtimeMs: this.mtimes.get(filePath) }
      return { mtimeMs: locks.get(filePath)?.mtimeMs || Date.now() }
    },
    unlinkSync(filePath) {
      locks.delete(filePath)
      this.mtimes.delete(filePath)
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
    fs.writeFileSync(ledgerPath, JSON.stringify({
      version: 1,
      fence: 3,
      days: { [day]: { credits: 24, calls: 12, closeCaptures: 12, gameLineCredits: 0 } },
    }))
    const budget = budgetOn(fs)
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
    budget.reconcile(held, { remaining: 100, used: 2, last: 0 })
    expect(budget.todayCredits()).toBe(2)
    expect(budget.todayGameLineCredits()).toBe(2)
    expect(budget.runCredits()).toBe(2)
    const saved = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    expect(saved.days[day].credits).toBe(2)
    expect(saved.days[day].gameLineCredits).toBe(2)
    expect(saved.settled[held.id]).toEqual({ day, actual: 2 })
    expect(saved.fence).toBe(2)

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

  test('a missing, blank, or negative last header keeps the reserved credits', () => {
    const fs = memoryFs()
    const budget = budgetOn(fs)
    const held = budget.reserve(2, { captures: 1, gameLineCredits: 2 })
    expect(held.ok).toBe(true)
    for (const last of [null, '', '   ', 'nope', Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      budget.reconcile(held, { last, remaining: 80, used: 2 })
      expect(budget.todayCredits()).toBe(2)
      expect(budget.todayGameLineCredits()).toBe(2)
    }
    budget.reconcile(held, { last: 0, remaining: 80, used: 2 })
    expect(budget.todayCredits()).toBe(2)
    expect(budget.todayGameLineCredits()).toBe(2)
    const fresh = budget.reserve(2, { captures: 1, gameLineCredits: 2 })
    expect(fresh.ok).toBe(true)
    budget.reconcile(fresh, { last: 0, remaining: 80, used: 2 })
    expect(budget.todayCredits()).toBe(2)
    expect(budget.todayGameLineCredits()).toBe(2)
    const saved = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
    expect(saved.days[day].credits).toBe(2)
    expect(saved.days[day].gameLineCredits).toBe(2)
    expect(saved.settled[held.id].actual).toBe(2)
    expect(saved.settled[fresh.id].actual).toBe(0)
  })

  test('a reservation after ET midnight lands on the new day and reconcile stays on the old one', () => {
    const fs = memoryFs()
    const path = '/tmp/odds-api-budget-rollover.json'
    let current = new Date('2026-11-05T04:30:00.000Z')
    const budget = createOddsApiBudget({
      persist: true,
      filesystem: fs,
      now: () => current,
      purpose: 'close-capture',
      env: closeCaptureEnv(path, { ODDS_GAME_LINE_CLOSE_DAILY_CAP: '2' }),
      log: { log() {}, warn() {} },
    })
    const first = budget.reserve(2, { captures: 1, gameLineCredits: 2 })
    expect(first.ok).toBe(true)
    expect(first.dayKey).toBe('2026-11-04')
    expect(budget.todayGameLineCredits()).toBe(2)
    current = new Date('2026-11-05T05:30:00.000Z')
    expect(budget.todayCredits()).toBe(0)
    expect(budget.todayGameLineCredits()).toBe(0)
    const second = budget.reserve(2, { captures: 1, gameLineCredits: 2 })
    expect(second.ok).toBe(true)
    expect(second.dayKey).toBe('2026-11-05')
    expect(budget.todayGameLineCredits()).toBe(2)
    budget.reconcile(first, { last: 1, remaining: 91, used: 3 })
    let saved = JSON.parse(fs.readFileSync(path, 'utf8'))
    expect(saved.days['2026-11-04'].credits).toBe(1)
    expect(saved.days['2026-11-04'].gameLineCredits).toBe(1)
    expect(saved.days['2026-11-05'].credits).toBe(2)
    expect(saved.days['2026-11-05'].gameLineCredits).toBe(2)
    budget.reconcile(first, { last: 0, remaining: 91, used: 3 })
    saved = JSON.parse(fs.readFileSync(path, 'utf8'))
    expect(saved.days['2026-11-04'].credits).toBe(1)
    expect(saved.days['2026-11-04'].gameLineCredits).toBe(1)
    expect(saved.settled[first.id]).toEqual({ day: '2026-11-04', actual: 1 })
    expect(saved.days['2026-11-05'].credits).toBe(2)
    expect(saved.days['2026-11-05'].gameLineCredits).toBe(2)
    expect(budget.todayCredits()).toBe(2)
    expect(budget.todayGameLineCredits()).toBe(2)
  })

  test('a stolen stale lock commits once and bumps the fence', () => {
    const stealFs = lockingFs()
    const stealPath = '/tmp/odds-api-budget-steal.json'
    const lockPath = `${stealPath}.lock`
    stealFs.writeFileSync(stealPath, JSON.stringify({
      version: 1,
      fence: 4,
      days: { [day]: { credits: 9, calls: 9, closeCaptures: 9, gameLineCredits: 0 } },
    }))
    stealFs.writeFileSync(lockPath, 'old-owner\n')
    stealFs.setMtime(lockPath, Date.now() - 31_000)
    const stealer = createOddsApiBudget({
      persist: true,
      filesystem: stealFs,
      now: NOON_ET,
      purpose: 'close-capture',
      env: closeCaptureEnv(stealPath),
      log: { log() {}, warn() {} },
    })
    const taken = stealer.reserve(1, { captures: 1 })
    expect(taken.ok).toBe(true)
    const saved = JSON.parse(stealFs.readFileSync(stealPath, 'utf8'))
    expect(saved.fence).toBe(5)
    expect(saved.days[day].credits).toBe(10)
    expect(saved.days[day].closeCaptures).toBe(10)
    expect(stealFs.existsSync(lockPath)).toBe(false)
  })

  test('a paused holder loses the last slot when a stale reclaim commits first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ood-budget-race-'))
    const ledger = join(dir, 'budget.json')
    const gate = join(dir, 'gate')
    writeFileSync(ledger, JSON.stringify({
      version: 1,
      fence: 7,
      days: {
        '2026-11-04': { credits: 39, calls: 39, closeCaptures: 39, gameLineCredits: 0 },
      },
    }))
    const payload = {
      now: '2026-11-04T16:00:00.000Z',
      credits: 1,
      extra: { captures: 1 },
      env: closeCaptureEnv(ledger),
    }
    const childPath = join(process.cwd(), '__tests__', 'helpers', 'odds-budget-race-child.mjs')
    const children = []
    const runChild = (envExtra) => new Promise((resolve, reject) => {
      const child = fork(childPath, [JSON.stringify(payload)], {
        execArgv: [],
        env: {
          ...process.env,
          ODDS_BUDGET_LOCK_STALE_MS: '1000',
          ...envExtra,
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      })
      children.push(child)
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`child timed out\n${err}\n${out}`))
      }, 12000)
      child.stdout.on('data', (chunk) => { out += chunk })
      child.stderr.on('data', (chunk) => { err += chunk })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('exit', () => {
        clearTimeout(timer)
        const line = out.trim().split('\n').filter(Boolean).pop()
        if (!line) {
          reject(new Error(`child produced no result\n${err}`))
          return
        }
        try {
          resolve({ stderr: err, ...JSON.parse(line) })
        } catch (error) {
          reject(new Error(`child output ${out}\n${err}\n${error.message}`))
        }
      })
    })
    const holder = runChild({ ODDS_BUDGET_PUBLISH_GATE: gate })
    try {
      const pausedPath = `${gate}.paused`
      const deadline = Date.now() + 8000
      while (!existsSync(pausedPath)) {
        if (Date.now() > deadline) throw new Error('holder did not reach the publish gate')
        await new Promise((resolve) => setTimeout(resolve, 15))
      }
      const aged = new Date(Date.now() - 10_000)
      utimesSync(`${ledger}.lock`, aged, aged)
      const challenger = await runChild({ ODDS_BUDGET_PUBLISH_GATE: '' })
      writeFileSync(`${gate}.go`, '1')
      const paused = await holder
      expect(challenger).toMatchObject({ ok: true, error: null })
      expect(paused).toMatchObject({ ok: false, status: 'close_cap', error: null })
      const saved = JSON.parse(readFileSync(ledger, 'utf8'))
      expect(saved.days['2026-11-04'].closeCaptures).toBe(40)
      expect(saved.days['2026-11-04'].credits).toBe(40)
      expect(saved.fence).toBe(8)
    } finally {
      try { writeFileSync(`${gate}.go`, '1') } catch { /* gate dir already removed */ }
      for (const child of children) {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
      }
      await holder.catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  test('reconciling after a stale reclaim does not free the fence for the paused holder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ood-budget-prune-'))
    const ledger = join(dir, 'budget.json')
    const gate = join(dir, 'gate')
    const fenceDir = `${ledger}.fences`
    writeFileSync(ledger, JSON.stringify({
      version: 1,
      fence: 0,
      days: {
        '2026-11-04': { credits: 39, calls: 39, closeCaptures: 39, gameLineCredits: 0 },
      },
    }))
    const payload = {
      now: '2026-11-04T16:00:00.000Z',
      credits: 1,
      extra: { captures: 1 },
      env: closeCaptureEnv(ledger),
    }
    const childPath = join(process.cwd(), '__tests__', 'helpers', 'odds-budget-race-child.mjs')
    const children = []
    const runChild = (body, envExtra) => new Promise((resolve, reject) => {
      const child = fork(childPath, [JSON.stringify(body)], {
        execArgv: [],
        env: {
          ...process.env,
          ODDS_BUDGET_LOCK_STALE_MS: '1000',
          ...envExtra,
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      })
      children.push(child)
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`child timed out\n${err}\n${out}`))
      }, 12000)
      child.stdout.on('data', (chunk) => { out += chunk })
      child.stderr.on('data', (chunk) => { err += chunk })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('exit', () => {
        clearTimeout(timer)
        const line = out.trim().split('\n').filter(Boolean).pop()
        if (!line) {
          reject(new Error(`child produced no result\n${err}`))
          return
        }
        try {
          resolve({ stderr: err, ...JSON.parse(line) })
        } catch (error) {
          reject(new Error(`child output ${out}\n${err}\n${error.message}`))
        }
      })
    })
    const holder = runChild(payload, { ODDS_BUDGET_PUBLISH_GATE: gate })
    try {
      const pausedPath = `${gate}.paused`
      const deadline = Date.now() + 8000
      while (!existsSync(pausedPath)) {
        if (Date.now() > deadline) throw new Error('holder did not reach the publish gate')
        await new Promise((resolve) => setTimeout(resolve, 15))
      }
      const aged = new Date(Date.now() - 10_000)
      utimesSync(`${ledger}.lock`, aged, aged)
      const reclaimer = await runChild({
        ...payload,
        reconcile: true,
        quota: { last: 1 },
      }, { ODDS_BUDGET_PUBLISH_GATE: '' })
      expect(reclaimer).toMatchObject({ ok: true, error: null })
      expect(existsSync(join(fenceDir, '1'))).toBe(true)
      expect(existsSync(join(fenceDir, '2'))).toBe(true)
      writeFileSync(`${gate}.go`, '1')
      const paused = await holder
      expect(paused).toMatchObject({ ok: false, status: 'close_cap', error: null })
      expect(existsSync(join(fenceDir, '1'))).toBe(true)
      const saved = JSON.parse(readFileSync(ledger, 'utf8'))
      expect(saved.days['2026-11-04'].closeCaptures).toBe(40)
      expect(saved.days['2026-11-04'].credits).toBe(40)
      expect(saved.fence).toBe(2)
    } finally {
      try { writeFileSync(`${gate}.go`, '1') } catch { /* gate dir already removed */ }
      for (const child of children) {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
      }
      await holder.catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  test('a holder paused across midnight cannot reuse the new day fence number', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ood-budget-midnight-'))
    const ledger = join(dir, 'budget.json')
    const gate = join(dir, 'gate')
    const fenceDir = `${ledger}.fences`
    writeFileSync(ledger, JSON.stringify({ version: 1, fence: 0, days: {} }))
    const childPath = join(process.cwd(), '__tests__', 'helpers', 'odds-budget-race-child.mjs')
    const children = []
    const runChild = (body, envExtra) => new Promise((resolve, reject) => {
      const child = fork(childPath, [JSON.stringify(body)], {
        execArgv: [],
        env: { ...process.env, ODDS_BUDGET_LOCK_STALE_MS: '1000', ...envExtra },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      })
      children.push(child)
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`child timed out\n${err}\n${out}`))
      }, 12000)
      child.stdout.on('data', (chunk) => { out += chunk })
      child.stderr.on('data', (chunk) => { err += chunk })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('exit', () => {
        clearTimeout(timer)
        const line = out.trim().split('\n').filter(Boolean).pop()
        if (!line) {
          reject(new Error(`child produced no result\n${err}`))
          return
        }
        resolve({ stderr: err, ...JSON.parse(line) })
      })
    })
    const base = {
      credits: 1,
      extra: { captures: 1 },
      env: closeCaptureEnv(ledger),
    }
    const holder = runChild({
      ...base,
      now: '2026-11-05T04:30:00.000Z',
    }, { ODDS_BUDGET_PUBLISH_GATE: gate })
    try {
      const deadline = Date.now() + 8000
      while (!existsSync(`${gate}.paused`)) {
        if (Date.now() > deadline) throw new Error('holder did not reach the publish gate')
        await new Promise((resolve) => setTimeout(resolve, 15))
      }
      utimesSync(`${ledger}.lock`, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000))
      const reclaimer = await runChild({
        ...base,
        now: '2026-11-05T05:30:00.000Z',
      }, { ODDS_BUDGET_PUBLISH_GATE: '' })
      writeFileSync(`${gate}.go`, '1')
      const paused = await holder
      expect(reclaimer).toMatchObject({ ok: true, error: null })
      expect(paused).toMatchObject({ ok: true, error: null })
      const saved = JSON.parse(readFileSync(ledger, 'utf8'))
      expect(saved.days['2026-11-04'].closeCaptures).toBe(1)
      expect(saved.days['2026-11-05'].closeCaptures).toBe(1)
      expect(saved.fence).toBe(2)
      const first = JSON.parse(readFileSync(join(fenceDir, '1'), 'utf8'))
      const second = JSON.parse(readFileSync(join(fenceDir, '2'), 'utf8'))
      expect(first.fence).toBe(1)
      expect(first.days['2026-11-05'].closeCaptures).toBe(1)
      expect(second.fence).toBe(2)
      expect(second.days['2026-11-04'].closeCaptures).toBe(1)
      expect(second.days['2026-11-05'].closeCaptures).toBe(1)
      expect(existsSync(join(fenceDir, '2026-11-04', '1'))).toBe(false)
      expect(existsSync(join(fenceDir, '2026-11-05', '1'))).toBe(false)
    } finally {
      try { writeFileSync(`${gate}.go`, '1') } catch { /* removed */ }
      for (const child of children) {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
      }
      await holder.catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  test('a stale 39/40 snapshot cannot take a fresh fence number', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ood-budget-stale-number-'))
    const ledger = join(dir, 'budget.json')
    const gate = join(dir, 'gate')
    const fenceDir = `${ledger}.fences`
    writeFileSync(ledger, JSON.stringify({
      version: 1,
      fence: 5,
      days: {
        '2026-11-04': { credits: 39, calls: 39, closeCaptures: 39, gameLineCredits: 0 },
      },
    }))
    const childPath = join(process.cwd(), '__tests__', 'helpers', 'odds-budget-race-child.mjs')
    const children = []
    const runChild = (envExtra) => new Promise((resolve, reject) => {
      const child = fork(childPath, [JSON.stringify({
        now: '2026-11-04T16:00:00.000Z',
        credits: 1,
        extra: { captures: 1 },
        env: closeCaptureEnv(ledger),
      })], {
        execArgv: [],
        env: { ...process.env, ODDS_BUDGET_LOCK_STALE_MS: '1000', ...envExtra },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      })
      children.push(child)
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`child timed out\n${err}\n${out}`))
      }, 12000)
      child.stdout.on('data', (chunk) => { out += chunk })
      child.stderr.on('data', (chunk) => { err += chunk })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('exit', () => {
        clearTimeout(timer)
        const line = out.trim().split('\n').filter(Boolean).pop()
        if (!line) {
          reject(new Error(`child produced no result\n${err}`))
          return
        }
        resolve({ stderr: err, ...JSON.parse(line) })
      })
    })
    const holder = runChild({ ODDS_BUDGET_ALLOCATE_GATE: gate })
    try {
      const deadline = Date.now() + 8000
      while (!existsSync(`${gate}.paused`)) {
        if (Date.now() > deadline) throw new Error('holder did not reach the allocate gate')
        await new Promise((resolve) => setTimeout(resolve, 15))
      }
      utimesSync(`${ledger}.lock`, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000))
      const reclaimer = await runChild({ ODDS_BUDGET_ALLOCATE_GATE: '' })
      writeFileSync(`${gate}.go`, '1')
      const paused = await holder
      expect(reclaimer).toMatchObject({ ok: true, error: null })
      expect(paused).toMatchObject({ ok: false, status: 'close_cap', error: null })
      const saved = JSON.parse(readFileSync(ledger, 'utf8'))
      expect(saved.days['2026-11-04'].closeCaptures).toBe(40)
      expect(saved.fence).toBe(6)
      expect(existsSync(join(fenceDir, '6'))).toBe(true)
      expect(existsSync(join(fenceDir, '7'))).toBe(false)
    } finally {
      try { writeFileSync(`${gate}.go`, '1') } catch { /* removed */ }
      for (const child of children) {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
      }
      await holder.catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  test('a 39/40 admission cannot merge a newer snapshot into 41', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ood-budget-admit-'))
    const ledger = join(dir, 'budget.json')
    const gate = join(dir, 'gate')
    const fenceDir = `${ledger}.fences`
    writeFileSync(ledger, JSON.stringify({
      version: 1,
      fence: 5,
      days: {
        '2026-11-04': { credits: 39, calls: 39, closeCaptures: 39, gameLineCredits: 0 },
      },
    }))
    const childPath = join(process.cwd(), '__tests__', 'helpers', 'odds-budget-race-child.mjs')
    const children = []
    const runChild = (envExtra) => new Promise((resolve, reject) => {
      const child = fork(childPath, [JSON.stringify({
        now: '2026-11-04T16:00:00.000Z',
        credits: 1,
        extra: { captures: 1 },
        env: closeCaptureEnv(ledger),
      })], {
        execArgv: [],
        env: { ...process.env, ODDS_BUDGET_LOCK_STALE_MS: '1000', ...envExtra },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      })
      children.push(child)
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`child timed out\n${err}\n${out}`))
      }, 12000)
      child.stdout.on('data', (chunk) => { out += chunk })
      child.stderr.on('data', (chunk) => { err += chunk })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('exit', () => {
        clearTimeout(timer)
        const line = out.trim().split('\n').filter(Boolean).pop()
        if (!line) {
          reject(new Error(`child produced no result\n${err}`))
          return
        }
        resolve({ stderr: err, ...JSON.parse(line) })
      })
    })
    const holder = runChild({ ODDS_BUDGET_ADMIT_GATE: gate })
    try {
      const deadline = Date.now() + 8000
      while (!existsSync(`${gate}.paused`)) {
        if (Date.now() > deadline) throw new Error('holder did not reach the admit gate')
        await new Promise((resolve) => setTimeout(resolve, 15))
      }
      utimesSync(`${ledger}.lock`, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000))
      const reclaimer = await runChild({ ODDS_BUDGET_ADMIT_GATE: '' })
      writeFileSync(`${gate}.go`, '1')
      const paused = await holder
      expect(reclaimer).toMatchObject({ ok: true, error: null })
      expect(paused).toMatchObject({ ok: false, status: 'close_cap', error: null })
      const saved = JSON.parse(readFileSync(ledger, 'utf8'))
      expect(saved.days['2026-11-04'].closeCaptures).toBe(40)
      expect(saved.fence).toBe(6)
      expect(existsSync(join(fenceDir, '6'))).toBe(true)
      expect(existsSync(join(fenceDir, '7'))).toBe(false)
      const committed = JSON.parse(readFileSync(join(fenceDir, '6'), 'utf8'))
      expect(committed.days['2026-11-04'].closeCaptures).toBe(40)
    } finally {
      try { writeFileSync(`${gate}.go`, '1') } catch { /* removed */ }
      for (const child of children) {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
      }
      await holder.catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  test('a stale reconcile cannot refund a reservation that landed after its snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ood-budget-refund-'))
    const ledger = join(dir, 'budget.json')
    const gate = join(dir, 'gate')
    const idPath = join(dir, 'ids.json')
    const childPath = join(process.cwd(), '__tests__', 'helpers', 'odds-budget-race-child.mjs')
    const children = []
    const runChild = (mode) => new Promise((resolve, reject) => {
      const child = fork(childPath, [JSON.stringify({
        mode,
        idPath,
        now: '2026-11-04T16:00:00.000Z',
        env: closeCaptureEnv(ledger),
      })], {
        execArgv: [],
        env: {
          ...process.env,
          ODDS_BUDGET_LOCK_STALE_MS: '1000',
          ODDS_BUDGET_RECONCILE_GATE: mode === 'refund-holder' ? gate : '',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      })
      children.push(child)
      let out = ''
      let err = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`child timed out\n${err}\n${out}`))
      }, 12000)
      child.stdout.on('data', (chunk) => { out += chunk })
      child.stderr.on('data', (chunk) => { err += chunk })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('exit', () => {
        clearTimeout(timer)
        const line = out.trim().split('\n').filter(Boolean).pop()
        if (!line) {
          reject(new Error(`child produced no result\n${err}`))
          return
        }
        resolve({ stderr: err, ...JSON.parse(line) })
      })
    })
    const holder = runChild('refund-holder')
    try {
      const deadline = Date.now() + 8000
      while (!existsSync(`${gate}.paused`)) {
        if (Date.now() > deadline) throw new Error('holder did not reach the reconcile gate')
        await new Promise((resolve) => setTimeout(resolve, 15))
      }
      utimesSync(`${ledger}.lock`, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000))
      const reclaimer = await runChild('refund-reclaimer')
      writeFileSync(`${gate}.go`, '1')
      const paused = await holder
      expect(reclaimer).toMatchObject({ ok: true, error: null })
      expect(paused).toMatchObject({ ok: true, error: null })
      const saved = JSON.parse(readFileSync(ledger, 'utf8'))
      expect(saved.days['2026-11-04'].credits).toBe(4)
    } finally {
      try { writeFileSync(`${gate}.go`, '1') } catch { /* removed */ }
      for (const child of children) {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
      }
      await holder.catch(() => {})
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  test('a reader probes the next fence and keeps captures it already saw', () => {
    const day = '2026-11-04'
    const body = (fence, captures) => JSON.stringify({
      version: 1,
      fence,
      fenceDay: day,
      days: {
        [day]: { credits: captures, calls: captures, closeCaptures: captures, gameLineCredits: 0 },
      },
    })

    const missed = memoryFs()
    const missedPath = '/tmp/odds-api-budget-reader-miss.json'
    const missedDir = `${missedPath}.fences`
    missed.writeFileSync(missedPath, body(4, 40))
    missed.writeFileSync(`${missedDir}/5`, body(5, 40))
    missed.writeFileSync(`${missedDir}/6`, body(6, 40))
    const missedRead = missed.readFileSync.bind(missed)
    missed.readFileSync = (filePath) => {
      if (filePath === `${missedDir}/6`) {
        missed.files.delete(`${missedDir}/5`)
        missed.files.delete(`${missedDir}/6`)
        missed.files.set(missedPath, body(6, 40))
        const error = new Error(`ENOENT ${filePath}`)
        error.code = 'ENOENT'
        throw error
      }
      return missedRead(filePath)
    }
    const retried = loadOddsBudgetState({
      persistPath: missedPath,
      filesystem: missed,
      warn: false,
    })
    expect(retried.days[day].closeCaptures).toBe(40)
    expect(retried.fence).toBe(6)

    const kept = memoryFs()
    const keptPath = '/tmp/odds-api-budget-reader-keep.json'
    const keptDir = `${keptPath}.fences`
    kept.writeFileSync(keptPath, body(5, 40))
    kept.writeFileSync(`${keptDir}/6`, body(6, 40))
    const keptRead = kept.readFileSync.bind(kept)
    kept.readFileSync = (filePath) => {
      if (filePath === `${keptDir}/6`) {
        kept.files.delete(`${keptDir}/6`)
        kept.files.set(keptPath, body(0, 0))
        const error = new Error(`ENOENT ${filePath}`)
        error.code = 'ENOENT'
        throw error
      }
      return keptRead(filePath)
    }
    const seen = loadOddsBudgetState({
      persistPath: keptPath,
      filesystem: kept,
      warn: false,
    })
    expect(seen.days[day].closeCaptures).toBe(40)
    expect(seen.fence).toBe(5)
  })

  test('pointer failure keeps every fence and still drops temps older than 48h', () => {
    const fs = memoryFs()
    const ledger = '/tmp/odds-api-budget-prune.json'
    const day = '2026-11-04'
    const row = (captures) => ({
      credits: captures,
      calls: captures,
      closeCaptures: captures,
      gameLineCredits: 0,
    })
    const snapshot = (fence, captures) => JSON.stringify({
      version: 1,
      fence,
      fenceDay: day,
      days: { [day]: row(captures) },
    })
    fs.writeFileSync(ledger, snapshot(3, 1))
    fs.writeFileSync(`${ledger}.fences/1`, snapshot(1, 9))
    fs.writeFileSync(`${ledger}.fences/2`, snapshot(2, 1))
    fs.writeFileSync(`${ledger}.fences/3`, snapshot(3, 1))
    const oldMs = Date.now() - (49 * 60 * 60 * 1000)
    const oldTs = oldMs
    const keepTs = Date.now() - (60 * 60 * 1000)
    fs.writeFileSync(`${ledger}.9.${oldTs}.abcd.tmp`, 'old')
    fs.writeFileSync(`${ledger}.9.${keepTs}.abcd.tmp`, 'keep')
    const origWrite = fs.writeFileSync.bind(fs)
    const origRename = fs.renameSync.bind(fs)
    fs.writeFileSync = (filePath, data) => {
      if (filePath === ledger) throw new Error('pointer failed')
      return origWrite(filePath, data)
    }
    fs.renameSync = (from, to) => {
      if (to === ledger) throw new Error('pointer failed')
      return origRename(from, to)
    }
    const budget = createOddsApiBudget({
      persist: true,
      filesystem: fs,
      now: NOON_ET,
      purpose: 'close-capture',
      env: closeCaptureEnv(ledger),
      log: { log() {}, warn() {} },
    })
    const held = budget.reserve(1, { captures: 1 })
    expect(held.ok).toBe(true)
    expect(fs.existsSync(`${ledger}.fences/1`)).toBe(true)
    expect(fs.existsSync(`${ledger}.fences/2`)).toBe(true)
    expect(fs.existsSync(`${ledger}.fences/3`)).toBe(true)
    expect(fs.existsSync(`${ledger}.fences/4`)).toBe(true)
    expect(fs.existsSync(`${ledger}.9.${oldTs}.abcd.tmp`)).toBe(false)
    expect(fs.existsSync(`${ledger}.9.${keepTs}.abcd.tmp`)).toBe(true)
    const adopted = loadOddsBudgetState({
      persistPath: ledger,
      filesystem: fs,
      warn: false,
    })
    expect(adopted.days[day].closeCaptures).toBe(2)
    expect(adopted.fence).toBe(4)
  })

  test('a later ET day reserve survives pointer failure without deleting its fence', () => {
    const fs = memoryFs()
    const ledger = '/tmp/odds-api-budget-later-day.json'
    const nov4 = '2026-11-04'
    const nov7 = '2026-11-07'
    const prior = {
      version: 1,
      fence: 1,
      fenceDay: nov4,
      days: {
        [nov4]: { credits: 5, calls: 5, closeCaptures: 5, gameLineCredits: 0 },
      },
    }
    fs.writeFileSync(ledger, JSON.stringify(prior))
    fs.writeFileSync(`${ledger}.fences/1`, JSON.stringify(prior))
    const origWrite = fs.writeFileSync.bind(fs)
    const origRename = fs.renameSync.bind(fs)
    fs.writeFileSync = (filePath, data) => {
      if (filePath === ledger) throw new Error('pointer failed')
      return origWrite(filePath, data)
    }
    fs.renameSync = (from, to) => {
      if (to === ledger) throw new Error('pointer failed')
      return origRename(from, to)
    }
    const opts = {
      persist: true,
      filesystem: fs,
      now: new Date('2026-11-07T16:00:00.000Z'),
      purpose: 'close-capture',
      env: closeCaptureEnv(ledger),
      log: { log() {}, warn() {} },
    }
    const budget = createOddsApiBudget(opts)
    const held = budget.reserve(2)
    expect(held.ok).toBe(true)
    expect(held.dayKey).toBe(nov7)
    expect(fs.existsSync(`${ledger}.fences/2`)).toBe(true)
    expect(fs.existsSync(`${ledger}.fences/1`)).toBe(true)
    const reloaded = createOddsApiBudget(opts)
    expect(reloaded.todayCredits()).toBe(2)
    const adopted = loadOddsBudgetState({
      persistPath: ledger,
      filesystem: fs,
      warn: false,
    })
    expect(adopted.fence).toBe(2)
    expect(adopted.fenceDay).toBe(nov7)
    expect(adopted.days[nov7].credits).toBe(2)
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
