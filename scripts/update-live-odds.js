#!/usr/bin/env node
/**
 * LIVE ODDS UPDATER
 * Run this on a schedule (every 10-15 minutes) during game hours
 * 
 * With 20,000 requests/month ($30 plan):
 * - Every 10 min updates = ~110 requests/day = 3,300/month (17% budget)
 * - Every 15 min updates = ~65 requests/day = 1,950/month (10% budget)
 * 
 * USAGE:
 *   node scripts/update-live-odds.js
 */

import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const scriptPath = join(__dirname, 'fetch-live-odds.js')

console.log('\n⚡ Live Odds Update Starting...')
console.log(`📅 ${new Date().toLocaleString()}`)
console.log('=' .repeat(60))

// Run fetch-live-odds.js with --cache-fresh flag
const child = spawn('node', [scriptPath, 'all', '--cache-fresh'], {
  stdio: 'inherit',
  cwd: join(__dirname, '..')
})

child.on('error', (error) => {
  console.error('❌ Failed to start odds fetch:', error)
  process.exit(1)
})

child.on('exit', (code) => {
  if (code === 0) {
    console.log('\n✅ Live odds update completed successfully')
    console.log('=' .repeat(60))
  } else {
    console.error(`\n❌ Odds update failed with code ${code}`)
    process.exit(code)
  }
})

