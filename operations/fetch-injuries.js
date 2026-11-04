#!/usr/bin/env node
/**
 * Thin ops wrapper. Canonical implementation: scripts/fetch-injuries.js
 */
import { runFetchInjuriesCli } from '../scripts/fetch-injuries.js'

runFetchInjuriesCli().then((result) => {
  process.exit(result.exitCode || 0)
}).catch((error) => {
  console.error('⚠️ fetch-injuries failed:', error.message)
  console.log('INJURIES_STATUS=failed')
  process.exit(0)
})
