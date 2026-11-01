import { readFileSync } from 'fs'
import { join } from 'path'
import {
  NHL_REGRADE_FETCH_DELAY_MS,
  NFL_REGRADE_FETCH_DELAY_MS,
  REGRADE_BATCH_SIZE,
  REGRADE_GAME_SELECT,
  REGRADE_GRADE_SOURCE,
  REGRADE_REQUIRED_SOURCE,
  REGRADE_USAGE,
  buildRegradePreview,
  parseRegradeNeedsReviewArgs,
  regradeApplyPayload,
  regradePlanHash,
  runRegradeNeedsReview,
  validateRegradeNeedsReviewArgs,
} from '../../lib/regrade-needs-review.js'
import { lookupPlayerGameStat } from '../../lib/vendors/nhl-game-stats.js'
import { SHADOW_PUBLISHED_COHORT_TAG } from '../../lib/published-picks.js'

function needsReviewRow(overrides = {}) {
  return {
    id: 'pv-1',
    sport: 'mlb',
    propType: 'batter_hits',
    playerName: 'Nobody Fake',
    gameIdRef: 'KC_at_HOU_2026-09-17',
    threshold: 0.5,
    prediction: 'over',
    actualValue: null,
    result: null,
    status: 'needs_review',
    source: REGRADE_REQUIRED_SOURCE,
    notes: `${SHADOW_PUBLISHED_COHORT_TAG} | leftover`,
    timestamp: '2026-09-17T18:00:00.000Z',
    ...overrides,
  }
}

function finalMlbGame() {
  return {
    id: 'KC_at_HOU_2026-09-17',
    sport: 'mlb',
    status: 'final',
    homeScore: 5,
    awayScore: 3,
    mlbGameId: '824141',
    espnGameId: '401581234',
    homeId: 'MLB_117',
    awayId: 'MLB_118',
    home: { abbr: 'HOU' },
    away: { abbr: 'KC' },
  }
}

function verifiedMlbBox() {
  return {
    homeAbbr: 'HOU',
    awayAbbr: 'KC',
    homeRosterCount: 26,
    awayRosterCount: 26,
    playerNames: ['Jose Altuve', 'Bobby Witt Jr.'],
  }
}

function packedMlbBox(box = verifiedMlbBox()) {
  return { players: { _present: true }, box }
}

function unmatchedMlbLookup() {
  return { reason: 'not_in_box', matchStatus: 'unmatched', value: null }
}

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
  }
}

function mockClient(rows, updates, {
  games = [],
  counts = {},
  recountRows = rows,
  gameError = null,
  updateData,
  eqPairs = [],
} = {}) {
  const resolvedUpdateData = updateData === undefined
    ? rows.map((row) => ({ id: row.id }))
    : updateData
  return {
    from(table) {
      const query = {
        _count: false,
        _head: false,
        select(cols, options) {
          query._count = Boolean(options?.count)
          query._head = Boolean(options?.head)
          query._select = cols
          return query
        },
        eq() { return query },
        in() { return query },
        gte() { return query },
        lt() { return query },
        order() { return query },
        range() {
          if (table === 'Game') {
            return Promise.resolve({
              data: gameError ? null : (games.length ? games : [finalMlbGame()]),
              error: gameError,
            })
          }
          return Promise.resolve({ data: query._head ? [] : recountRows, error: null })
        },
        then(onFulfilled) {
          if (table === 'PropValidation' && query._count) {
            return Promise.resolve({
              count: counts.needs_review ?? rows.length,
              error: null,
            }).then(onFulfilled)
          }
          if (table === 'Game') {
            return Promise.resolve({
              data: gameError ? null : (games.length ? games : [finalMlbGame()]),
              error: gameError,
            }).then(onFulfilled)
          }
          return Promise.resolve({ data: rows, error: null }).then(onFulfilled)
        },
        update(payload) {
          updates.push(payload)
          const chain = {
            eq(col, val) {
              eqPairs.push([col, val])
              return chain
            },
            select() {
              return Promise.resolve({ data: resolvedUpdateData, error: null })
            },
          }
          return chain
        },
      }
      return query
    },
  }
}

const dryRunDeps = {
  lookupMlb: unmatchedMlbLookup,
  fetchMlbBoxscore: async () => packedMlbBox(),
}

describe('regrade-needs-review CLI flags', () => {
  test('defaults to dry-run and requires sport, source, and ids or dates', () => {
    expect(parseRegradeNeedsReviewArgs([])).toMatchObject({ apply: false, dryRun: true })
    expect(validateRegradeNeedsReviewArgs(parseRegradeNeedsReviewArgs([
      '--sport', 'mlb',
    ])).ok).toBe(false)
    expect(validateRegradeNeedsReviewArgs(parseRegradeNeedsReviewArgs([
      '--sport', 'mlb',
      '--source', 'user_saved',
      '--ids', 'pv-1',
    ])).error).toMatch(/system_generated/)
    expect(validateRegradeNeedsReviewArgs(parseRegradeNeedsReviewArgs([
      '--sport', 'mlb',
      '--source', REGRADE_REQUIRED_SOURCE,
    ])).error).toMatch(/--ids or a --from\/--to/)
    expect(validateRegradeNeedsReviewArgs(parseRegradeNeedsReviewArgs([
      '--sport', 'mlb',
      '--source', REGRADE_REQUIRED_SOURCE,
      '--from', '2026-09-17',
      '--to', '2026-09-17',
    ])).ok).toBe(true)
    expect(parseRegradeNeedsReviewArgs(['--ids', 'a,b', '--ids', 'c']).ids).toEqual(['a', 'b', 'c'])
  })
})

describe('regrade preview payloads', () => {
  test('MLB not-in-box on a final verified game becomes a void plan', () => {
    const preview = buildRegradePreview(
      needsReviewRow(),
      { reason: 'not_in_box', matchStatus: 'unmatched', value: null },
      finalMlbGame(),
      { sport: 'mlb', gameFinal: true, gameIdVerified: true, box: verifiedMlbBox() },
    )
    expect(preview).toMatchObject({
      action: 'void',
      newStatus: 'manual_closed',
      newResult: 'void',
      reason: 'not_in_box',
    })
    const payload = regradeApplyPayload(
      needsReviewRow(),
      preview,
      finalMlbGame(),
      new Date('2026-10-10T12:00:00Z'),
    )
    expect(payload).toMatchObject({
      result: 'void',
      status: 'manual_closed',
      actualValue: null,
      gradeSource: REGRADE_GRADE_SOURCE,
    })
    expect(payload.notes).toMatch(/cohort:shadow-published/)
    expect(payload.notes).toMatch(/DNP: not_in_box/)
  })

  test('NFL missing from the box stays skip/needs_review', () => {
    const preview = buildRegradePreview(
      needsReviewRow({ sport: 'nfl', playerName: 'Noah Fant' }),
      null,
      { id: 'PHI_at_KC_2025-09-05', sport: 'nfl', espnGameId: '401547353', status: 'final', homeScore: 24, awayScore: 21 },
      { sport: 'nfl', gameFinal: true, gameIdVerified: true },
    )
    expect(preview.action).toBe('skip')
    expect(preview.newStatus).toBe('needs_review')
    expect(regradeApplyPayload(needsReviewRow(), preview, {}, new Date())).toBeNull()
  })

  test('NFL numeric 0 from a missing category grades', () => {
    const preview = buildRegradePreview(
      needsReviewRow({ sport: 'nfl', playerName: 'Jalen Hurts', propType: 'rushing_yards' }),
      0,
      null,
      { sport: 'nfl', gameFinal: true, gameIdVerified: true },
    )
    expect(preview).toMatchObject({
      action: 'grade',
      newStatus: 'completed',
      newResult: 'incorrect',
      actualValue: 0,
    })
  })

  test('NFL structured roster voids and fail-closed skips use the same preview path', () => {
    const game = {
      id: 'PHI_at_KC_2025-09-05',
      sport: 'nfl',
      espnGameId: '401547353',
      status: 'final',
      homeScore: 24,
      awayScore: 21,
    }
    expect(buildRegradePreview(
      needsReviewRow({ sport: 'nfl', playerName: 'Tyson Bagent', propType: 'player_passing_yards' }),
      { didNotPlay: true, reason: 'dnp_no_snap', matchStatus: 'matched', value: null },
      game,
      { sport: 'nfl', gameFinal: true, gameIdVerified: true },
    )).toMatchObject({ action: 'void', newStatus: 'manual_closed', reason: 'dnp_no_snap' })
    expect(buildRegradePreview(
      needsReviewRow({ sport: 'nfl', playerName: 'Darius Slayton' }),
      { didNotPlay: true, reason: 'not_on_roster', matchStatus: 'not_on_roster', value: null },
      game,
      { sport: 'nfl', gameFinal: true, gameIdVerified: true },
    )).toMatchObject({ action: 'void', reason: 'not_on_roster' })
    expect(buildRegradePreview(
      needsReviewRow({ sport: 'nfl', playerName: 'Noah Fant' }),
      { reason: 'fetch_error', matchStatus: 'fetch_error', value: null, didNotPlay: false },
      game,
      { sport: 'nfl', gameFinal: true, gameIdVerified: true },
    )).toMatchObject({ action: 'skip', newStatus: 'needs_review', reason: 'fetch_error' })
  })
})

describe('runRegradeNeedsReview', () => {
  test('--help does not touch the database', async () => {
    const createClient = jest.fn()
    const result = await runRegradeNeedsReview({
      argv: ['--help'],
      createClient,
      log: memoryLog(),
    })
    expect(result.exitCode).toBe(0)
    expect(createClient).not.toHaveBeenCalled()
    expect(REGRADE_USAGE).toMatch(/Rollback/)
    expect(REGRADE_USAGE).toMatch(/--conditions=react-server/)
    expect(REGRADE_USAGE).toMatch(/re-run the dry-run/)
  })

  test('dry-run writes a plan CSV and never updates', async () => {
    const updates = []
    const files = {}
    const log = memoryLog()
    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1'],
      createClient: () => mockClient([needsReviewRow()], updates),
      ...dryRunDeps,
      mkdir: () => {},
      writeFile: (path, body) => { files[path] = body },
      now: new Date('2026-10-10T16:20:00Z'),
      isQuietPeriod: () => false,
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.applied).toBe(0)
    expect(updates).toHaveLength(0)
    expect(result.summary.voids).toBe(1)
    expect(result.hash).toBe(regradePlanHash(result.plan))
    expect(Object.keys(files).some((path) => path.endsWith('-plan.csv'))).toBe(true)
    expect(Object.values(files)[0]).toMatch(/pv-1/)
    expect(log.lines.join('\n')).toMatch(/DRY-RUN/)
    expect(log.lines.join('\n')).toMatch(/Rollback/)
  })

  test('--apply without the plan hash refuses and tells the operator to re-run the dry-run', async () => {
    const updates = []
    const log = memoryLog()
    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1', '--apply'],
      createClient: () => mockClient([needsReviewRow()], updates),
      ...dryRunDeps,
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => false,
      log,
    })
    expect(result.confirmMismatch).toBe(true)
    expect(result.applied).toBe(0)
    expect(updates).toHaveLength(0)
    expect(log.lines.join('\n')).toMatch(/Re-run the dry-run/)
  })

  test('refuses --apply during :05–:15 ET', async () => {
    const updates = []
    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1', '--apply', '--confirm', 'nope'],
      createClient: () => mockClient([needsReviewRow()], updates),
      ...dryRunDeps,
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => true,
      log: memoryLog(),
    })
    expect(result.quiet).toBe(true)
    expect(updates).toHaveLength(0)
  })

  test('throws when the Game query errors instead of skipping rows', async () => {
    await expect(runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1'],
      createClient: () => mockClient([needsReviewRow()], [], {
        gameError: { message: 'column Game.homeTeam does not exist' },
      }),
      ...dryRunDeps,
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => false,
      log: memoryLog(),
    })).rejects.toThrow(/Game lookup failed: column Game\.homeTeam does not exist/)
  })

  test('--apply --confirm writes after JSONL backup and recounts status', async () => {
    const updates = []
    const files = {}
    const eqPairs = []
    const rows = [needsReviewRow()]
    const client = mockClient(rows, updates, { counts: { needs_review: 1 }, eqPairs })

    const dry = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1'],
      createClient: () => client,
      ...dryRunDeps,
      mkdir: () => {},
      writeFile: (path, body) => { files[path] = body },
      isQuietPeriod: () => false,
      now: new Date('2026-10-10T16:20:00Z'),
      log: memoryLog(),
    })

    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1', '--apply', '--confirm', dry.hash],
      createClient: () => client,
      ...dryRunDeps,
      mkdir: () => {},
      writeFile: (path, body) => { files[path] = body },
      isQuietPeriod: () => false,
      now: new Date('2026-10-10T16:20:00Z'),
      log: memoryLog(),
    })

    expect(result.applied).toBe(1)
    expect(updates[0]).toMatchObject({
      result: 'void',
      status: 'manual_closed',
      gradeSource: REGRADE_GRADE_SOURCE,
    })
    expect(eqPairs).toEqual(expect.arrayContaining([
      ['id', 'pv-1'],
      ['status', 'needs_review'],
    ]))
    expect(Object.keys(files).some((path) => path.endsWith('-rows.jsonl'))).toBe(true)
    expect(Object.values(files).some((body) => String(body).includes('pv-1') && String(body).includes('Nobody Fake'))).toBe(true)
    expect(result.recount).toBeDefined()
  })

  test('applied count uses .select() and ignores 0-row updates', async () => {
    const updates = []
    const rows = [needsReviewRow()]
    const dryClient = mockClient(rows, [])
    const dry = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1'],
      createClient: () => dryClient,
      ...dryRunDeps,
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => false,
      now: new Date('2026-10-10T16:20:00Z'),
      log: memoryLog(),
    })

    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1', '--apply', '--confirm', dry.hash],
      createClient: () => mockClient(rows, updates, {
        counts: { needs_review: 1 },
        updateData: [],
      }),
      ...dryRunDeps,
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => false,
      now: new Date('2026-10-10T16:20:00Z'),
      log: memoryLog(),
    })

    expect(updates).toHaveLength(1)
    expect(result.applied).toBe(0)
  })
})

describe('operations/regrade-needs-review.mjs contract', () => {
  test('uses supabaseAdmin, audit, cohort notes, and the quiet window', () => {
    const src = readFileSync(join(process.cwd(), 'operations/regrade-needs-review.mjs'), 'utf8')
    expect(src).toMatch(/supabaseAdmin/)
    expect(src).toMatch(/--conditions=react-server/)
    expect(src).toMatch(/runRegradeNeedsReview/)
    expect(src).toMatch(/Rollback/)
    expect(src).toMatch(/fetchMlbGradeBox/)
    expect(src).toMatch(/re-run the dry-run/)
    expect(REGRADE_BATCH_SIZE).toBe(25)
    expect(REGRADE_GAME_SELECT).toMatch(/homeId/)
    expect(REGRADE_GAME_SELECT).toMatch(/awayId/)
    expect(REGRADE_GAME_SELECT).toMatch(/Team!Game_homeId_fkey\(abbr\)/)
    expect(REGRADE_GAME_SELECT).toMatch(/Team!Game_awayId_fkey\(abbr\)/)
    expect(REGRADE_GAME_SELECT).not.toMatch(/homeTeam/)
    expect(REGRADE_GAME_SELECT).not.toMatch(/awayTeam/)
    const lib = readFileSync(join(process.cwd(), 'lib/regrade-needs-review.js'), 'utf8')
    expect(lib).toMatch(/updateWithOptionalAudit/)
    expect(lib).toMatch(/propValidationGradeAudit/)
    expect(lib).toMatch(/voidPropValidationPatch/)
    expect(lib).toMatch(/withPreservedCohortNotes/)
    expect(lib).toMatch(/eq\('id'/)
    expect(lib).toMatch(/eq\('status', 'needs_review'\)/)
    expect(lib).toMatch(/select\('id'\)/)
    expect(lib).toMatch(/isOpsWriteQuietPeriod|isQuietPeriod/)
    expect(lib).toMatch(/REGRADE_BATCH_SIZE = 25/)
    expect(lib).toMatch(/throw new Error\(`Game lookup failed/)
    expect(lib).toMatch(/createNhlLookupCache/)
    expect(lib).toMatch(/createNflLookupCache/)
    expect(lib).toMatch(/fetchDelayMs/)
    expect(lib).toMatch(/Fetch errors/)
    expect(NHL_REGRADE_FETCH_DELAY_MS).toBe(350)
    expect(NFL_REGRADE_FETCH_DELAY_MS).toBe(350)
    const ops = readFileSync(join(process.cwd(), 'operations/regrade-needs-review.mjs'), 'utf8')
    expect(ops).toMatch(/lookupPlayerGameStat as lookupNflStat/)
  })
})

describe('NHL regrade fetch errors', () => {
  function nhlRow(overrides = {}) {
    return needsReviewRow({
      id: 'pv-nhl-1',
      sport: 'nhl',
      playerName: 'Charlie Coyle',
      propType: 'player_shots_on_goal',
      gameIdRef: 'NYR_at_BOS_2026-01-01',
      ...overrides,
    })
  }

  function nhlGame() {
    return {
      id: 'NYR_at_BOS_2026-01-01',
      sport: 'nhl',
      status: 'final',
      espnGameId: '401802099',
      homeScore: 3,
      awayScore: 2,
      home: { abbr: 'BOS' },
      away: { abbr: 'NYR' },
    }
  }

  test('paces NHL lookups at ~350ms and reports fetch-error skips', async () => {
    const lookupNhl = jest.fn(async () => ({
      reason: 'fetch_error',
      matchStatus: 'fetch_error',
      value: null,
      didNotPlay: false,
      gameFinal: false,
      status: 503,
    }))
    const log = memoryLog()
    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'nhl', '--source', 'system_generated', '--ids', 'pv-nhl-1'],
      createClient: () => mockClient([nhlRow()], [], { games: [nhlGame()] }),
      lookupNhl,
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => false,
      now: new Date('2026-10-10T16:20:00Z'),
      log,
    })
    expect(result.exitCode).toBe(0)
    expect(result.summary.voids).toBe(0)
    expect(result.summary.fetchErrors).toBe(1)
    expect(result.plan[0]).toMatchObject({
      action: 'skip',
      newStatus: 'needs_review',
      reason: 'fetch_error',
    })
    expect(lookupNhl).toHaveBeenCalledWith(
      '401802099',
      'Charlie Coyle',
      'player_shots_on_goal',
      'NYR_at_BOS_2026-01-01',
      expect.objectContaining({
        fetchDelayMs: 350,
        cache: expect.any(Object),
      }),
    )
    expect(log.lines.join('\n')).toMatch(/Fetch errors: 1/)
  })

  test('persistent 429 aborts remaining NHL rows as skip, not void', async () => {
    const lookupNhl = jest.fn(async () => ({
      reason: 'fetch_error',
      matchStatus: 'fetch_error',
      value: null,
      didNotPlay: false,
      gameFinal: false,
      status: 429,
    }))
    const rows = [
      nhlRow({ id: 'pv-nhl-1' }),
      nhlRow({ id: 'pv-nhl-2', playerName: 'Jack Hughes' }),
    ]
    const log = memoryLog()
    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'nhl', '--source', 'system_generated', '--ids', 'pv-nhl-1,pv-nhl-2'],
      createClient: () => mockClient(rows, [], { games: [nhlGame()] }),
      lookupNhl,
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => false,
      now: new Date('2026-10-10T16:20:00Z'),
      log,
    })
    expect(lookupNhl).toHaveBeenCalledTimes(1)
    expect(result.nhlAborted).toBe(true)
    expect(result.summary.voids).toBe(0)
    expect(result.summary.fetchErrors).toBe(2)
    expect(result.plan.every((row) => row.action === 'skip' && row.reason === 'fetch_error')).toBe(true)
    expect(log.lines.join('\n')).toMatch(/Aborted remaining NHL lookups/)
    expect(log.lines.join('\n')).toMatch(/Fetch errors: 2/)
  })

  test('live lookup of a play-by-play 429 does not plan a void', async () => {
    const sleep = jest.fn(async () => {})
    global.fetch = jest.fn((url) => {
      const href = String(url)
      if (href.includes('/schedule/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => null },
          json: async () => ({
            gameWeek: [{
              games: [{
                id: 2026020101,
                awayTeam: { abbrev: 'NYR' },
                homeTeam: { abbrev: 'BOS' },
              }],
            }],
          }),
        })
      }
      if (href.includes('/boxscore')) {
        const home = Array.from({ length: 15 }, (_, i) => ({
          playerId: 8476000 + i,
          name: { default: `BOS ${i}` },
          sog: 1,
          toi: '12:00',
        }))
        home[0] = { playerId: 8475745, name: { default: 'C. Coyle' }, sog: 4, toi: '18:22' }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => null },
          json: async () => ({
            gameState: 'OFF',
            homeTeam: { id: 6, abbrev: 'BOS' },
            awayTeam: { id: 3, abbrev: 'NYR' },
            playerByGameStats: {
              homeTeam: { forwards: home, defense: [], goalies: [] },
              awayTeam: {
                forwards: Array.from({ length: 15 }, (_, i) => ({
                  playerId: 8477000 + i,
                  name: { default: `NYR ${i}` },
                  sog: 0,
                  toi: '11:00',
                })),
                defense: [],
                goalies: [],
              },
            },
          }),
        })
      }
      if (href.includes('/play-by-play')) {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? '60' : null) },
          json: async () => ({}),
        })
      }
      return Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Error',
        headers: { get: () => null },
        json: async () => ({}),
      })
    })

    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'nhl', '--source', 'system_generated', '--ids', 'pv-nhl-1'],
      createClient: () => mockClient([nhlRow()], [], { games: [nhlGame()] }),
      lookupNhl: lookupPlayerGameStat,
      nhlFetchDelayMs: 0,
      sleep,
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => false,
      now: new Date('2026-10-10T16:20:00Z'),
      log: memoryLog(),
    })

    expect(result.summary.voids).toBe(0)
    expect(result.plan[0]).toMatchObject({
      action: 'skip',
      newStatus: 'needs_review',
      reason: 'fetch_error',
    })
    expect(result.nhlAborted).toBe(true)
  })
})

describe('NFL regrade roster path', () => {
  function nflRow(overrides = {}) {
    return needsReviewRow({
      id: 'pv-nfl-1',
      sport: 'nfl',
      playerName: 'Noah Fant',
      propType: 'player_receptions',
      gameIdRef: 'PHI_at_KC_2025-09-05',
      ...overrides,
    })
  }

  function nflGame() {
    return {
      id: 'PHI_at_KC_2025-09-05',
      sport: 'nfl',
      status: 'final',
      espnGameId: '401547353',
      homeScore: 24,
      awayScore: 21,
      date: '2025-09-05T00:20:00.000Z',
      home: { abbr: 'KC' },
      away: { abbr: 'PHI' },
    }
  }

  test('dry-run uses the structured NFL lookup with cache and pacing', async () => {
    const lookupNfl = jest.fn(async () => ({
      value: 0,
      matchStatus: 'matched',
      statFound: true,
      gameFinal: true,
      didNotPlay: false,
      reason: 'appeared',
    }))
    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'nfl', '--source', 'system_generated', '--ids', 'pv-nfl-1'],
      createClient: () => mockClient([nflRow()], [], { games: [nflGame()] }),
      lookupNfl,
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => false,
      now: new Date('2026-10-10T16:20:00Z'),
      log: memoryLog(),
    })
    expect(result.exitCode).toBe(0)
    expect(result.applied).toBe(0)
    expect(result.summary.grades).toBe(1)
    expect(result.plan[0]).toMatchObject({ action: 'grade', actualValue: 0, reason: 'appeared' })
    expect(lookupNfl).toHaveBeenCalledWith(
      '401547353',
      'Noah Fant',
      'player_receptions',
      expect.objectContaining({
        fetchDelayMs: 350,
        cache: expect.any(Object),
        game: expect.objectContaining({ espnGameId: '401547353' }),
      }),
    )
  })

  test('NFL fetch_error stays skip/needs_review and never voids', async () => {
    const lookupNfl = jest.fn(async () => ({
      reason: 'fetch_error',
      matchStatus: 'fetch_error',
      value: null,
      didNotPlay: false,
      status: 503,
    }))
    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'nfl', '--source', 'system_generated', '--ids', 'pv-nfl-1'],
      createClient: () => mockClient([nflRow()], [], { games: [nflGame()] }),
      lookupNfl,
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => false,
      now: new Date('2026-10-10T16:20:00Z'),
      log: memoryLog(),
    })
    expect(result.summary.voids).toBe(0)
    expect(result.summary.fetchErrors).toBe(1)
    expect(result.plan[0]).toMatchObject({
      action: 'skip',
      newStatus: 'needs_review',
      reason: 'fetch_error',
    })
  })
})
