import {
  buildRepairPreviewRow,
  gradeFromActual,
  isNhlSogValidation,
  matchFlippedParlayRefs,
  parseRepairArgs,
  REPAIR_GRADE_SOURCE,
  repairApplyPayload,
  shouldApplyRepairPreview,
  summarizeRepairRows,
} from '../../lib/repair-nhl-sog-grades.js'
import { runRepairNhlSogGrades } from '../../scripts/repair-nhl-sog-grades.js'

function sogRow(overrides = {}) {
  return {
    id: 'pv-luke',
    sport: 'nhl',
    propType: 'player_shots_on_goal',
    playerName: 'Luke Hughes',
    team: 'NJD',
    gameIdRef: 'NYR_at_NJ_2026-01-01',
    threshold: 2.5,
    prediction: 'over',
    actualValue: 0,
    result: 'incorrect',
    status: 'completed',
    ...overrides,
  }
}

describe('repair-nhl-sog-grades CLI flags', () => {
  test('defaults to dry-run; --apply is required to write', () => {
    expect(parseRepairArgs([])).toMatchObject({ apply: false, dryRun: true })
    expect(parseRepairArgs(['--dry-run'])).toMatchObject({ apply: false, dryRun: true })
    expect(parseRepairArgs(['--apply'])).toMatchObject({ apply: true, dryRun: false })
    expect(parseRepairArgs(['--apply', '--dry-run'])).toMatchObject({ apply: false, dryRun: true })
  })
})

describe('repair row selection', () => {
  test('only graded NHL SOG rows; never MLB/NFL', () => {
    expect(isNhlSogValidation(sogRow())).toBe(true)
    expect(isNhlSogValidation(sogRow({ propType: 'shots_on_goal' }))).toBe(true)
    expect(isNhlSogValidation(sogRow({ sport: 'mlb' }))).toBe(false)
    expect(isNhlSogValidation(sogRow({ sport: 'nfl' }))).toBe(false)
    expect(isNhlSogValidation(sogRow({ propType: 'goals' }))).toBe(false)
  })
})

describe('repair preview / apply payloads', () => {
  test('rebuilds result from the corrected actual and flags flips', () => {
    expect(gradeFromActual('over', 2.5, 3)).toBe('correct')
    const preview = buildRepairPreviewRow(sogRow(), {
      value: 3,
      source: 'espn-fallback',
      matchStatus: 'matched',
      statFound: true,
      gameFinal: true,
      team: 'NJD',
    })
    expect(preview).toMatchObject({
      player: 'Luke Hughes',
      oldActual: 0,
      newActual: 3,
      oldResult: 'incorrect',
      newResult: 'correct',
      flips: 'yes',
      skip: false,
    })
  })

  test('unmatched or ambiguous rows are skipped and not written', () => {
    const unmatched = buildRepairPreviewRow(sogRow(), {
      value: 0,
      source: 'espn-fallback',
      matchStatus: 'unmatched',
      statFound: false,
      gameFinal: true,
    })
    expect(unmatched.skip).toBe(true)
    expect(unmatched.skipReason).toBe('unmatched')
    expect(unmatched.newActual).toBeNull()

    const ambiguous = buildRepairPreviewRow(sogRow({ playerName: 'Elias Pettersson' }), {
      matchStatus: 'ambiguous',
      gameFinal: true,
      statFound: false,
      value: null,
    })
    expect(ambiguous.skipReason).toBe('ambiguous')
  })

  test('apply payload sets repair gradeSource and gradedAt', () => {
    const preview = buildRepairPreviewRow(sogRow(), {
      value: 3,
      source: 'espn-fallback',
      matchStatus: 'matched',
      statFound: true,
      gameFinal: true,
      team: 'NJD',
    })
    const payload = repairApplyPayload(sogRow(), preview, new Date('2026-10-04T18:00:00.000Z'))
    expect(payload.gradeSource).toBe(REPAIR_GRADE_SOURCE)
    expect(payload.gradeSource).toBe('repair-nhl-sog-2026-10')
    expect(payload.gradedAt).toBe('2026-10-04T18:00:00.000Z')
    expect(payload.gradedBy).toBe('system')
    expect(payload.actualValue).toBe(3)
    expect(payload.result).toBe('correct')
  })

  test('apply skips unchanged actual+result so reruns are idempotent', () => {
    const unchanged = buildRepairPreviewRow(sogRow({ actualValue: 3, result: 'correct' }), {
      value: 3,
      source: 'espn-fallback',
      matchStatus: 'matched',
      statFound: true,
      gameFinal: true,
    })
    expect(unchanged.flips).toBe('no')
    expect(shouldApplyRepairPreview(unchanged)).toBe(false)
    expect(shouldApplyRepairPreview(buildRepairPreviewRow(sogRow(), {
      value: 3,
      source: 'espn-fallback',
      matchStatus: 'matched',
      statFound: true,
      gameFinal: true,
    }))).toBe(true)
  })

  test('summary counts flips, unmatched, and skipped', () => {
    const rows = [
      buildRepairPreviewRow(sogRow(), {
        value: 3, source: 'espn-fallback', matchStatus: 'matched', statFound: true, gameFinal: true,
      }),
      buildRepairPreviewRow(sogRow({ id: 'pv-miss' }), {
        value: 0, source: 'espn-fallback', matchStatus: 'unmatched', statFound: false, gameFinal: true,
      }),
    ]
    expect(summarizeRepairRows(rows)).toMatchObject({
      total: 2,
      ready: 1,
      skipped: 1,
      flips: 1,
      unmatched: 1,
    })
  })
})

describe('runRepairNhlSogGrades', () => {
  function memoryLog() {
    const lines = []
    return {
      lines,
      log: (...args) => lines.push(args.join(' ')),
      error: (...args) => lines.push(args.join(' ')),
      table: (rows) => lines.push(JSON.stringify(rows)),
    }
  }

  function mockClient(rows, updates, { legs = [] } = {}) {
    return {
      from(table) {
        const query = {
          select() { return query },
          eq() { return query },
          in() {
            if (table === 'Game') {
              return Promise.resolve({
                data: rows.map((row) => ({ id: row.gameIdRef, espnGameId: '401802001', sport: 'nhl' })),
                error: null,
              })
            }
            return query
          },
          order() { return query },
          range() {
            if (table === 'PropValidation') return Promise.resolve({ data: rows, error: null })
            if (table === 'ParlayLeg') return Promise.resolve({ data: legs, error: null })
            return Promise.resolve({ data: [], error: null })
          },
          update(payload) {
            updates.push(payload)
            return { eq: async () => ({ error: null }) }
          },
        }
        return query
      },
    }
  }

  test('dry-run previews and never writes', async () => {
    const updates = []
    const log = memoryLog()
    const result = await runRepairNhlSogGrades({
      argv: [],
      log,
      fetchDelayMs: 0,
      lookupStat: async () => ({
        value: 3,
        source: 'espn-fallback',
        matchStatus: 'matched',
        statFound: true,
        gameFinal: true,
        team: 'NJD',
      }),
      createClient: () => mockClient([sogRow()], updates),
    })

    expect(result.summary.ready).toBe(1)
    expect(result.applied).toBe(0)
    expect(updates).toHaveLength(0)
    expect(log.lines.join('\n')).toMatch(/DRY-RUN/)
  })

  test('--apply writes matched rows and skips unmatched', async () => {
    const updates = []
    const rows = [
      sogRow(),
      sogRow({ id: 'pv-unknown', playerName: 'Unknown Player' }),
    ]
    const result = await runRepairNhlSogGrades({
      argv: ['--apply'],
      log: memoryLog(),
      fetchDelayMs: 0,
      now: new Date('2026-10-04T18:00:00.000Z'),
      lookupStat: async (_game, playerName) => {
        if (playerName === 'Luke Hughes') {
          return {
            value: 3,
            source: 'nhl-api',
            matchStatus: 'matched',
            statFound: true,
            gameFinal: true,
            team: 'NJD',
          }
        }
        return {
          value: 0,
          source: 'espn-fallback',
          matchStatus: 'unmatched',
          statFound: false,
          gameFinal: true,
        }
      },
      createClient: () => mockClient(rows, updates),
    })

    expect(result.applied).toBe(1)
    expect(result.summary.unmatched).toBe(1)
    expect(updates).toHaveLength(1)
    expect(updates[0].gradeSource).toBe('repair-nhl-sog-2026-10')
    expect(updates[0].gradedAt).toBe('2026-10-04T18:00:00.000Z')
    expect(updates[0].actualValue).toBe(3)
  })

  test('--apply does not rewrite unchanged gradeable rows', async () => {
    const updates = []
    const rows = [
      sogRow({ actualValue: 3, result: 'correct' }),
      sogRow({ id: 'pv-flip', actualValue: 0, result: 'incorrect' }),
    ]
    const result = await runRepairNhlSogGrades({
      argv: ['--apply'],
      log: memoryLog(),
      fetchDelayMs: 0,
      lookupStat: async () => ({
        value: 3,
        source: 'espn-fallback',
        matchStatus: 'matched',
        statFound: true,
        gameFinal: true,
        team: 'NJD',
      }),
      createClient: () => mockClient(rows, updates),
    })

    expect(result.applied).toBe(1)
    expect(result.summary.unchanged).toBe(1)
    expect(updates).toHaveLength(1)
    expect(updates[0].actualValue).toBe(3)
  })

  test('dry-run lists ParlayLeg and ParlayHistory ids for flipping rows only', async () => {
    const log = memoryLog()
    const result = await runRepairNhlSogGrades({
      argv: [],
      log,
      fetchDelayMs: 0,
      lookupStat: async () => ({
        value: 3,
        source: 'espn-fallback',
        matchStatus: 'matched',
        statFound: true,
        gameFinal: true,
        team: 'NJD',
      }),
      createClient: () => mockClient([sogRow()], [], {
        legs: [{
          id: 'leg-luke',
          parlayId: 'parlay-hist-1',
          playerName: 'Luke Hughes',
          propType: 'player_shots_on_goal',
          gameIdRef: 'NYR_at_NJ_2026-01-01',
        }],
      }),
    })

    expect(result.flippedParlayLegs).toEqual(['leg-luke'])
    expect(result.flippedParlayHistory).toEqual(['parlay-hist-1'])
    expect(log.lines.join('\n')).toMatch(/ParlayLeg ids:\s+leg-luke/)
    expect(log.lines.join('\n')).toMatch(/ParlayHistory ids:\s+parlay-hist-1/)
    expect(matchFlippedParlayRefs([sogRow()], [{
      id: 'leg-other',
      parlayId: 'parlay-2',
      playerName: 'Jack Hughes',
      propType: 'player_shots_on_goal',
      gameIdRef: 'NYR_at_NJ_2026-01-01',
    }])).toEqual({ parlayLegIds: [], parlayHistoryIds: [] })
  })
})
