#!/usr/bin/env node
// Local ops wrapper — same daily fetch as scripts/fetch-team-performance-data.js

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { config } from 'dotenv'
import { ensurePrismaClient } from '../lib/prisma-preflight.js'
import { runFetchTeamPerformanceCli } from '../scripts/fetch-team-performance-data.js'

config({ path: '.env.local' })

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

export { runFetchTeamPerformanceCli }

if (invokedDirectly()) {
  ensurePrismaClient({ warnOnly: true })
  runFetchTeamPerformanceCli()
    .then((summary) => {
      process.exit(summary?.exitCode ?? 0)
    })
    .catch((error) => {
      console.error('❌ Fatal error:', error)
      process.exit(1)
    })
}
