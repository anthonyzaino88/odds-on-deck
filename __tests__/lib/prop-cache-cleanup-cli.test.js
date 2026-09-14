import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CLEANUP_CLI_USAGE,
  parseCleanupCliArgs,
  runCleanupCli,
} from '../../lib/prop-cache-cleanup-cli.js'

function memoryStream() {
  const chunks = []
  return {
    write(s) {
      chunks.push(String(s))
      return true
    },
    toString() {
      return chunks.join('')
    },
  }
}

describe('parseCleanupCliArgs', () => {
  test('parses read-only flags and conservative page size', () => {
    expect(parseCleanupCliArgs(['--dry-run'])).toMatchObject({
      help: false,
      dryRun: true,
      readOnly: true,
      pageSize: 50,
    })
    expect(parseCleanupCliArgs(['--collect-only', '--page-size', '25'])).toMatchObject({
      collectOnly: true,
      readOnly: true,
      pageSize: 25,
      readAttempts: 4,
    })
  })

  test('rejects unknown and invalid arguments before any work', () => {
    expect(parseCleanupCliArgs(['--explode']).error).toMatch(/Unknown or invalid/)
    expect(parseCleanupCliArgs(['--page-size', '0']).error).toMatch(/page-size/)
    expect(parseCleanupCliArgs(['--page-size', '500']).error).toMatch(/page-size/)
    expect(parseCleanupCliArgs(['--page-size']).error).toMatch(/requires an integer/)
    expect(parseCleanupCliArgs(['--read-attempts', 'nope']).error).toMatch(/read-attempts/)
  })
})

describe('runCleanupCli side-effect guards', () => {
  test('--help prints usage and does not touch DB or archives', async () => {
    const stdout = memoryStream()
    const stderr = memoryStream()
    const createClient = jest.fn()
    const loadEnv = jest.fn()
    const countRemaining = jest.fn()
    const runCleanup = jest.fn()
    const { exitCode } = await runCleanupCli({
      argv: ['--help'],
      stdout,
      stderr,
      createClient,
      loadEnv,
      countRemaining,
      runCleanup,
    })
    expect(exitCode).toBe(0)
    expect(stdout.toString()).toContain('Usage:')
    expect(stdout.toString()).toContain('--collect-only')
    expect(createClient).not.toHaveBeenCalled()
    expect(loadEnv).not.toHaveBeenCalled()
    expect(countRemaining).not.toHaveBeenCalled()
    expect(runCleanup).not.toHaveBeenCalled()
    expect(CLEANUP_CLI_USAGE).toMatch(/zero deletes/)
  })

  test('invalid arguments fail before env load or client creation', async () => {
    const stdout = memoryStream()
    const stderr = memoryStream()
    const createClient = jest.fn()
    const loadEnv = jest.fn()
    const { exitCode } = await runCleanupCli({
      argv: ['--not-a-flag'],
      stdout,
      stderr,
      createClient,
      loadEnv,
      env: { NEXT_PUBLIC_SUPABASE_URL: 'http://x', SUPABASE_SECRET_KEY: 'k' },
    })
    expect(exitCode).toBe(2)
    expect(stderr.toString()).toMatch(/Unknown or invalid/)
    expect(createClient).not.toHaveBeenCalled()
    expect(loadEnv).not.toHaveBeenCalled()
  })

  test('read-only collect failure exits 1 with zero deletes', async () => {
    const stdout = memoryStream()
    const stderr = memoryStream()
    const createClient = jest.fn(() => ({ tag: 'client' }))
    const loadEnv = jest.fn()
    const deleted = []
    const { exitCode, result } = await runCleanupCli({
      argv: ['--collect-only'],
      env: { NEXT_PUBLIC_SUPABASE_URL: 'http://example.supabase.co', SUPABASE_SECRET_KEY: 'k' },
      stdout,
      stderr,
      createClient,
      loadEnv,
      now: () => new Date('2026-09-14T08:00:00.000Z'),
      resolveArchiveDir: () => '/tmp/ood-archive-test',
      countRemaining: async () => ({
        remainingExpired: 412,
        remainingStale: 1,
        remainingPastGame: 400,
        remainingTotal: 500,
      }),
      runCleanup: async (opts) => {
        expect(opts.dryRun).toBe(true)
        return {
          abort: true,
          candidates: 0,
          archived: 0,
          deleted: 0,
          skippedConcurrent: 0,
          skippedDeleteMismatch: 0,
          error: new Error('Gateway Timeout'),
        }
      },
      createDeleter: () => async (snapshot) => {
        deleted.push(snapshot.id)
        return 1
      },
    })
    expect(exitCode).toBe(1)
    expect(result.deleted).toBe(0)
    expect(deleted).toEqual([])
    expect(createClient).toHaveBeenCalled()
    expect(loadEnv).toHaveBeenCalled()
    expect(stderr.toString()).toMatch(/Gateway Timeout/)
    expect(stdout.toString()).toMatch(/CLEANUP_STATUS=fail/)
    expect(stdout.toString()).toMatch(/CANDIDATES=0/)
    expect(stdout.toString()).toMatch(/DELETED=0/)
    expect(stdout.toString()).toMatch(/REMAINING_EXPIRED=412/)
    expect(stdout.toString()).toMatch(/READ_ONLY=true/)
  })

  test('read-only success still reports candidate and remaining counts', async () => {
    const stdout = memoryStream()
    const stderr = memoryStream()
    const { exitCode } = await runCleanupCli({
      argv: ['--dry-run'],
      env: { NEXT_PUBLIC_SUPABASE_URL: 'http://example.supabase.co', SUPABASE_SECRET_KEY: 'k' },
      stdout,
      stderr,
      createClient: jest.fn(() => ({})),
      loadEnv: jest.fn(),
      now: () => new Date('2026-09-14T08:00:00.000Z'),
      resolveArchiveDir: () => '/tmp/ood-archive-test',
      countRemaining: async () => ({
        remainingExpired: 12,
        remainingStale: 0,
        remainingPastGame: 12,
        remainingTotal: 40,
      }),
      runCleanup: async () => ({
        abort: false,
        candidates: 12,
        archived: 0,
        deleted: 0,
        skippedConcurrent: 0,
        skippedDeleteMismatch: 0,
        dryRun: true,
      }),
    })
    expect(exitCode).toBe(0)
    expect(stdout.toString()).toMatch(/Collected 12 unique rows/)
    expect(stdout.toString()).toMatch(/CLEANUP_STATUS=ok/)
    expect(stdout.toString()).toMatch(/READ_ONLY=true/)
    expect(stdout.toString()).toMatch(/REMAINING_EXPIRED=12/)
  })
})

describe('script wiring', () => {
  test('clear-stale-props defers DB work until after CLI parse', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/clear-stale-props.js'), 'utf8')
    expect(src).toMatch(/runCleanupCli/)
    expect(src).toMatch(/--help/)
    expect(src).not.toMatch(/createClient\(\s*\n\s*process\.env/)
  })

  test('ops docs mark cleanup failure as degraded and include the Grok Bot prompt', () => {
    const ops = readFileSync(join(process.cwd(), 'operations/README.md'), 'utf8')
    expect(ops).toMatch(/DEGRADED \/ PARTIAL SUCCESS/)
    expect(ops).toMatch(/cleanup_exit/)
    expect(ops).toMatch(/CLEANUP_STATUS/)
    expect(ops).toMatch(/keyset pagination/)
    expect(ops).toMatch(/--collect-only/)
    expect(ops).toMatch(/Never label the run OK because later steps succeeded after a cleanup abort/)
    expect(ops).toMatch(/pending and has not been applied/)
  })
})
