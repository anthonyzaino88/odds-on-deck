import fs from 'node:fs'
import { createOddsApiBudget } from '../../lib/odds-api-budget.js'

const config = JSON.parse(process.argv[2])
const budget = createOddsApiBudget({
  persist: true,
  filesystem: fs,
  now: config.now,
  purpose: 'close-capture',
  env: config.env,
  log: { log() {}, warn() {} },
})

function finish(payload, code) {
  const line = `${JSON.stringify(payload)}\n`
  process.stdout.write(line, () => {
    process.exit(code)
  })
}

try {
  const result = budget.reserve(config.credits, config.extra || {})
  finish({
    ok: result.ok,
    status: result.status,
    credits: result.credits,
    error: null,
  }, 0)
} catch (error) {
  finish({
    ok: false,
    status: null,
    credits: 0,
    error: error?.message || String(error),
    code: error?.code || null,
  }, 1)
}
