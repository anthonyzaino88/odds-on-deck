#!/usr/bin/env node
// Morning-ops Prisma preflight. Safe to run before any script that imports
// @prisma/client. Logs loudly and runs `node prisma/build/index.js generate`
// if the generated client is missing or unimportable (`npx` is fallback only).

import { ensurePrismaClient } from '../lib/prisma-preflight.js'

try {
  // Warn-only: morning-edges (fetch + calculate) does not import Prisma.
  // Scripts that construct PrismaClient (auto-validate-parlays) fail closed.
  ensurePrismaClient({ warnOnly: true })
} catch (error) {
  console.error('⚠️  PRISMA PREFLIGHT: continuing after unexpected error:', error.message || error)
}
