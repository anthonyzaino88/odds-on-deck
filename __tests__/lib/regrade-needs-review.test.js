import { readFileSync } from 'fs'
import { join } from 'path'
import {
  REGRADE_BATCH_SIZE,
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
  }
}

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
  }
}

function mockClient(rows, updates, { games = [], counts = {}, recountRows = rows } = {}) {
  return {
    from(table) {
      const query = {
        _count: false,
        _head: false,
        select(cols, options) {
          query._count = Boolean(options?.count)
          query._head = Boolean(options?.head)
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
              data: games.length ? games : [finalMlbGame()],
              error: null,
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
              data: games.length ? games : [finalMlbGame()],
              error: null,
            }).then(onFulfilled)
          }
          return Promise.resolve({ data: rows, error: null }).then(onFulfilled)
        },
        update(payload) {
          updates.push(payload)
          return {
            eq() {
              return {
                eq: async () => ({ error: null }),
              }
            },
          }
        },
      }
      return query
    },
  }
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
      { sport: 'mlb', gameFinal: true, gameIdVerified: true },
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
  })

  test('dry-run writes a plan CSV and never updates', async () => {
    const updates = []
    const files = {}
    const log = memoryLog()
    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1'],
      createClient: () => mockClient([needsReviewRow()], updates),
      lookupMlb: () => ({ reason: 'not_in_box', matchStatus: 'unmatched', value: null }),
      fetchMlbBoxscore: async () => ({}),
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

  test('--apply without the plan hash refuses', async () => {
    const updates = []
    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1', '--apply'],
      createClient: () => mockClient([needsReviewRow()], updates),
      lookupMlb: () => ({ reason: 'not_in_box', matchStatus: 'unmatched', value: null }),
      fetchMlbBoxscore: async () => ({}),
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => false,
      log: memoryLog(),
    })
    expect(result.confirmMismatch).toBe(true)
    expect(result.applied).toBe(0)
    expect(updates).toHaveLength(0)
  })

  test('refuses --apply during :05–:15 ET', async () => {
    const updates = []
    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1', '--apply', '--confirm', 'nope'],
      createClient: () => mockClient([needsReviewRow()], updates),
      lookupMlb: () => ({ reason: 'not_in_box', matchStatus: 'unmatched', value: null }),
      fetchMlbBoxscore: async () => ({}),
      mkdir: () => {},
      writeFile: () => {},
      isQuietPeriod: () => true,
      log: memoryLog(),
    })
    expect(result.quiet).toBe(true)
    expect(updates).toHaveLength(0)
  })

  test('--apply --confirm writes after JSONL backup and recounts status', async () => {
    const updates = []
    const files = {}
    const eqPairs = []
    const rows = [needsReviewRow()]
    const client = mockClient(rows, updates, { counts: { needs_review: 1 } })
    const origFrom = client.from.bind(client)
    client.from = (table) => {
      const query = origFrom(table)
      if (table !== 'PropValidation') return query
      const origUpdate = query.update.bind(query)
      query.update = (payload) => {
        const chain = origUpdate(payload)
        const firstEq = chain.eq
        chain.eq = (col, val) => {
          eqPairs.push([col, val])
          const second = firstEq(col, val)
          const secondEq = second.eq
          second.eq = async (col2, val2) => {
            eqPairs.push([col2, val2])
            return secondEq(col2, val2)
          }
          return second
        }
        return chain
      }
      return query
    }

    const dry = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1'],
      createClient: () => client,
      lookupMlb: () => ({ reason: 'not_in_box', matchStatus: 'unmatched', value: null }),
      fetchMlbBoxscore: async () => ({}),
      mkdir: () => {},
      writeFile: (path, body) => { files[path] = body },
      isQuietPeriod: () => false,
      now: new Date('2026-10-10T16:20:00Z'),
      log: memoryLog(),
    })

    const result = await runRegradeNeedsReview({
      argv: ['--sport', 'mlb', '--source', 'system_generated', '--ids', 'pv-1', '--apply', '--confirm', dry.hash],
      createClient: () => client,
      lookupMlb: () => ({ reason: 'not_in_box', matchStatus: 'unmatched', value: null }),
      fetchMlbBoxscore: async () => ({}),
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
})

describe('operations/regrade-needs-review.mjs contract', () => {
  test('uses supabaseAdmin, audit, cohort notes, and the quiet window', () => {
    const src = readFileSync(join(process.cwd(), 'operations/regrade-needs-review.mjs'), 'utf8')
    expect(src).toMatch(/supabaseAdmin/)
    expect(src).toMatch(/--conditions=react-server/)
    expect(src).toMatch(/runRegradeNeedsReview/)
    expect(src).toMatch(/Rollback/)
    expect(REGRADE_BATCH_SIZE).toBe(25)
    const lib = readFileSync(join(process.cwd(), 'lib/regrade-needs-review.js'), 'utf8')
    expect(lib).toMatch(/updateWithOptionalAudit/)
    expect(lib).toMatch(/propValidationGradeAudit/)
    expect(lib).toMatch(/voidPropValidationPatch/)
    expect(lib).toMatch(/withPreservedCohortNotes/)
    expect(lib).toMatch(/eq\('id'/)
    expect(lib).toMatch(/eq\('status', 'needs_review'\)/)
    expect(lib).toMatch(/isOpsWriteQuietPeriod|isQuietPeriod/)
    expect(lib).toMatch(/REGRADE_BATCH_SIZE = 25/)
  })
})
