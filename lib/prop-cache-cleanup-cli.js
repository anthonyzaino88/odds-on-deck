/**
 * CLI for scripts/clear-stale-props.js.
 *
 * Argument parsing and --help run with no DB or archive activity.
 * Unknown/invalid args fail before the Supabase client is created.
 */

import {
  CLEANUP_PAGE_SIZE,
  DEFAULT_CLEANUP_PAGE_SIZE,
  DEFAULT_CLEANUP_READ_ATTEMPTS,
  MAX_CLEANUP_PAGE_SIZE,
  clampCleanupPageSize,
  countCleanupRemaining,
  createSupabaseExactDeleter,
  createSupabaseKeysetFetcher,
  formatCleanupOpsFooter,
  refetchPlayerPropCacheByIds,
  runPropCacheCleanup,
  summarizeCleanupForOps,
} from './prop-cache-cleanup.js'
import { resolvePropLinesDir } from './local-archive.js'

export const CLEANUP_CLI_USAGE = `Usage:
  node scripts/clear-stale-props.js --help
  node scripts/clear-stale-props.js --dry-run [--page-size N] [--read-attempts N]
  node scripts/clear-stale-props.js --collect-only [--page-size N] [--read-attempts N]
  node scripts/clear-stale-props.js [--page-size N] [--read-attempts N]

Archives matching PlayerPropCache rows to local JSONL, then deletes only the
exact versions verified on disk. Candidate collection uses keyset pagination,
an explicit column list, and bounded retries. Read/archive failure aborts
with zero deletes.

Read-only:
  --dry-run, --collect-only  Collect candidates only. No archive writes, no
                             deletes. Read failures exit 1.

Live (default):
  Verify JSONL writes, then delete id + exact fetchedAt matches.

Options:
  --help, -h           Print usage and exit. No DB or archive activity.
  --page-size N        Candidate page size (default ${DEFAULT_CLEANUP_PAGE_SIZE}, max ${MAX_CLEANUP_PAGE_SIZE}).
  --read-attempts N    Bounded read attempts per page (default ${DEFAULT_CLEANUP_READ_ATTEMPTS}).

Exit codes:
  0  Success (including already-clean DB)
  1  Read/archive failure; PlayerPropCache was not deleted
  2  Invalid arguments or missing configuration
`

const KNOWN_FLAGS = new Set([
  '--help',
  '-h',
  '--dry-run',
  '--collect-only',
  '--page-size',
  '--read-attempts',
])

function takeValue(args, flag) {
  const i = args.indexOf(flag)
  if (i < 0) return { present: false, value: null, error: null }
  const raw = args[i + 1]
  if (raw == null || raw.startsWith('--')) {
    return { present: true, value: null, error: `${flag} requires an integer value` }
  }
  return { present: true, value: raw, error: null }
}

function parsePositiveInt(raw, flag, { min, max }) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `${flag} must be an integer between ${min} and ${max}` }
  }
  return { value: n }
}

export function parseCleanupCliArgs(argv = [], env = {}) {
  const args = [...argv]
  const valueFlags = new Set(['--page-size', '--read-attempts'])
  const unknown = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (valueFlags.has(arg)) {
      i += 1
      continue
    }
    const flag = arg.split('=')[0]
    if (!KNOWN_FLAGS.has(flag)) unknown.push(arg)
  }
  if (unknown.length) {
    return { error: `Unknown or invalid argument: ${unknown[0]}` }
  }
  for (const arg of args) {
    if (arg.includes('=') && arg.startsWith('--')) {
      return { error: `Use a space, not '=': ${arg.split('=')[0]} <value>` }
    }
  }

  const help = args.includes('--help') || args.includes('-h')
  const dryRun = args.includes('--dry-run') || args.includes('--collect-only')
  const collectOnly = args.includes('--collect-only')

  const pageSizeArg = takeValue(args, '--page-size')
  if (pageSizeArg.error) return { error: pageSizeArg.error }
  const attemptsArg = takeValue(args, '--read-attempts')
  if (attemptsArg.error) return { error: attemptsArg.error }

  let pageSize = clampCleanupPageSize(env.CLEANUP_PAGE_SIZE, DEFAULT_CLEANUP_PAGE_SIZE)
  if (pageSizeArg.present) {
    const parsed = parsePositiveInt(pageSizeArg.value, '--page-size', { min: 1, max: MAX_CLEANUP_PAGE_SIZE })
    if (parsed.error) return { error: parsed.error }
    pageSize = parsed.value
  }

  let readAttempts = Number(env.CLEANUP_READ_ATTEMPTS) || DEFAULT_CLEANUP_READ_ATTEMPTS
  if (!Number.isInteger(readAttempts) || readAttempts < 1) readAttempts = DEFAULT_CLEANUP_READ_ATTEMPTS
  if (attemptsArg.present) {
    const parsed = parsePositiveInt(attemptsArg.value, '--read-attempts', { min: 1, max: 10 })
    if (parsed.error) return { error: parsed.error }
    readAttempts = parsed.value
  }

  return {
    help,
    dryRun,
    collectOnly,
    readOnly: dryRun,
    pageSize,
    readAttempts,
  }
}

export function cleanupCliExitCode(parsed, result) {
  if (parsed?.help) return 0
  if (parsed?.error) return 2
  if (result?.configError) return 2
  if (result?.abort) return 1
  return 0
}

function write(stream, line) {
  stream.write(String(line) + (String(line).endsWith('\n') ? '' : '\n'))
}

export async function runCleanupCli({
  argv = [],
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  loadEnv,
  createClient,
  now = () => new Date(),
  resolveArchiveDir = resolvePropLinesDir,
  countRemaining = countCleanupRemaining,
  runCleanup = runPropCacheCleanup,
  createFetcher = createSupabaseKeysetFetcher,
  createDeleter = createSupabaseExactDeleter,
  refetchByIds = refetchPlayerPropCacheByIds,
  log,
} = {}) {
  const parsed = parseCleanupCliArgs(argv, env)
  if (parsed.help) {
    write(stdout, CLEANUP_CLI_USAGE)
    return { exitCode: 0, parsed, result: { help: true } }
  }
  if (parsed.error) {
    write(stderr, `❌ ${parsed.error}`)
    write(stderr, CLEANUP_CLI_USAGE)
    return { exitCode: 2, parsed, result: { configError: parsed.error } }
  }

  if (typeof loadEnv === 'function') loadEnv()

  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SECRET_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    write(stderr, '❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
    return { exitCode: 2, parsed, result: { configError: 'missing supabase config' } }
  }
  if (typeof createClient !== 'function') {
    write(stderr, '❌ Internal error: createClient is required')
    return { exitCode: 2, parsed, result: { configError: 'missing createClient' } }
  }

  const supabase = createClient(url, key)
  const archiveDir = resolveArchiveDir()
  const nowIso = (typeof now === 'function' ? now() : now).toISOString()
  const readOnly = parsed.readOnly
  const diagnosticLog =
    log ||
    ((line) => write(stderr, line))

  write(stdout, '')
  write(stdout, '🗑️  CLEAR STALE PROPS')
  write(stdout, '='.repeat(80))
  write(stdout, `Mode: ${readOnly ? '🔍 READ-ONLY collect/dry-run (no archive writes, no deletes)' : '✅ LIVE (archive, then delete verified rows)'}`)
  write(stdout, `Archive dir: ${archiveDir}`)
  write(stdout, `Page size: ${parsed.pageSize} (keyset by id; default ${CLEANUP_PAGE_SIZE})`)
  write(stdout, `Read attempts: ${parsed.readAttempts}`)
  write(stdout, `Cutoff (fixed for this run): ${nowIso}`)
  write(stdout, '='.repeat(80))

  const remaining = await countRemaining(supabase, nowIso, {
    maxAttempts: parsed.readAttempts,
    log: diagnosticLog,
  }).catch((err) => ({ error: err }))

  const remainingExpired = remaining?.remainingExpired
  const remainingStale = remaining?.remainingStale
  const remainingPastGame = remaining?.remainingPastGame
  const remainingTotal = remaining?.remainingTotal

  write(stdout, '')
  write(stdout, `📊 Props in database: ${remainingTotal ?? 'unavailable'}`)
  write(stdout, `   Expired (expiresAt < cutoff): ${remainingExpired ?? 'unavailable'}`)
  write(stdout, `   Stale (isStale = true): ${remainingStale ?? 'unavailable'}`)
  write(stdout, `   Past game time: ${remainingPastGame ?? 'unavailable'}`)
  if (remaining?.error) {
    write(stderr, `   count warning: ${remaining.error.message || remaining.error}`)
  }

  const fetchPage = createFetcher(supabase)
  const result = await runCleanup({
    fetchPage,
    refetchByIds: readOnly ? undefined : (ids) => refetchByIds(supabase, ids, {
      pageSize: parsed.pageSize,
      maxAttempts: parsed.readAttempts,
      log: diagnosticLog,
    }),
    deleteExact: readOnly ? undefined : createDeleter(supabase),
    nowIso,
    archiveDir,
    archivedAt: nowIso,
    dryRun: readOnly,
    pageSize: parsed.pageSize,
    maxAttempts: parsed.readAttempts,
    log: diagnosticLog,
  })

  result.remainingExpired = remainingExpired
  result.remainingStale = remainingStale
  result.remainingPastGame = remainingPastGame
  result.remainingTotal = remainingTotal
  result.cutoff = nowIso
  result.dryRun = readOnly

  if (result.abort) {
    write(stderr, '')
    write(stderr, '❌ Candidate collection or archive failed — deletion aborted.')
    if (result.error) write(stderr, `   ${result.error.message || result.error}`)
    write(stderr, '   Deletes this run: 0. PlayerPropCache was not modified.')
    if (!result.archived) write(stderr, '   Archive writes this run: 0.')
    else write(stderr, `   Verified archive rows kept on disk: ${result.archived} (deletes still 0).`)
    const footer = summarizeCleanupForOps({ ...result, deleted: 0 })
    write(stdout, '')
    write(stdout, formatCleanupOpsFooter(footer))
    return { exitCode: 1, parsed, result }
  }

  if (readOnly) {
    write(stdout, '')
    write(stdout, `💡 Collected ${result.candidates} unique rows (overlapping filters deduped).`)
    write(stdout, '💡 Read-only mode. Run without --dry-run / --collect-only to archive + delete verified rows.')
    write(stdout, '')
    write(stdout, formatCleanupOpsFooter(summarizeCleanupForOps(result)))
    return { exitCode: 0, parsed, result }
  }

  write(stdout, '')
  write(stdout, `  ✅ Archived ${result.archived} unique prop lines → ${archiveDir}`)
  write(stdout, `  ✅ Deleted ${result.deleted} verified cache rows`)
  write(stdout, `  ⏭️  Refetch version mismatches (not deleted): ${result.skippedConcurrent}`)
  write(stdout, `  ⏭️  Delete-time version mismatches (not deleted): ${result.skippedDeleteMismatch}`)

  const after = await countRemaining(supabase, nowIso, {
    maxAttempts: parsed.readAttempts,
    log: diagnosticLog,
  }).catch((err) => ({ error: err }))
  result.remainingExpired = after?.remainingExpired
  result.remainingStale = after?.remainingStale
  result.remainingPastGame = after?.remainingPastGame
  result.remainingTotal = after?.remainingTotal

  write(stdout, '')
  write(stdout, `📊 Remaining props: ${result.remainingTotal ?? 'unavailable'}`)
  write(stdout, `   Remaining expired: ${result.remainingExpired ?? 'unavailable'}`)
  write(stdout, `   Remaining stale: ${result.remainingStale ?? 'unavailable'}`)
  write(stdout, `   Remaining past-game: ${result.remainingPastGame ?? 'unavailable'}`)
  write(stdout, '')
  write(stdout, '='.repeat(80))
  write(stdout, '✅ Cleanup complete')
  write(stdout, '='.repeat(80))
  write(stdout, '')
  write(stdout, '📝 Next steps:')
  write(stdout, '  1. node scripts/fetch-fresh-games.js all')
  write(stdout, '  2. node scripts/fetch-live-odds.js all --cache-fresh')
  write(stdout, '  3. node scripts/update-scores-safely.js all')
  write(stdout, '')
  write(stdout, formatCleanupOpsFooter(summarizeCleanupForOps(result)))
  return { exitCode: 0, parsed, result }
}
