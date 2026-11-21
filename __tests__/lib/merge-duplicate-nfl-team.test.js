import { readFileSync } from 'fs'
import { join } from 'path'
import {
  MERGE_DUPLICATE_NFL_TEAM_USAGE,
  applyTeamMerge,
  findUniqueConflicts,
  formatMergeModeBanner,
  loadTeamFkRefsFromSchema,
  parseMergeDuplicateNflTeamArgs,
  parseTeamFkRefsFromSchema,
  planTeamMerge,
  runMergeDuplicateNflTeam,
  summarizeMergePlan,
} from '../../lib/merge-duplicate-nfl-team.js'

const FROM_ID = '4BBSVXpZwZ4sWqGP'
const TO_ID = 'NFL_28'
const SCHEMA = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const REFS = parseTeamFkRefsFromSchema(SCHEMA)

const fromTeam = {
  id: FROM_ID,
  name: 'Washington Commanders',
  abbr: 'WAS',
  sport: 'nfl',
  last10Record: null,
}
const toTeam = {
  id: TO_ID,
  name: 'Washington Commanders',
  abbr: 'WSH',
  sport: 'nfl',
  last10Record: '7-4',
}

function memoryLog() {
  const lines = []
  return {
    lines,
    log: (...args) => lines.push(args.join(' ')),
    error: (...args) => lines.push(args.join(' ')),
    warn: (...args) => lines.push(args.join(' ')),
  }
}

function mockSupabase({
  teams = { [FROM_ID]: fromTeam, [TO_ID]: toTeam },
  rows = {},
} = {}) {
  return {
    from(table) {
      const state = { table, filters: [] }
      const resultFor = () => {
        if (table === 'Team') {
          const idFilter = state.filters.find((row) => row[0] === 'eq' && row[1] === 'id')
          const id = idFilter?.[2]
          const team = id ? teams[id] || null : null
          return { data: team ? [team] : [], error: null }
        }
        const colFilter = state.filters.find((row) => row[0] === 'eq')
        const column = colFilter?.[1]
        const value = colFilter?.[2]
        const list = (rows[`${table}.${column}`] || []).filter((row) => row[column] === value)
        return { data: list, error: null }
      }
      const query = {
        select() { return query },
        eq(column, value) {
          state.filters.push(['eq', column, value])
          return query
        },
        range() { return Promise.resolve(resultFor()) },
        then(resolve, reject) {
          return Promise.resolve(resultFor()).then(resolve, reject)
        },
      }
      return query
    },
  }
}

describe('parseMergeDuplicateNflTeamArgs', () => {
  test('dry-run is default; --from/--to required; --apply needs an explicit flag', () => {
    expect(parseMergeDuplicateNflTeamArgs([])).toMatchObject({
      apply: false,
      backup: false,
      fromId: null,
      toId: null,
    })
    expect(parseMergeDuplicateNflTeamArgs(['--from', FROM_ID, '--to', TO_ID])).toMatchObject({
      apply: false,
      backup: false,
      fromId: FROM_ID,
      toId: TO_ID,
    })
    expect(parseMergeDuplicateNflTeamArgs(['--from', FROM_ID, '--to', TO_ID, '--backup', '--apply'])).toMatchObject({
      apply: true,
      backup: true,
    })
    expect(formatMergeModeBanner({ apply: false })).toBe('MODE: DRY-RUN')
    expect(MERGE_DUPLICATE_NFL_TEAM_USAGE).toMatch(/Dry-run/)
  })
})

describe('parseTeamFkRefsFromSchema', () => {
  test('finds every Prisma Team FK including Game home/away and NFL roster/matchup', () => {
    const keys = REFS.map((row) => row.key).sort()
    expect(keys).toEqual([
      'Game.awayId',
      'Game.homeId',
      'NFLMatchupHistory.defenseTeamId',
      'NFLMatchupHistory.offenseTeamId',
      'NFLRosterEntry.teamId',
      'Player.teamId',
    ])
    expect(REFS.find((row) => row.key === 'NFLRosterEntry.teamId').unique).toEqual([
      'playerId', 'teamId', 'season', 'specificPosition',
    ])
    expect(REFS.find((row) => row.key === 'NFLMatchupHistory.offenseTeamId').unique).toEqual([
      'offenseTeamId', 'defenseTeamId', 'gameId',
    ])
    expect(loadTeamFkRefsFromSchema(join(process.cwd(), 'prisma/schema.prisma'))).toHaveLength(6)
  })
})

describe('planTeamMerge', () => {
  test('counts every FK and flags unique conflicts on the target', () => {
    const players = Array.from({ length: 52 }, (_, i) => ({
      id: `p${i}`,
      teamId: FROM_ID,
      fullName: `Player ${i}`,
    }))
    const roster = players.map((player, i) => ({
      id: `r${i}`,
      playerId: player.id,
      teamId: FROM_ID,
      season: '2026',
      specificPosition: 'WR1',
    }))
    const plan = planTeamMerge({
      fromTeam,
      toTeam,
      refs: REFS,
      fromRowsByKey: {
        'Player.teamId': players,
        'NFLRosterEntry.teamId': roster,
        'Game.homeId': [],
        'Game.awayId': [],
        'NFLMatchupHistory.offenseTeamId': [],
        'NFLMatchupHistory.defenseTeamId': [],
      },
      targetRowsByTable: {
        NFLRosterEntry: [],
        NFLMatchupHistory: [],
      },
    })
    expect(plan.counts['Player.teamId']).toBe(52)
    expect(plan.counts['NFLRosterEntry.teamId']).toBe(52)
    expect(plan.counts['Game.homeId']).toBe(0)
    expect(plan.total).toBe(104)
    expect(plan.conflicts).toEqual([])
    expect(plan.canApply).toBe(true)
    expect(summarizeMergePlan(plan).join('\n')).toMatch(/Player\.teamId: 52/)

    const conflicts = findUniqueConflicts({
      refs: REFS,
      fromId: FROM_ID,
      toId: TO_ID,
      fromRowsByKey: {
        'NFLRosterEntry.teamId': [
          { id: 'r-from', playerId: 'p1', teamId: FROM_ID, season: '2026', specificPosition: 'WR1' },
        ],
      },
      targetRowsByTable: {
        NFLRosterEntry: [
          { id: 'r-to', playerId: 'p1', teamId: TO_ID, season: '2026', specificPosition: 'WR1' },
        ],
        NFLMatchupHistory: [],
      },
    })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].table).toBe('NFLRosterEntry')
    expect(planTeamMerge({
      fromTeam,
      toTeam,
      refs: REFS,
      fromRowsByKey: { 'NFLRosterEntry.teamId': conflicts[0] ? [{ id: 'r-from', playerId: 'p1', teamId: FROM_ID, season: '2026', specificPosition: 'WR1' }] : [] },
      targetRowsByTable: {
        NFLRosterEntry: [
          { id: 'r-to', playerId: 'p1', teamId: TO_ID, season: '2026', specificPosition: 'WR1' },
        ],
      },
    }).canApply).toBe(false)
  })
})

describe('applyTeamMerge', () => {
  test('remaps FKs then deletes only when leftover count is 0', async () => {
    const ops = []
    const plan = planTeamMerge({
      fromTeam,
      toTeam,
      refs: REFS,
      fromRowsByKey: {
        'Player.teamId': [{ id: 'p1', teamId: FROM_ID }],
      },
    })
    const applied = await applyTeamMerge(plan, {
      refs: REFS,
      runTransaction: async (work) => work({
        async updateMany(table, column, fromId, toId) {
          ops.push(['update', table, column, fromId, toId])
        },
        async countRefs() { return 0 },
        async deleteTeam(id) { ops.push(['delete', id]) },
      }),
    })
    expect(applied.deleted).toBe(true)
    expect(ops.filter((row) => row[0] === 'update')).toHaveLength(REFS.length)
    expect(ops.at(-1)).toEqual(['delete', FROM_ID])

    const leftoverOps = []
    await expect(applyTeamMerge(plan, {
      refs: REFS,
      runTransaction: async (work) => work({
        async updateMany(table, column, fromId, toId) {
          leftoverOps.push(['update', table, column, fromId, toId])
        },
        async countRefs() { return 2 },
        async deleteTeam(id) { leftoverOps.push(['delete', id]) },
      }),
    })).rejects.toMatchObject({ reason: 'still_referenced' })
    expect(leftoverOps.some((row) => row[0] === 'delete')).toBe(false)
  })
})

describe('runMergeDuplicateNflTeam', () => {
  const rows = {
    'Player.teamId': [
      { id: 'p1', teamId: FROM_ID, fullName: 'Jayden Daniels' },
    ],
    'NFLRosterEntry.teamId': [
      { id: 'r1', playerId: 'p1', teamId: FROM_ID, season: '2026', specificPosition: 'QB' },
    ],
    'Game.homeId': [],
    'Game.awayId': [],
    'NFLMatchupHistory.offenseTeamId': [],
    'NFLMatchupHistory.defenseTeamId': [],
  }

  test('dry-run prints FK counts and does not write', async () => {
    const log = memoryLog()
    const writes = []
    const result = await runMergeDuplicateNflTeam({
      argv: ['--from', FROM_ID, '--to', TO_ID],
      supabase: mockSupabase({ rows }),
      log,
      writeFile: (path, body) => writes.push({ path, body }),
      mkdir() {},
      cwd: '/tmp',
      refs: REFS,
    })
    expect(result.exitCode).toBe(0)
    expect(result.dryRun).toBe(true)
    expect(result.applied).toBe(false)
    expect(writes).toEqual([])
    expect(log.lines.join('\n')).toMatch(/MODE: DRY-RUN/)
    expect(log.lines.join('\n')).toMatch(/Player\.teamId: 1/)
    expect(log.lines.join('\n')).toMatch(/NFLRosterEntry\.teamId: 1/)
    expect(log.lines.join('\n')).not.toMatch(/SUPABASE_SECRET_KEY|DATABASE_URL|service_role/)
  })

  test('--apply without --backup is refused; quiet window refuses writes', async () => {
    const log = memoryLog()
    const noBackup = await runMergeDuplicateNflTeam({
      argv: ['--from', FROM_ID, '--to', TO_ID, '--apply'],
      supabase: mockSupabase({ rows }),
      log,
      now: new Date('2026-11-21T16:30:00.000Z'),
      writeFile() { throw new Error('must not backup') },
      mkdir() {},
      refs: REFS,
    })
    expect(noBackup.exitCode).toBe(1)
    expect(noBackup.error).toBe('backup_required')
    expect(noBackup.applied).toBe(false)

    const writes = []
    const tx = jest.fn()
    const quiet = await runMergeDuplicateNflTeam({
      argv: ['--from', FROM_ID, '--to', TO_ID, '--backup', '--apply'],
      supabase: mockSupabase({ rows }),
      log,
      now: new Date('2026-11-21T16:09:00.000Z'),
      writeFile: (path, body) => writes.push({ path, body }),
      mkdir() {},
      cwd: '/tmp',
      refs: REFS,
      runTransaction: tx,
    })
    expect(quiet.refused).toBe(true)
    expect(quiet.reason).toBe('ops_quiet_period')
    expect(quiet.applied).toBe(false)
    expect(writes).toEqual([])
    expect(tx).not.toHaveBeenCalled()
    expect(log.lines.join('\n')).toMatch(/quiet window/)
  })

  test('--backup --apply remaps in the injected transaction after a local backup', async () => {
    const log = memoryLog()
    const writes = []
    const ops = []
    const result = await runMergeDuplicateNflTeam({
      argv: ['--from', FROM_ID, '--to', TO_ID, '--backup', '--apply'],
      supabase: mockSupabase({ rows }),
      log,
      now: new Date('2026-11-21T16:30:00.000Z'),
      writeFile: (path, body) => writes.push({ path, body }),
      mkdir() {},
      cwd: '/tmp',
      refs: REFS,
      runTransaction: async (work) => work({
        async updateMany(table, column, fromId, toId) {
          ops.push(['update', table, column, fromId, toId])
        },
        async countRefs() { return 0 },
        async deleteTeam(id) { ops.push(['delete', id]) },
      }),
    })
    expect(result.exitCode).toBe(0)
    expect(result.applied).toBe(true)
    expect(result.backupPath).toMatch(/\.local\/backups\/merge-duplicate-nfl-team-/)
    expect(JSON.parse(writes[0].body).fromTeam.id).toBe(FROM_ID)
    expect(JSON.parse(writes[0].body).rows['Player.teamId']).toHaveLength(1)
    expect(ops.at(-1)).toEqual(['delete', FROM_ID])
    expect(log.lines.join('\n')).not.toMatch(/SUPABASE_SECRET_KEY|service_role/)
  })
})

describe('merge-duplicate-nfl-team script contract', () => {
  test('CLI is dry-run by default, uses the quiet-window helper, and does not call The Odds API', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/merge-duplicate-nfl-team.js'), 'utf8')
    expect(src).toMatch(/invokedDirectly/)
    expect(src).toMatch(/runMergeDuplicateNflTeam/)
    expect(src).not.toMatch(/the-odds-api|ODDS_API_KEY/)
    const lib = readFileSync(join(process.cwd(), 'lib/merge-duplicate-nfl-team.js'), 'utf8')
    expect(lib).toMatch(/isOpsWriteQuietPeriod/)
    expect(lib).toMatch(/:05–:15 ET/)
    expect(lib).toMatch(/\.local\/backups/)
  })
})
