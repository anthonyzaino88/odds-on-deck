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
  if (config.mode === 'refund-holder') {
    const first = budget.reserve(2, { captures: 0 })
    const second = budget.reserve(2, { captures: 0 })
    fs.writeFileSync(config.idPath, JSON.stringify({ first, second }))
    budget.reconcile(first, { last: 0 })
    finish({ ok: Boolean(first.ok && second.ok), error: null, credits: first.credits }, 0)
  } else if (config.mode === 'refund-reclaimer') {
    const saved = JSON.parse(fs.readFileSync(config.idPath, 'utf8'))
    budget.reconcile(saved.first, { last: 0 })
    const third = budget.reserve(2, { captures: 0 })
    finish({
      ok: third.ok,
      status: third.status,
      credits: third.credits,
      error: null,
    }, 0)
  } else if (config.mode === 'mixed-line-batch') {
    const attempts = Math.max(0, Number(config.attempts) || 0)
    let accepted = 0
    for (let i = 0; i < attempts; i += 1) {
      const held = budget.reserve(8, {
        captures: 1,
        gameLineCredits: 6,
        countPropCapture: true,
      })
      if (!held.ok) break
      budget.reconcile(held, { last: 6, remaining: 5000, used: (accepted + 1) * 6 })
      accepted += 1
    }
    finish({
      ok: true,
      accepted,
      status: budget.status(),
      gameLineCredits: budget.todayGameLineCredits(),
      credits: budget.todayCredits(),
      error: null,
    }, 0)
  } else {
  const result = budget.reserve(config.credits, config.extra || {})
  if (config.reconcile && result.ok) {
    budget.reconcile(result, config.quota || { last: result.credits })
  }
  finish({
    ok: result.ok,
    status: result.status,
    credits: result.credits,
    error: null,
  }, 0)
  }
} catch (error) {
  finish({
    ok: false,
    status: null,
    credits: 0,
    error: error?.message || String(error),
    code: error?.code || null,
  }, 1)
}
