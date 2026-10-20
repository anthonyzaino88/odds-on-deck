/**
 * Guard against a missing generated Prisma client.
 *
 * Git worktrees that junction `node_modules` from another checkout often
 * have a stale or empty `node_modules/.prisma/client`. Morning ops must
 * fail loudly and attempt `prisma generate` instead of crashing later
 * on `Cannot find module '.prisma/client/default'`.
 *
 * Windows worktrees can also be missing `node_modules/.bin/prisma.cmd`,
 * so `npx prisma generate` fails with `'prisma' is not recognized`. The
 * primary repair is `node require.resolve('prisma/build/index.js') generate`.
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

export const PRISMA_CLIENT_INDEX = 'node_modules/.prisma/client/index.js'
export const PRISMA_CLI_MODULE = 'prisma/build/index.js'

function defaultImportPrisma(cwd) {
  const require = createRequire(resolve(cwd, 'package.json'))
  const mod = require('@prisma/client')
  if (typeof mod?.PrismaClient !== 'function') {
    throw new Error('PrismaClient export is not a constructor')
  }
  return mod.PrismaClient
}

function defaultResolvePrismaCli(cwd) {
  const require = createRequire(resolve(cwd, 'package.json'))
  return require.resolve(PRISMA_CLI_MODULE)
}

function spawnNpxPrismaGenerate({ cwd, spawn }) {
  const isWin = process.platform === 'win32'
  return spawn(isWin ? 'npx.cmd' : 'npx', ['prisma', 'generate'], {
    cwd,
    encoding: 'utf8',
    shell: isWin,
  })
}

/**
 * Run `prisma generate`. Prefer the package CLI via node so a missing
 * `node_modules/.bin/prisma.cmd` cannot break Windows. `npx` is only a
 * secondary fallback.
 */
export function runPrismaGenerate({
  cwd = process.cwd(),
  logger = console,
  spawn = spawnSync,
  resolveCli = defaultResolvePrismaCli,
  execPath = process.execPath,
} = {}) {
  let cliPath = null
  try {
    cliPath = resolveCli(cwd)
  } catch (error) {
    logger.error?.(`❌ PRISMA PREFLIGHT: could not resolve ${PRISMA_CLI_MODULE}: ${error?.message || error}`)
  }

  if (cliPath) {
    logger.error?.(`❌ PRISMA PREFLIGHT: running \`${execPath} ${cliPath} generate\``)
    const nodeResult = spawn(execPath, [cliPath, 'generate'], { cwd, encoding: 'utf8' })
    const status = nodeResult?.status ?? nodeResult?.code ?? 1
    if (status === 0) return { ...nodeResult, via: 'node-cli', cliPath }
    logger.error?.(`❌ node prisma CLI generate exited ${status}`)
    if (nodeResult?.stderr) logger.error?.(String(nodeResult.stderr).trim())
    logger.error?.('❌ Falling back to `npx prisma generate`')
  } else {
    logger.error?.('❌ Falling back to `npx prisma generate`')
  }

  logger.error?.('❌ PRISMA PREFLIGHT: running `npx prisma generate`')
  const npxResult = spawnNpxPrismaGenerate({ cwd, spawn })
  return { ...npxResult, via: 'npx', cliPath }
}

function probePrismaClient({ cwd, clientPath, exists, importPrisma }) {
  if (!exists(clientPath)) {
    return { ok: false, reason: `missing ${clientPath}` }
  }
  try {
    importPrisma(cwd)
    return { ok: true, reason: null }
  } catch (error) {
    return { ok: false, reason: `PrismaClient import failed: ${error?.message || error}` }
  }
}

/**
 * Check that the generated Prisma client exists and can be imported.
 * On failure, run prisma generate (node CLI, then npx) and re-probe.
 * Throws after a loud log if the client is still unusable.
 */
export function ensurePrismaClient({
  cwd = process.cwd(),
  logger = console,
  exists = existsSync,
  importPrisma = defaultImportPrisma,
  generate = runPrismaGenerate,
} = {}) {
  const clientPath = resolve(cwd, PRISMA_CLIENT_INDEX)
  const probe = () => probePrismaClient({ cwd, clientPath, exists, importPrisma })

  const first = probe()
  if (first.ok) return { ok: true, generated: false, clientPath }

  logger.error?.('❌ PRISMA PREFLIGHT FAILED')
  logger.error?.(`❌ Prisma client is missing or unimportable: ${first.reason}`)
  logger.error?.('❌ This often happens when node_modules is junctioned into a git worktree.')
  logger.error?.('❌ Never junction node_modules. Run `npm ci` in each worktree.')
  logger.error?.('❌ If a junction already exists, remove it with `cmd /c rmdir <link>` (no /s).')
  logger.error?.(`❌ Attempting repair: node ${PRISMA_CLI_MODULE} generate (npx fallback)`)

  const result = generate({ cwd, logger })
  const status = result?.status ?? result?.code ?? 1
  if (status !== 0) {
    logger.error?.(`❌ prisma generate exited ${status}`)
    if (result?.stderr) logger.error?.(String(result.stderr).trim())
    throw new Error(`Prisma client preflight failed: generate exited ${status}`)
  }

  const second = probe()
  if (!second.ok) {
    logger.error?.(`❌ Prisma client still broken after generate: ${second.reason}`)
    logger.error?.('❌ Do not junction node_modules into worktrees. Run `npm ci` per worktree.')
    logger.error?.('❌ Remove a Windows junction with `cmd /c rmdir <link>` (no /s).')
    throw new Error(`Prisma client preflight failed: ${second.reason}`)
  }

  logger.error?.('⚠️  PRISMA PREFLIGHT: regenerated client; continuing')
  return { ok: true, generated: true, clientPath, via: result?.via || null }
}
