#!/usr/bin/env node
// Local ops wrapper — same daily fetch as scripts/fetch-team-performance-data.js

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { config } from 'dotenv'
import { runFetchTeamPerformanceData } from '../lib/team-performance-fetch.js'

config({ path: '.env.local' })

function invokedDirectly() {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

export { runFetchTeamPerformanceData }

if (invokedDirectly()) {
  console.log('\n📊 Fetching Team Performance Data from ESPN...\n')
  runFetchTeamPerformanceData()
    .then((summary) => {
      console.log('\n✅ Team performance data fetch complete!\n')
      process.exit(summary?.exitCode ?? 0)
    })
    .catch((error) => {
      console.error('❌ Fatal error:', error)
      process.exit(1)
    })
}
