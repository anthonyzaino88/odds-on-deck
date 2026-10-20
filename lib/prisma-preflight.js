/**
 * Guard against a missing generated Prisma client.
 *
 * Git worktrees that junction `node_modules` from another checkout often
 * have a stale or empty `node_modules/.prisma/client`. Morning ops must
 * fail loudly and attempt `npx prisma generate` instead of crashing later
 * on `Cannot find module '.prisma/client/default'`.
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

export const PRISMA_CLIENT_INDEX = 'node_modules/.prisma/client/index.js'

function defaultImportPrisma(cwd) {
  const require = createRequire(resolve(cwd, 'package.json'))
  const mod = require('@prisma/client')
  if (typeof mod?.PrismaClient !== 'function') {
    throw new Error('PrismaClient export is not a constructor')
  }
  return mod.PrismaClient
}

function defaultGenerate({ cwd, logger }) {
  logger.error?.('❌ PRISMA PREFLIGHT: running `npx prisma generate`')
  const isWin = process.platform === 'win32'
  return spawnSync(isWin ? 'npx.cmd' : 'npx', ['prisma', 'generate'], {
    cwd,
    encoding: 'utf8',
    shell: isWin,
  })
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
 * On failure, run `npx prisma generate` once and re-probe.
 * Throws after a loud log if the client is still unusable.
 */
export function ensurePrismaClient({
  cwd = process.cwd(),
  logger = console,
  exists = existsSync,
  importPrisma = defaultImportPrisma,
  generate = defaultGenerate,
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
  logger.error?.('❌ Attempting repair: npx prisma generate')

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
  return { ok: true, generated: true, clientPath }
}
