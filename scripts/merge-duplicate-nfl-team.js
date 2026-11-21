#!/usr/bin/env node
/**
 * One-time merge of a duplicate NFL (or other-sport) Team row onto a
 * canonical Team id. Dry-run default. Never prints secrets.
 *
 *   node scripts/merge-duplicate-nfl-team.js --from <id> --to <id>
 *   node scripts/merge-duplicate-nfl-team.js --from <id> --to <id> --backup
 *   node scripts/merge-duplicate-nfl-team.js --from <id> --to <id> --backup --apply
 *
 * Washington Commanders (verified 2026-11-21):
 *   --from 4BBSVXpZwZ4sWqGP --to NFL_28
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { config } from 'dotenv'
import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { ensurePrismaClient } from '../lib/prisma-preflight.js'
import {
  MERGE_DUPLICATE_NFL_TEAM_USAGE,
  bindPrismaMergeTransaction,
  runMergeDuplicateNflTeam,
} from '../lib/merge-duplicate-nfl-team.js'

config({ path: '.env.local' })

export { MERGE_DUPLICATE_NFL_TEAM_USAGE }

async function createPrismaTransaction(refs) {
  ensurePrismaClient()
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  const run = bindPrismaMergeTransaction(prisma, refs)
  return async (work) => {
    try {
      return await run(work)
    } finally {
      await prisma.$disconnect()
    }
  }
}

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

export async function runMergeDuplicateNflTeamCli({
  argv = process.argv.slice(2),
  createClient = createScriptSupabaseClient,
  env = process.env,
  log = console,
  writeFile = writeFileSync,
  mkdir = mkdirSync,
  cwd = process.cwd(),
  now,
  createTransaction = createPrismaTransaction,
} = {}) {
  let supabase
  try {
    supabase = createClient(env)
  } catch (error) {
    log.error?.(`❌ ${error.message}`)
    return { exitCode: 1, missingSecret: true }
  }
  return runMergeDuplicateNflTeam({
    argv,
    supabase,
    log,
    writeFile,
    mkdir,
    cwd,
    now: now || new Date(),
    schemaPath: join(cwd, 'prisma/schema.prisma'),
    createTransaction,
  })
}

if (invokedDirectly()) {
  runMergeDuplicateNflTeamCli().then((result) => {
    process.exit(result.exitCode)
  }).catch((error) => {
    console.error('Fatal:', error.message)
    process.exit(1)
  })
}
