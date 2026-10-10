import {
  buildDnpRepairPreview,
  compareRepairIdsToCsv,
  dnpRepairApplyPayload,
  isDnpRepairCandidate,
  parseDnpCsvIds,
  parseRepairDnpArgs,
  publishedSummariesAfterVoids,
  REPAIR_GRADE_SOURCE,
  shouldApplyDnpPreview,
  summarizeDnpPreviews,
} from '../../lib/repair-dnp-grades.js'
import { runRepairDnpGrades } from '../../scripts/repair-dnp-grades.js'
import { PUBLISHED_SOURCE } from '../../lib/published-picks.js'

function dnpRow(overrides = {}) {
  return {
    id: 'pv-vinnie',
    sport: 'mlb',
    propType: 'batter_hits',
    playerName: 'Vinnie Pasquantino',
    gameIdRef: 'KC_at_HOU_2026-09-17',
    threshold: 0.5,
    prediction: 'over',
    actualValue: 0,
    result: 'incorrect',
    status: 'completed',
    odds: 2.88,
    edge: 0.05,
    qualityScore: 45,
    source: PUBLISHED_SOURCE,
    ...overrides,
  }
}

describe('repair-dnp-grades CLI flags', () => {
  test('defaults to dry-run; --apply is required to write', () => {
    expect(parseRepairDnpArgs([])).toMatchObject({ apply: false, dryRun: true })
    expect(parseRepairDnpArgs(['--dry-run'])).toMatchObject({ apply: false, dryRun: true })
    expect(parseRepairDnpArgs(['--apply'])).toMatchObject({ apply: true, dryRun: false })
    expect(parseRepairDnpArgs(['--apply', '--dry-run'])).toMatchObject({ apply: false, dryRun: true })
    expect(parseRepairDnpArgs(['--csv', 'rows.csv']).csv).toBe('rows.csv')
  })
})

describe('DNP repair candidates and previews', () => {
  test('only completed 0-actual MLB/NHL player props', () => {
    expect(isDnpRepairCandidate(dnpRow())).toBe(true)
    expect(isDnpRepairCandidate(dnpRow({ sport: 'nhl' }))).toBe(true)
    expect(isDnpRepairCandidate(dnpRow({ sport: 'nfl' }))).toBe(false)
    expect(isDnpRepairCandidate(dnpRow({ actualValue: 1 }))).toBe(false)
    expect(isDnpRepairCandidate(dnpRow({ result: 'void', status: 'manual_closed' }))).toBe(false)
    expect(isDnpRepairCandidate(dnpRow({ source: 'game_line' }))).toBe(false)
  })

  test('DNP lookup becomes void; appeared 0 is skipped', () => {
    const voidPreview = buildDnpRepairPreview(dnpRow(), {
      didNotPlay: true,
      reason: 'no_plate_appearances',
      value: null,
    })
    expect(voidPreview).toMatchObject({
      skip: false,
      oldResult: 'incorrect',
      newResult: 'void',
      player: 'Vinnie Pasquantino',
      prop: 'batter_hits',
    })
    expect(shouldApplyDnpPreview(voidPreview)).toBe(true)

    const appeared = buildDnpRepairPreview(dnpRow({ playerName: 'Cam Smith' }), {
      didNotPlay: false,
      reason: 'appeared',
      value: 0,
    })
    expect(appeared.skip).toBe(true)
    expect(appeared.skipReason).toBe('appeared')
    expect(shouldApplyDnpPreview(appeared)).toBe(false)
  })

  test('apply payload matches cancelled-game void status and is idempotent', () => {
    const preview = buildDnpRepairPreview(dnpRow(), {
      didNotPlay: true,
      reason: 'no_plate_appearances',
      value: null,
    })
    const payload = dnpRepairApplyPayload(dnpRow(), preview, { status: 'final' }, new Date('2026-10-10T12:00:00Z'))
    expect(payload).toMatchObject({
      result: 'void',
      status: 'manual_closed',
      actualValue: null,
      gradeSource: REPAIR_GRADE_SOURCE,
    })
    expect(payload.notes).toMatch(/DNP: no_plate_appearances/)

    const already = buildDnpRepairPreview(dnpRow({ result: 'void', status: 'manual_closed' }), {
      didNotPlay: true,
      reason: 'no_plate_appearances',
    })
    expect(already.skipReason).toBe('already_void')
    expect(shouldApplyDnpPreview(already)).toBe(false)
  })

  test('CSV diff and Published overlay', () => {
    expect(parseDnpCsvIds('id,player\npv-vinnie,Vinnie\npv-other,X\n')).toEqual(new Set(['pv-vinnie', 'pv-other']))
    const diff = compareRepairIdsToCsv(['pv-vinnie', 'pv-new'], ['pv-vinnie', 'pv-other'])
    expect(diff.both).toEqual(['pv-vinnie'])
    expect(diff.onlyInRepair).toEqual(['pv-new'])
    expect(diff.onlyInCsv).toEqual(['pv-other'])

    const published = [
      dnpRow({ id: 'pub-1', result: 'incorrect', odds: -110 }),
      dnpRow({ id: 'pub-keep', result: 'correct', actualValue: 2, playerName: 'Yordan Alvarez' }),
    ]
    const { before, after } = publishedSummariesAfterVoids(published, ['pub-1'])
    expect(before.incorrect).toBe(1)
    expect(before.correct).toBe(1)
    expect(after.incorrect).toBe(0)
    expect(after.correct).toBe(1)
    expect(after.decided).toBe(1)
  })

  test('summary counts ready voids vs appeared skips', () => {
    const rows = [
      buildDnpRepairPreview(dnpRow(), { didNotPlay: true, reason: 'no_plate_appearances', value: null }),
      buildDnpRepairPreview(dnpRow({ id: 'pv-cam', playerName: 'Cam Smith' }), {
        didNotPlay: false, reason: 'appeared', value: 0,
      }),
    ]
    expect(summarizeDnpPreviews(rows)).toMatchObject({
      total: 2,
      ready: 1,
      skipped: 1,
      appeared: 1,
      noPa: 1,
      wasLoss: 1,
    })
  })
})

describe('runRepairDnpGrades', () => {
  function memoryLog() {
    const lines = []
    return {
      lines,
      log: (...args) => lines.push(args.join(' ')),
      error: (...args) => lines.push(args.join(' ')),
    }
  }

  function mockClient(rows, updates, { games = [], published = [] } = {}) {
    return {
      from(table) {
        const query = {
          select() { return query },
          eq() { return query },
          gt() { return query },
          gte() { return query },
          not() { return query },
          in() {
            if (table === 'Game') {
              return Promise.resolve({
                data: games.length
                  ? games
                  : rows.map((row) => ({
                    id: row.gameIdRef,
                    sport: row.sport,
                    status: 'final',
                    mlbGameId: '824141',
                    espnGameId: '401802001',
                  })),
                error: null,
              })
            }
            return query
          },
          order() { return query },
          range() {
            if (table === 'PropValidation') {
              const data = query._published ? published : rows
              return Promise.resolve({ data, error: null })
            }
            return Promise.resolve({ data: [], error: null })
          },
          update(payload) {
            updates.push(payload)
            return { eq: async () => ({ error: null }) }
          },
        }
        const origSelect = query.select
        query.select = (cols) => {
          if (String(cols).includes('qualityScore')) query._published = true
          return origSelect()
        }
        return query
      },
    }
  }

  test('dry-run prints the row and never writes', async () => {
    const updates = []
    const log = memoryLog()
    const result = await runRepairDnpGrades({
      argv: [],
      log,
      fetchDelayMs: 0,
      createClient: () => mockClient([dnpRow()], updates, { published: [dnpRow()] }),
      lookupMlb: () => ({
        didNotPlay: true,
        reason: 'no_plate_appearances',
        value: null,
      }),
      fetchMlbBoxscore: async () => ({ 'Vinnie Pasquantino': { batting: null, pitching: null } }),
    })

    expect(result.summary.ready).toBe(1)
    expect(result.applied).toBe(0)
    expect(updates).toHaveLength(0)
    expect(log.lines.join('\n')).toMatch(/DRY-RUN/)
    expect(log.lines.join('\n')).toMatch(/pv-vinnie/)
    expect(log.lines.join('\n')).toMatch(/incorrect -> void/)
  })

  test('--apply writes a backup then voids; second preview of the same row is skipped', async () => {
    const updates = []
    const files = {}
    const result = await runRepairDnpGrades({
      argv: ['--apply'],
      log: memoryLog(),
      fetchDelayMs: 0,
      now: new Date('2026-10-10T12:00:00Z'),
      createClient: () => mockClient([dnpRow()], updates),
      lookupMlb: () => ({ didNotPlay: true, reason: 'no_plate_appearances', value: null }),
      fetchMlbBoxscore: async () => ({ 'Vinnie Pasquantino': {} }),
      mkdir: () => {},
      writeFile: (path, body) => { files[path] = body },
    })

    expect(result.applied).toBe(1)
    expect(updates).toHaveLength(1)
    expect(updates[0].result).toBe('void')
    expect(updates[0].status).toBe('manual_closed')
    expect(updates[0].gradeSource).toBe('repair-dnp-grades')
    expect(Object.keys(files)).toHaveLength(1)
    expect(JSON.parse(Object.values(files)[0])[0].id).toBe('pv-vinnie')
  })

  test('NFL --sport is a no-op with an explanation', async () => {
    const result = await runRepairDnpGrades({
      argv: ['--sport', 'nfl'],
      log: memoryLog(),
      createClient: () => { throw new Error('should not connect') },
    })
    expect(result.nflSkipped).toBe(true)
    expect(result.summary.ready).toBe(0)
  })
})
