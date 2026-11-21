/**
 * One-time merge of a duplicate Team row onto a canonical Team id.
 *
 * Dry-run by default. --apply remaps every Prisma Team FK in one
 * transaction, then deletes the from-team only when nothing still
 * points at it. Refuses DB writes during :05–:15 ET.
 *
 * Never prints secrets.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isOpsWriteQuietPeriod } from './mlb-recording-window.js'

export const MERGE_DUPLICATE_NFL_TEAM_BACKUP_DIR = '.local/backups'

export const MERGE_DUPLICATE_NFL_TEAM_USAGE = `Usage:
  node scripts/merge-duplicate-nfl-team.js --from <teamId> --to <teamId>
  node scripts/merge-duplicate-nfl-team.js --from <teamId> --to <teamId> --backup
  node scripts/merge-duplicate-nfl-team.js --from <teamId> --to <teamId> --backup --apply

Dry-run (default): count every Prisma FK that points at --from and flag
unique-constraint conflicts on --to. No DB writes.
--backup: write a JSON backup of the from-team row and all affected rows
          to .local/backups (gitignored).
--apply:  remap FKs onto --to in one transaction, then delete --from
          only if nothing still references it. Requires --backup in the
          same run. Refused during the :05–:15 ET quiet window.

Never prints secrets. Does not call The Odds API.
`

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const MODEL_RE = /model\s+(\w+)\s+\{([\s\S]*?)\n\}/g
const RELATION_RE = /(\w+)\s+Team\??\s+@relation\(([^)]*)\)/g
const UNIQUE_RE = /@@unique\(\[([^\]]+)\]\)/g

export function parseMergeDuplicateNflTeamArgs(argv = []) {
  const out = {
    fromId: null,
    toId: null,
    apply: false,
    backup: false,
    help: false,
    unknown: [],
    missingValue: [],
  }
  const args = Array.isArray(argv) ? argv : []
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i])
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--apply') out.apply = true
    else if (arg === '--dry-run') out.apply = false
    else if (arg === '--backup') out.backup = true
    else if (arg === '--from') {
      const value = args[++i]
      if (value == null || String(value).startsWith('--')) {
        out.missingValue.push('--from')
        if (value != null && String(value).startsWith('--')) i -= 1
      } else out.fromId = String(value)
    } else if (arg === '--to') {
      const value = args[++i]
      if (value == null || String(value).startsWith('--')) {
        out.missingValue.push('--to')
        if (value != null && String(value).startsWith('--')) i -= 1
      } else out.toId = String(value)
    } else if (arg.startsWith('--from=')) out.fromId = arg.slice('--from='.length)
    else if (arg.startsWith('--to=')) out.toId = arg.slice('--to='.length)
    else out.unknown.push(arg)
  }
  return out
}

export function formatMergeModeBanner({ apply, backup } = {}) {
  if (apply) return 'MODE: APPLY'
  if (backup) return 'MODE: DRY-RUN + BACKUP'
  return 'MODE: DRY-RUN'
}

export function mergeDuplicateNflTeamBackupFileName(now = new Date()) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  return `merge-duplicate-nfl-team-${stamp}.json`
}

function parseUniqueLists(body) {
  return [...String(body || '').matchAll(UNIQUE_RE)]
    .map((match) => match[1].split(',').map((part) => part.trim()).filter(Boolean))
}

/**
 * Team FK columns from prisma/schema.prisma. Inverse Team[] relations
 * are ignored; only fields: [col] references: [id] onto Team count.
 */
export function parseTeamFkRefsFromSchema(schemaText) {
  const refs = []
  const source = String(schemaText || '')
  for (const match of source.matchAll(MODEL_RE)) {
    const table = match[1]
    const body = match[2]
    if (table === 'Team') continue
    const uniques = parseUniqueLists(body)
    RELATION_RE.lastIndex = 0
    let rel = RELATION_RE.exec(body)
    while (rel) {
      const args = rel[2] || ''
      const fields = args.match(/fields:\s*\[(\w+)\]/)
      const references = args.match(/references:\s*\[(\w+)\]/)
      if (fields && (!references || references[1] === 'id')) {
        const column = fields[1]
        const unique = uniques.find((cols) => cols.includes(column)) || null
        refs.push({
          table,
          column,
          key: `${table}.${column}`,
          unique,
        })
      }
      rel = RELATION_RE.exec(body)
    }
  }
  return refs
}

export function loadTeamFkRefsFromSchema(schemaPath) {
  return parseTeamFkRefsFromSchema(readFileSync(schemaPath, 'utf8'))
}

export function assertSafeSqlIdent(name) {
  const raw = String(name || '')
  if (!IDENT_RE.test(raw)) throw new Error(`Unsafe SQL identifier: ${raw}`)
  return raw
}

function rowKey(row, columns, { fromId, toId, remapColumns } = {}) {
  return (columns || []).map((column) => {
    let value = row?.[column]
    if (remapColumns?.includes(column) && value === fromId) value = toId
    return value == null ? '' : String(value)
  }).join('\0')
}

function uniqueRemapColumns(refs) {
  const byTable = new Map()
  for (const spec of refs || []) {
    if (!spec?.unique?.length) continue
    const cols = byTable.get(spec.table) || new Set()
    cols.add(spec.column)
    byTable.set(spec.table, cols)
  }
  return byTable
}

/**
 * Flag rows that would violate a @@unique after teamId/homeId/etc remap.
 */
export function findUniqueConflicts({
  refs = [],
  fromRowsByKey = {},
  targetRowsByTable = {},
  fromId,
  toId,
} = {}) {
  const conflicts = []
  const remapByTable = uniqueRemapColumns(refs)
  const seenTables = new Set()

  for (const spec of refs) {
    if (!spec?.unique?.length) continue
    if (seenTables.has(spec.table)) continue
    seenTables.add(spec.table)

    const remapColumns = [...(remapByTable.get(spec.table) || [])]
    const fromRows = []
    for (const other of refs.filter((row) => row.table === spec.table)) {
      fromRows.push(...(fromRowsByKey[other.key] || []))
    }
    const fromById = new Map()
    for (const row of fromRows) {
      if (row?.id != null) fromById.set(row.id, row)
    }
    const uniqueFromRows = [...fromById.values()]
    const targetRows = targetRowsByTable[spec.table] || []

    const targetKeys = new Map()
    for (const row of targetRows) {
      targetKeys.set(rowKey(row, spec.unique, { fromId, toId, remapColumns }), row)
    }

    const seenFrom = new Map()
    for (const row of uniqueFromRows) {
      const key = rowKey(row, spec.unique, { fromId, toId, remapColumns })
      const hitTarget = targetKeys.get(key)
      if (hitTarget && hitTarget.id !== row.id) {
        conflicts.push({
          table: spec.table,
          unique: spec.unique,
          fromRowId: row.id,
          targetRowId: hitTarget.id,
          key: spec.unique.map((column) => {
            const value = remapColumns.includes(column) && row[column] === fromId
              ? toId
              : row[column]
            return `${column}=${value}`
          }).join(','),
        })
      }
      const hitFrom = seenFrom.get(key)
      if (hitFrom && hitFrom.id !== row.id) {
        conflicts.push({
          table: spec.table,
          unique: spec.unique,
          fromRowId: row.id,
          targetRowId: hitFrom.id,
          key: spec.unique.map((column) => {
            const value = remapColumns.includes(column) && row[column] === fromId
              ? toId
              : row[column]
            return `${column}=${value}`
          }).join(','),
        })
      }
      seenFrom.set(key, row)
    }
  }
  return conflicts
}

export function planTeamMerge({
  fromTeam,
  toTeam,
  refs = [],
  fromRowsByKey = {},
  targetRowsByTable = {},
} = {}) {
  const fromId = fromTeam?.id
  const toId = toTeam?.id
  const counts = {}
  let total = 0
  for (const spec of refs) {
    const rows = fromRowsByKey[spec.key] || []
    counts[spec.key] = rows.length
    total += rows.length
  }
  const conflicts = (fromId && toId)
    ? findUniqueConflicts({ refs, fromRowsByKey, targetRowsByTable, fromId, toId })
    : []
  const sameId = Boolean(fromId && toId && fromId === toId)
  const missingFrom = !fromTeam
  const missingTo = !toTeam
  const sportMismatch = Boolean(
    fromTeam?.sport && toTeam?.sport
    && String(fromTeam.sport).toLowerCase() !== String(toTeam.sport).toLowerCase(),
  )
  return {
    fromId: fromId || null,
    toId: toId || null,
    fromTeam: fromTeam || null,
    toTeam: toTeam || null,
    counts,
    total,
    conflicts,
    sameId,
    missingFrom,
    missingTo,
    sportMismatch,
    canApply: Boolean(
      fromTeam && toTeam && fromId !== toId && !sportMismatch && conflicts.length === 0,
    ),
  }
}

async function selectEq(supabase, table, column, value) {
  const rows = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const query = supabase
      .from(table)
      .select('*')
      .eq(column, value)
    const page = typeof query.range === 'function'
      ? await query.range(from, from + pageSize - 1)
      : await query
    if (page?.error) throw new Error(`${table}.${column} lookup failed: ${page.error.message}`)
    const batch = page?.data || []
    rows.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return rows
}

export async function loadTeamFkRows(supabase, refs, teamId) {
  const fromRowsByKey = {}
  for (const spec of refs) {
    fromRowsByKey[spec.key] = await selectEq(supabase, spec.table, spec.column, teamId)
  }
  return fromRowsByKey
}

export async function loadUniqueTargetRows(supabase, refs, toId) {
  const targetRowsByTable = {}
  const seen = new Set()
  for (const spec of refs) {
    if (!spec?.unique?.length || seen.has(spec.table)) continue
    seen.add(spec.table)
    const columns = refs.filter((row) => row.table === spec.table && row.unique).map((row) => row.column)
    const unique = [...new Set(columns)]
    const byId = new Map()
    for (const column of unique) {
      for (const row of await selectEq(supabase, spec.table, column, toId)) {
        if (row?.id != null) byId.set(row.id, row)
      }
    }
    targetRowsByTable[spec.table] = [...byId.values()]
  }
  return targetRowsByTable
}

export function summarizeMergePlan(plan) {
  const lines = []
  const fromLabel = plan.fromTeam
    ? `${plan.fromTeam.id} ${plan.fromTeam.abbr || ''} ${plan.fromTeam.name || ''}`.trim()
    : String(plan.fromId || '(missing)')
  const toLabel = plan.toTeam
    ? `${plan.toTeam.id} ${plan.toTeam.abbr || ''} ${plan.toTeam.name || ''}`.trim()
    : String(plan.toId || '(missing)')
  lines.push(`from: ${fromLabel}`)
  lines.push(`to:   ${toLabel}`)
  if (plan.missingFrom) lines.push('ERROR: --from team not found')
  if (plan.missingTo) lines.push('ERROR: --to team not found')
  if (plan.sameId) lines.push('ERROR: --from and --to are the same id')
  if (plan.sportMismatch) lines.push('ERROR: --from and --to are different sports')
  lines.push(`FK references to from-team: ${plan.total}`)
  for (const [key, count] of Object.entries(plan.counts || {})) {
    lines.push(`  ${key}: ${count}`)
  }
  if (plan.conflicts.length) {
    lines.push(`Unique-constraint conflicts on target: ${plan.conflicts.length}`)
    for (const conflict of plan.conflicts) {
      lines.push(`  ${conflict.table} ${conflict.key} from=${conflict.fromRowId} target=${conflict.targetRowId}`)
    }
  } else {
    lines.push('Unique-constraint conflicts on target: 0')
  }
  return lines
}

export function buildMergeBackupPayload({ plan, fromRowsByKey, writtenAt }) {
  return {
    writtenAt: writtenAt instanceof Date ? writtenAt.toISOString() : String(writtenAt),
    fromTeam: plan.fromTeam,
    toTeam: plan.toTeam ? { id: plan.toTeam.id, abbr: plan.toTeam.abbr, name: plan.toTeam.name, sport: plan.toTeam.sport } : null,
    counts: plan.counts,
    conflicts: plan.conflicts,
    rows: fromRowsByKey,
  }
}

export async function applyTeamMerge(plan, {
  refs,
  runTransaction,
} = {}) {
  if (!plan?.canApply) {
    const reason = plan?.conflicts?.length
      ? 'unique_conflicts'
      : plan?.missingFrom || plan?.missingTo
        ? 'missing_team'
        : plan?.sameId
          ? 'same_id'
          : plan?.sportMismatch
            ? 'sport_mismatch'
            : 'cannot_apply'
    const error = new Error(`Refuse --apply (${reason})`)
    error.reason = reason
    throw error
  }
  if (typeof runTransaction !== 'function') {
    throw new Error('runTransaction is required for --apply')
  }
  const fromId = plan.fromId
  const toId = plan.toId
  return runTransaction(async (tx) => {
    for (const spec of refs) {
      await tx.updateMany(spec.table, spec.column, fromId, toId)
    }
    const leftover = await tx.countRefs(fromId)
    if (leftover > 0) {
      const error = new Error(`Abort: ${leftover} remaining FK reference(s) to ${fromId}`)
      error.reason = 'still_referenced'
      error.leftover = leftover
      throw error
    }
    await tx.deleteTeam(fromId)
    return { deleted: true, leftover: 0 }
  })
}

export function createPrismaMergeTransactionApi(tx) {
  return {
    async updateMany(table, column, fromId, toId) {
      const t = assertSafeSqlIdent(table)
      const c = assertSafeSqlIdent(column)
      return tx.$executeRawUnsafe(
        `UPDATE "${t}" SET "${c}" = $1 WHERE "${c}" = $2`,
        toId,
        fromId,
      )
    },
    async countRefs(fromId, refs) {
      let total = 0
      for (const spec of refs) {
        const t = assertSafeSqlIdent(spec.table)
        const c = assertSafeSqlIdent(spec.column)
        const rows = await tx.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS count FROM "${t}" WHERE "${c}" = $1`,
          fromId,
        )
        total += Number(rows?.[0]?.count || 0)
      }
      return total
    },
    async deleteTeam(fromId) {
      return tx.$executeRawUnsafe('DELETE FROM "Team" WHERE id = $1', fromId)
    },
  }
}

/**
 * Prisma $transaction wrapper. countRefs needs the FK list closed over
 * from the caller.
 */
export function bindPrismaMergeTransaction(prisma, refs) {
  return async (work) => prisma.$transaction(async (tx) => {
    const api = createPrismaMergeTransactionApi(tx)
    const wrapped = {
      updateMany: api.updateMany,
      deleteTeam: api.deleteTeam,
      countRefs: (fromId) => api.countRefs(fromId, refs),
    }
    return work(wrapped)
  })
}

async function loadTeamById(supabase, id) {
  const query = supabase.from('Team').select('*').eq('id', id)
  const result = typeof query.maybeSingle === 'function'
    ? await query.maybeSingle()
    : await query
  if (result?.error) throw new Error(`Team lookup failed: ${result.error.message}`)
  const data = result?.data
  if (Array.isArray(data)) return data[0] || null
  return data || null
}

export async function runMergeDuplicateNflTeam({
  argv = [],
  supabase,
  now = new Date(),
  nowFn,
  log = console,
  writeFile,
  mkdir,
  backupDir = MERGE_DUPLICATE_NFL_TEAM_BACKUP_DIR,
  cwd = process.cwd(),
  schemaPath = join(cwd, 'prisma/schema.prisma'),
  refs,
  runTransaction,
  createTransaction,
} = {}) {
  const clock = typeof nowFn === 'function' ? nowFn : () => now
  const args = parseMergeDuplicateNflTeamArgs(argv)
  if (args.help) {
    log.log?.(MERGE_DUPLICATE_NFL_TEAM_USAGE)
    return { exitCode: 0, help: true, applied: false }
  }
  if (args.unknown.length) {
    log.error?.(`Unknown argument(s): ${args.unknown.join(' ')}`)
    log.error?.(MERGE_DUPLICATE_NFL_TEAM_USAGE)
    return { exitCode: 2, error: 'unknown_args', applied: false }
  }
  if (args.missingValue.length) {
    log.error?.(`Missing value for ${args.missingValue.join(', ')}`)
    log.error?.(MERGE_DUPLICATE_NFL_TEAM_USAGE)
    return { exitCode: 2, error: 'missing_value', applied: false }
  }
  if (!args.fromId || !args.toId) {
    log.error?.('--from <teamId> and --to <teamId> are required')
    log.error?.(MERGE_DUPLICATE_NFL_TEAM_USAGE)
    return { exitCode: 2, error: 'missing_ids', applied: false }
  }
  if (!supabase) throw new Error('supabase client is required')

  log.log?.(formatMergeModeBanner(args))

  const fkRefs = refs || loadTeamFkRefsFromSchema(schemaPath)
  const fromTeam = await loadTeamById(supabase, args.fromId)
  const toTeam = await loadTeamById(supabase, args.toId)
  const fromRowsByKey = fromTeam
    ? await loadTeamFkRows(supabase, fkRefs, fromTeam.id)
    : Object.fromEntries(fkRefs.map((spec) => [spec.key, []]))
  const targetRowsByTable = (fromTeam && toTeam)
    ? await loadUniqueTargetRows(supabase, fkRefs, toTeam.id)
    : {}
  const plan = planTeamMerge({
    fromTeam,
    toTeam,
    refs: fkRefs,
    fromRowsByKey,
    targetRowsByTable,
  })

  for (const line of summarizeMergePlan(plan)) log.log?.(line)

  if (!args.apply && !args.backup) {
    log.log?.('Dry-run: no writes. Pass --backup to snapshot, --backup --apply to remap.')
    return { exitCode: 0, dryRun: true, applied: false, plan }
  }

  if (args.apply && !args.backup) {
    log.error?.('Refuse --apply: --backup is required in the same run')
    return { exitCode: 1, error: 'backup_required', applied: false, plan }
  }

  if (args.apply && isOpsWriteQuietPeriod(clock())) {
    log.warn?.('Refuse --apply during ops quiet window (:05–:15 ET)')
    return {
      exitCode: 1,
      refused: true,
      reason: 'ops_quiet_period',
      applied: false,
      plan,
    }
  }

  let backupPath = null
  if (args.backup) {
    if (typeof writeFile !== 'function' || typeof mkdir !== 'function') {
      throw new Error('writeFile and mkdir are required for --backup')
    }
    const fileName = mergeDuplicateNflTeamBackupFileName(clock())
    backupPath = join(cwd, backupDir, fileName)
    mkdir(join(cwd, backupDir), { recursive: true })
    writeFile(backupPath, JSON.stringify(buildMergeBackupPayload({
      plan,
      fromRowsByKey,
      writtenAt: clock(),
    }), null, 2))
    log.log?.(`Backup: ${backupPath}`)
  }

  if (!args.apply) {
    log.log?.('Backup written. Dry-run: no DB writes. Pass --backup --apply to remap.')
    return { exitCode: 0, dryRun: true, applied: false, backupPath, plan, backupTaken: true }
  }

  if (!plan.canApply) {
    const reason = plan.conflicts.length
      ? 'unique_conflicts'
      : plan.missingFrom || plan.missingTo
        ? 'missing_team'
        : plan.sameId
          ? 'same_id'
          : plan.sportMismatch
            ? 'sport_mismatch'
            : 'cannot_apply'
    log.error?.(`Refuse --apply (${reason})`)
    return { exitCode: 1, error: reason, applied: false, backupPath, plan, backupTaken: true }
  }

  const transaction = runTransaction
    || (typeof createTransaction === 'function' ? await createTransaction(fkRefs) : null)
  if (typeof transaction !== 'function') {
    log.error?.('Refuse --apply: transaction runner is required')
    return { exitCode: 1, error: 'missing_transaction', applied: false, backupPath, plan, backupTaken: true }
  }

  try {
    const applied = await applyTeamMerge(plan, { refs: fkRefs, runTransaction: transaction })
    log.log?.(`Remapped ${plan.total} FK reference(s) onto ${plan.toId}`)
    log.log?.(`Deleted from-team ${plan.fromId}`)
    return {
      exitCode: 0,
      applied: true,
      deleted: applied.deleted,
      backupPath,
      plan,
      backupTaken: true,
    }
  } catch (error) {
    log.error?.(`Apply aborted: ${error.message}`)
    return {
      exitCode: 1,
      applied: false,
      error: error.reason || 'apply_failed',
      backupPath,
      plan,
      backupTaken: true,
    }
  }
}
