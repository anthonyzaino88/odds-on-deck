import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  formatSeasonYear,
  isMissingNflSeason,
  nflSeasonBackupFileName,
  nflSeasonYearFromDate,
  parseBackfillNflGameSeasonArgs,
  planNflSeasonBackfill,
  resolveNflGameSeason,
  runBackfillNflGameSeason,
} from '../../lib/nfl-season.js'

function createSupabase({ rows = [], updates = [] } = {}) {
  return {
    from(table) {
      expect(table).toBe('Game')
      const state = { filters: [], payload: null }
      const chain = {
        select() { return chain },
        eq(col, val) { state.filters.push(['eq', col, val]); return chain },
        or(expr) { state.filters.push(['or', expr]); return chain },
        order() { return chain },
        limit() {
          return Promise.resolve({ data: rows, error: null })
        },
        update(payload) {
          state.payload = payload
          return {
            eq(col, val) {
              state.filters.push(['upd', col, val])
              return {
                eq(col2, val2) {
                  state.filters.push(['upd', col2, val2])
                  return {
                    select() {
                      updates.push({ payload: state.payload, filters: [...state.filters] })
                      return Promise.resolve({ data: [{ id: val }], error: null })
                    },
                  }
                },
              }
            },
          }
        },
      }
      return chain
    },
  }
}

describe('NFL season year format', () => {
  test('matches Team.season four-digit strings and treats Jan-Feb as prior year', () => {
    expect(formatSeasonYear(2026)).toBe('2026')
    expect(formatSeasonYear('2026')).toBe('2026')
    expect(formatSeasonYear('2026-27')).toBe('2026')
    expect(isMissingNflSeason(null)).toBe(true)
    expect(isMissingNflSeason('')).toBe(true)
    expect(isMissingNflSeason('2026')).toBe(false)

    expect(nflSeasonYearFromDate('2026-10-29T17:00:00.000Z')).toBe('2026')
    expect(nflSeasonYearFromDate('2026-09-07T17:00:00.000Z')).toBe('2026')
    expect(nflSeasonYearFromDate('2027-01-01T03:00:00.000Z')).toBe('2026') // still 31 Dec ET
    expect(nflSeasonYearFromDate('2027-01-01T06:00:00.000Z')).toBe('2026') // 1 Jan ET
    expect(nflSeasonYearFromDate('2027-01-17T01:20:00.000Z')).toBe('2026')
    expect(nflSeasonYearFromDate('2027-02-14T23:30:00.000Z')).toBe('2026')
    expect(nflSeasonYearFromDate('2027-03-01T17:00:00.000Z')).toBe('2027')
    expect(resolveNflGameSeason({
      event: { season: { year: 2026, type: 2 } },
      date: '2027-02-14T23:30:00.000Z',
    })).toBe('2026')
    expect(resolveNflGameSeason({
      event: {},
      date: '2027-02-14T23:30:00.000Z',
    })).toBe('2026')
  })
})

describe('fetch-fresh-games NFL season ingest', () => {
  test('always writes Game.season for NFL and falls back from kickoff date', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/fetch-fresh-games.js'), 'utf8')
    expect(src).toMatch(/resolveNflGameSeason\(\{ event, date: gameDate \}\)/)
    expect(src).toMatch(/g\.sport === 'nfl'/)
    expect(src).toMatch(/obj\.season = g\.season \|\| nflSeasonYearFromDate\(g\.date\)/)
    expect(src).not.toMatch(/eligibleForPublic/)
  })
})

describe('null-season backfill planner', () => {
  test('proposes values only for NFL rows missing season', () => {
    const plan = planNflSeasonBackfill([
      { id: 'CAR_at_GB_2026-10-29', sport: 'nfl', date: '2026-10-29T17:00:00.000Z', season: null },
      { id: 'KC_at_PHI_2027-02-14', sport: 'nfl', date: '2027-02-14T23:30:00.000Z', season: '' },
      { id: 'BUF_at_KC_2026-11-02', sport: 'nfl', date: '2026-11-02T18:00:00.000Z', season: '2026' },
      { id: 'NYY_at_BOS_2026-10-01', sport: 'mlb', date: '2026-10-01T23:00:00.000Z', season: null },
    ])
    expect(plan.count).toBe(2)
    expect(plan.planned.map((row) => row.season)).toEqual(['2026', '2026'])
    expect(plan.bySeason).toEqual({ 2026: 2 })
    expect(plan.skipped.some((row) => row.reason === 'season_present')).toBe(true)
    expect(plan.skipped.some((row) => row.reason === 'not_nfl')).toBe(true)
  })
})

describe('runBackfillNflGameSeason', () => {
  test('dry-run prints counts and does not write', async () => {
    const logs = []
    const writes = []
    const supabase = createSupabase({
      rows: [
        { id: 'CAR_at_GB_2026-10-29', sport: 'nfl', date: '2026-10-29T17:00:00.000Z', season: null },
      ],
    })
    const result = await runBackfillNflGameSeason({
      argv: [],
      supabase,
      log: { log: (...args) => logs.push(args.join(' ')), warn() {}, error() {} },
      writeFile: (...args) => writes.push(args),
      mkdir() {},
    })
    expect(result.dryRun).toBe(true)
    expect(result.applied).toBe(0)
    expect(result.count).toBe(1)
    expect(writes).toEqual([])
    expect(logs.join('\n')).toMatch(/DRY-RUN/)
    expect(logs.join('\n')).toMatch(/missing season: 1/)
    expect(logs.join('\n')).toMatch(/CAR_at_GB_2026-10-29/)
    expect(parseBackfillNflGameSeasonArgs(['--apply']).apply).toBe(true)
  })

  test('--apply writes a .local/backups JSON file then updates, and refuses the quiet window', async () => {
    const dir = join(tmpdir(), `nfl-season-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const updates = []
    const rows = [
      { id: 'CAR_at_GB_2026-10-29', sport: 'nfl', date: '2026-10-29T17:00:00.000Z', season: null },
    ]
    const quiet = await runBackfillNflGameSeason({
      argv: ['--apply'],
      supabase: createSupabase({ rows, updates }),
      now: new Date('2026-11-08T17:09:00.000Z'),
      log: { log() {}, warn() {}, error() {} },
      writeFile() { throw new Error('must not backup during quiet window') },
      mkdir() {},
      cwd: dir,
    })
    expect(quiet.refused).toBe(true)
    expect(quiet.reason).toBe('ops_quiet_period')
    expect(quiet.applied).toBe(0)
    expect(updates).toEqual([])

    const writes = []
    const applied = await runBackfillNflGameSeason({
      argv: ['--apply'],
      supabase: createSupabase({ rows, updates }),
      now: new Date('2026-11-08T16:30:00.000Z'),
      log: { log() {}, warn() {}, error() {} },
      writeFile: (path, body) => writes.push({ path, body }),
      mkdir() {},
      cwd: dir,
    })
    expect(applied.applied).toBe(1)
    expect(applied.backupPath).toMatch(/\.local\/backups\/nfl-game-season-/)
    expect(nflSeasonBackupFileName(new Date('2026-11-08T16:30:00.000Z'))).toMatch(/nfl-game-season-/)
    expect(JSON.parse(writes[0].body).rows[0].id).toBe('CAR_at_GB_2026-10-29')
    expect(updates[0].payload).toEqual({ season: '2026' })
    rmSync(dir, { recursive: true, force: true })
  })

  test('operations script is dry-run by default and does not call The Odds API', () => {
    const src = readFileSync(join(process.cwd(), 'operations/backfill-nfl-game-season.mjs'), 'utf8')
    expect(src).toMatch(/Dry-run by default/)
    expect(src).toMatch(/\.local\/backups/)
    expect(src).toMatch(/:05–:15 ET/)
    expect(src).toMatch(/Does not change eligibility gates/)
    expect(src).not.toMatch(/the-odds-api|ODDS_API_KEY/)
    const model = readFileSync(join(process.cwd(), 'lib/nfl-selection-model.js'), 'utf8')
    expect(model).not.toMatch(/from '\.\/nfl-season\.js'/)
    expect(model).toMatch(/reason: 'missing_season'/)
    expect(model).toMatch(/function parseSeasonYear/)
    expect(model).toMatch(/function dataThroughMatchesSeason/)
  })
})
