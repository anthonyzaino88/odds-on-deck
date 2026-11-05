import { PUBLISHED_COHORT_TAG, PUBLISHED_SOURCE, SHADOW_PUBLISHED_COHORT_TAG } from '../../lib/published-picks.js'
import {
  SNAPSHOT_SOURCE_CLOSE,
  SNAPSHOT_SOURCE_MIDDAY,
  SNAPSHOT_SOURCE_PREGAME,
  acquireSnapshotPassLock,
  buildSnapshotRow,
  formatSnapshotSpendMismatch,
  classifySnapshotJobs,
  eventQuotesAreFresh,
  formatSnapshotCredits,
  formatSnapshotEvents,
  formatSnapshotStatus,
  isMissingOddsSnapshotError,
  isSnapshotEligiblePick,
  latestStampByGameId,
  reconcileSnapshotSpend,
  remainingSnapshotPasses,
  sameLineQuotesForPick,
  saveHeldSnapshotRows,
  selectSnapshotJobs,
  shouldRefuseSnapshotStart,
  shouldSkipCloseCaptureWindow,
  snapshotSourceForKickoff,
} from '../../lib/odds-snapshot.js'

function publishedPick(overrides = {}) {
  return {
    id: 'pv-mack',
    propId: 'prop-mack',
    gameIdRef: 'BOS_at_TOR_2026-11-05',
    playerName: 'Nathan MacKinnon',
    propType: 'player_shots_on_goal',
    threshold: 3.5,
    prediction: 'over',
    odds: -115,
    edge: 0.07,
    qualityScore: 55,
    sport: 'nhl',
    source: PUBLISHED_SOURCE,
    status: 'pending',
    notes: PUBLISHED_COHORT_TAG,
    ...overrides,
  }
}

describe('odds snapshot helpers', () => {
  test('isSnapshotEligiblePick keeps Published-cohort pending rows only', () => {
    expect(isSnapshotEligiblePick(publishedPick())).toBe(true)
    expect(isSnapshotEligiblePick(publishedPick({
      notes: SHADOW_PUBLISHED_COHORT_TAG,
    }))).toBe(false)
    expect(isSnapshotEligiblePick(publishedPick({ notes: null }))).toBe(false)
    expect(isSnapshotEligiblePick(publishedPick({ source: 'user_saved' }))).toBe(false)
    expect(isSnapshotEligiblePick(publishedPick({ status: 'completed' }))).toBe(false)
    expect(isSnapshotEligiblePick(publishedPick({ edge: 0 }))).toBe(false)
    expect(isSnapshotEligiblePick(publishedPick({ qualityScore: 20 }))).toBe(false)
  })

  test('snapshotSourceForKickoff tags midday vs pregame and never close', () => {
    const now = new Date('2026-11-05T17:00:00.000Z')
    expect(snapshotSourceForKickoff('2026-11-05T23:00:00.000Z', now)).toBe(SNAPSHOT_SOURCE_MIDDAY)
    expect(snapshotSourceForKickoff('2026-11-05T18:30:00.000Z', now)).toBe(SNAPSHOT_SOURCE_PREGAME)
    expect(snapshotSourceForKickoff('2026-11-05T17:20:00.000Z', now)).toBe(SNAPSHOT_SOURCE_PREGAME)
    expect(snapshotSourceForKickoff('2026-11-05T17:20:00.000Z', now)).not.toBe(SNAPSHOT_SOURCE_CLOSE)
  })

  test('eventQuotesAreFresh uses 90-minute snapshot or cache stamps', () => {
    const now = new Date('2026-11-05T18:00:00.000Z')
    expect(eventQuotesAreFresh({
      snapshotAt: '2026-11-05T16:45:00.000Z',
      now,
    })).toBe(true)
    expect(eventQuotesAreFresh({
      cacheUpdatedAt: '2026-11-05T16:00:00.000Z',
      now,
    })).toBe(false)
    expect(eventQuotesAreFresh({
      cacheUpdatedAt: '2026-11-05T17:00:00.000Z',
      now,
    })).toBe(true)
  })

  test('shouldSkipCloseCaptureWindow requires kickoff after T−35', () => {
    const now = new Date('2026-11-05T17:00:00.000Z')
    expect(shouldSkipCloseCaptureWindow({
      date: '2026-11-05T17:20:00.000Z',
    }, now)).toBe(true)
    expect(shouldSkipCloseCaptureWindow({
      date: '2026-11-05T17:00:30.000Z',
    }, now)).toBe(true)
    expect(shouldSkipCloseCaptureWindow({
      date: '2026-11-05T19:00:00.000Z',
    }, now)).toBe(false)
  })

  test('shouldRefuseSnapshotStart covers :04:30 through :15 ET', () => {
    expect(shouldRefuseSnapshotStart(new Date('2026-11-05T04:04:31.000-05:00'))).toBe(true)
    expect(shouldRefuseSnapshotStart(new Date('2026-11-05T05:08:00.000-05:00'))).toBe(true)
    expect(shouldRefuseSnapshotStart(new Date('2026-11-05T04:04:29.000-05:00'))).toBe(false)
    expect(shouldRefuseSnapshotStart(new Date('2026-11-05T05:16:00.000-05:00'))).toBe(false)
  })

  test('classifySnapshotJobs skips close-window, fresh, and unmapped events', () => {
    const now = new Date('2026-11-05T17:00:00.000Z')
    const classified = classifySnapshotJobs([
      {
        gameId: 'soon',
        gameIds: ['soon'],
        eventId: 'evt-soon',
        game: { date: '2026-11-05T17:20:00.000Z' },
      },
      {
        gameId: 'fresh',
        gameIds: ['fresh'],
        eventId: 'evt-fresh',
        game: { date: '2026-11-05T21:00:00.000Z' },
      },
      {
        gameId: 'later',
        gameIds: ['later'],
        eventId: 'evt-later',
        game: { date: '2026-11-05T22:00:00.000Z' },
      },
      {
        gameId: 'bare',
        gameIds: ['bare'],
        eventId: null,
        game: { date: '2026-11-05T22:00:00.000Z' },
      },
    ], {
      now,
      latestSnapshots: new Map([['fresh', new Date('2026-11-05T16:20:00.000Z')]]),
    })
    expect(classified.skippedWindow.map((job) => job.gameId)).toEqual(['soon'])
    expect(classified.skippedFresh.map((job) => job.gameId)).toEqual(['fresh'])
    expect(classified.skippedUnmapped.map((job) => job.gameId)).toEqual(['bare'])
    expect(classified.fetchable.map((job) => job.gameId)).toEqual(['later'])
  })

  test('selectSnapshotJobs caps at 8 soonest events', () => {
    const jobs = Array.from({ length: 10 }, (_, i) => ({
      gameId: `g${i}`,
      eventId: `e${i}`,
      game: { date: new Date(Date.UTC(2026, 10, 5, 20, i)).toISOString() },
    }))
    const selected = selectSnapshotJobs(jobs, { maxEventCalls: 8 })
    expect(selected.jobs).toHaveLength(8)
    expect(selected.skippedCap).toHaveLength(2)
    expect(selected.jobs[0].gameId).toBe('g0')
    expect(selected.jobs[7].gameId).toBe('g7')
  })

  test('selectSnapshotJobs enforces the 24-credit pass cap', () => {
    const jobs = Array.from({ length: 8 }, (_, i) => ({
      gameId: `g${i}`,
      eventId: `e${i}`,
      game: { date: new Date(Date.UTC(2026, 10, 5, 20, i)).toISOString() },
      markets: ['a', 'b', 'c', 'd'],
    }))
    const selected = selectSnapshotJobs(jobs, { maxEventCalls: 8, maxCredits: 24 })
    expect(selected.jobs).toHaveLength(6)
    expect(selected.skippedCap).toHaveLength(2)
  })

  test('remainingSnapshotPasses defaults to two per ET day', () => {
    const now = new Date('2026-11-05T18:00:00.000Z')
    expect(remainingSnapshotPasses({ days: {} }, now)).toBe(2)
    expect(remainingSnapshotPasses({
      days: { '2026-11-05': { passes: 2 } },
    }, now)).toBe(0)
    expect(remainingSnapshotPasses({
      days: { '2026-11-05': { passes: 1 } },
    }, now, 2)).toBe(1)
  })

  test('isMissingOddsSnapshotError is code-only for 42P01 / 42703 / PGRST204', () => {
    expect(isMissingOddsSnapshotError({ code: '42P01' })).toBe(true)
    expect(isMissingOddsSnapshotError({ code: '42703' })).toBe(true)
    expect(isMissingOddsSnapshotError({ code: 'PGRST204' })).toBe(true)
    expect(isMissingOddsSnapshotError({ code: '23502', message: 'column does not exist' })).toBe(false)
    expect(isMissingOddsSnapshotError({ code: 'PGRST205', message: 'OddsSnapshot' })).toBe(false)
  })

  test('buildSnapshotRow is informational and refuses source=close', () => {
    const pick = publishedPick()
    const match = {
      odds: -120,
      bestOdds: -110,
      bestBook: 'FanDuel',
      numBooks: 4,
      sourceMarket: 'player_shots_on_goal',
    }
    const row = buildSnapshotRow({
      pick,
      game: { id: pick.gameIdRef, sport: 'nhl', date: '2026-11-05T23:00:00.000Z' },
      match,
      quotes: [{ book: 'FanDuel', odds: -110, last_update: '2026-11-05T17:00:00Z' }],
      capturedAt: new Date('2026-11-05T17:00:00.000Z'),
      source: SNAPSHOT_SOURCE_MIDDAY,
    })
    expect(row.propValidationId).toBe('pv-mack')
    expect(row.consensusOdds).toBe(-120)
    expect(row.bestOdds).toBe(-110)
    expect(row.bestBook).toBe('FanDuel')
    expect(row.source).toBe(SNAPSHOT_SOURCE_MIDDAY)
    expect(buildSnapshotRow({
      pick,
      match,
      capturedAt: new Date('2026-11-05T17:00:00.000Z'),
      source: SNAPSHOT_SOURCE_CLOSE,
    })).toBeNull()
  })

  test('sameLineQuotesForPick keeps the exact line only', () => {
    const pick = publishedPick()
    const { match, quotes } = sameLineQuotesForPick(pick, [
      {
        playerName: 'Nathan MacKinnon',
        market: 'player_shots_on_goal',
        pick: 'over',
        threshold: 3.5,
        odds: -118,
        book: 'DraftKings',
      },
      {
        playerName: 'Nathan MacKinnon',
        market: 'player_shots_on_goal',
        pick: 'over',
        threshold: 4.5,
        odds: 140,
        book: 'FanDuel',
      },
    ])
    expect(match.odds).toBe(-118)
    expect(quotes).toHaveLength(1)
    expect(quotes[0].book).toBe('DraftKings')
  })

  test('footer helpers and latestStampByGameId', () => {
    expect(formatSnapshotStatus('partial')).toBe('SNAPSHOT_STATUS=partial')
    expect(formatSnapshotEvents(3)).toBe('SNAPSHOT_EVENTS=3')
    expect(formatSnapshotCredits(16)).toBe('CREDITS=16')
    const latest = latestStampByGameId([
      { gameId: 'g1', capturedAt: '2026-11-05T16:00:00.000Z' },
      { gameId: 'g1', capturedAt: '2026-11-05T17:00:00.000Z' },
    ])
    expect(latest.get('g1').toISOString()).toBe('2026-11-05T17:00:00.000Z')
  })

  test('acquireSnapshotPassLock is exclusive until released', () => {
    const files = new Map()
    let currentPath = null
    const filesystem = {
      mkdirSync() {},
      openSync(filePath, flags) {
        if (flags === 'wx' && files.has(filePath)) {
          const err = new Error('EEXIST')
          err.code = 'EEXIST'
          throw err
        }
        files.set(filePath, '')
        currentPath = filePath
        return 1
      },
      writeFileSync(fdOrPath, contents) {
        const key = typeof fdOrPath === 'string' ? fdOrPath : currentPath
        if (key) files.set(key, String(contents))
      },
      readFileSync(filePath) {
        if (!files.has(filePath)) throw new Error('ENOENT')
        return files.get(filePath)
      },
      closeSync() {},
      unlinkSync(filePath) { files.delete(filePath) },
      statSync() { return { mtimeMs: Date.now() } },
    }
    const first = acquireSnapshotPassLock({
      persistPath: '/tmp/odds-snapshot-test.json',
      filesystem,
      persist: true,
    })
    expect(first.acquired).toBe(true)
    const second = acquireSnapshotPassLock({
      persistPath: '/tmp/odds-snapshot-test.json',
      filesystem,
      persist: true,
    })
    expect(second.acquired).toBe(false)
    first.release()
    const third = acquireSnapshotPassLock({
      persistPath: '/tmp/odds-snapshot-test.json',
      filesystem,
      persist: true,
    })
    expect(third.acquired).toBe(true)
    third.release()
  })

  test('stale-lock cleanup deletes only when the owner token is unchanged', () => {
    const stalePath = '/tmp/odds-snapshot-stale.json.lock'
    const tokens = ['owner-a', 'owner-b']
    let reads = 0
    let unlinked = false
    const filesystem = {
      mkdirSync() {},
      openSync() {
        const err = new Error('EEXIST')
        err.code = 'EEXIST'
        throw err
      },
      readFileSync() {
        const token = tokens[Math.min(reads, tokens.length - 1)]
        reads += 1
        return token
      },
      writeFileSync() {},
      closeSync() {},
      unlinkSync() { unlinked = true },
      statSync() { return { mtimeMs: Date.now() - 20 * 60 * 1000 } },
    }
    const result = acquireSnapshotPassLock({
      persistPath: '/tmp/odds-snapshot-stale.json',
      filesystem,
      persist: true,
      staleMs: 15 * 60 * 1000,
    })
    expect(result.acquired).toBe(false)
    expect(unlinked).toBe(false)
    expect(reads).toBeGreaterThanOrEqual(2)
  })

  test('stale-lock cleanup deletes when the owner token is unchanged', () => {
    const files = new Map([[ '/tmp/odds-snapshot-stale2.json.lock', 'owner-a' ]])
    let currentPath = null
    const filesystem = {
      mkdirSync() {},
      openSync(filePath, flags) {
        if (flags === 'wx' && files.has(filePath)) {
          const err = new Error('EEXIST')
          err.code = 'EEXIST'
          throw err
        }
        files.set(filePath, '')
        currentPath = filePath
        return 1
      },
      writeFileSync(fdOrPath, contents) {
        const key = typeof fdOrPath === 'string' ? fdOrPath : currentPath
        if (key) files.set(key, String(contents))
      },
      readFileSync(filePath) {
        if (!files.has(filePath)) throw new Error('ENOENT')
        return files.get(filePath)
      },
      closeSync() {},
      unlinkSync(filePath) { files.delete(filePath) },
      statSync() { return { mtimeMs: Date.now() - 20 * 60 * 1000 } },
    }
    const result = acquireSnapshotPassLock({
      persistPath: '/tmp/odds-snapshot-stale2.json',
      filesystem,
      persist: true,
      staleMs: 15 * 60 * 1000,
    })
    expect(result.acquired).toBe(true)
    result.release()
  })

  test('saveHeldSnapshotRows appends JSONL instead of overwriting', () => {
    const chunks = []
    const filesystem = {
      mkdirSync() {},
      appendFileSync(_filePath, line) { chunks.push(String(line)) },
    }
    const first = saveHeldSnapshotRows([{ id: 'a' }], {
      persistPath: '/tmp/odds-snapshot.json',
      filesystem,
      persist: true,
      now: new Date('2026-11-05T17:00:00.000Z'),
    })
    const second = saveHeldSnapshotRows([{ id: 'b' }], {
      persistPath: '/tmp/odds-snapshot.json',
      filesystem,
      persist: true,
      now: new Date('2026-11-05T17:10:00.000Z'),
    })
    expect(first).toMatch(/odds-snapshot-held\.jsonl$/)
    expect(second).toBe(first)
    expect(chunks).toHaveLength(2)
    expect(JSON.parse(chunks[0]).rows[0].id).toBe('a')
    expect(JSON.parse(chunks[1]).rows[0].id).toBe('b')
  })

  test('reconcileSnapshotSpend warns only when header deltas differ', () => {
    expect(reconcileSnapshotSpend({
      localCredits: 2,
      startUsed: 2000,
      endUsed: 2002,
      startRemaining: 12000,
      endRemaining: 11998,
    }).ok).toBe(true)
    const mismatch = reconcileSnapshotSpend({
      localCredits: 2,
      startUsed: 2000,
      endUsed: 2001,
      startRemaining: 12000,
      endRemaining: 11999,
    })
    expect(mismatch.ok).toBe(false)
    expect(formatSnapshotSpendMismatch(mismatch)).toBe(
      '⚠️ SNAPSHOT_SPEND_MISMATCH local=2 usedΔ=1 remainingΔ=1',
    )
    expect(formatSnapshotSpendMismatch({ ok: true })).toBeNull()
  })
})
