#!/usr/bin/env node
// Morning-ops Prisma preflight. Safe to run before any script that imports
// @prisma/client. Logs loudly and runs `npx prisma generate` if the generated
// client is missing or unimportable.

import { ensurePrismaClient } from '../lib/prisma-preflight.js'

try {
  ensurePrismaClient()
} catch (error) {
  console.error('❌ Fatal error:', error.message || error)
  process.exit(1)
}
