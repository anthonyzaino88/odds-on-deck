#!/usr/bin/env node
import { sanitizedErrorMessage } from '../lib/sanitize-error.js'
/**
 * Thin ops wrapper. Canonical implementation: scripts/fetch-injuries.js
 */
import { runFetchInjuriesCli } from '../scripts/fetch-injuries.js'

runFetchInjuriesCli().then((result) => {
  process.exit(result.exitCode || 0)
}).catch((error) => {
  console.error('⚠️ fetch-injuries failed:', sanitizedErrorMessage(error))
  console.log('INJURIES_STATUS=failed')
  process.exit(0)
})
