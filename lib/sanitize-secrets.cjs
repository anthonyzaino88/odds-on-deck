'use strict'

/**
 * Server-side secret values. Env var names live only in this file so the
 * client sanitizer bundle does not ship them. lib/sanitize-secrets.js
 * marks the lookup server-only.
 */

const NAMED_SECRET_ENV = [
  'ODDS_API_KEY',
  'CRON_SECRET',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

function isSecretEnvName(name) {
  return NAMED_SECRET_ENV.indexOf(name) !== -1 || /_(KEY|SECRET|TOKEN)$/i.test(name)
}

function databasePasswords(url) {
  if (typeof url !== 'string' || url.indexOf('://') === -1) return []
  const rest = url.slice(url.indexOf('://') + 3)
  let authEnd = rest.length
  for (const mark of ['/', '?', '#']) {
    const at = rest.indexOf(mark)
    if (at !== -1 && at < authEnd) authEnd = at
  }
  const authority = rest.slice(0, authEnd)
  const at = authority.lastIndexOf('@')
  if (at === -1) return []
  const userinfo = authority.slice(0, at)
  const colon = userinfo.indexOf(':')
  if (colon === -1) return []
  const raw = userinfo.slice(colon + 1)
  let decoded = raw
  try { decoded = decodeURIComponent(raw) } catch { decoded = raw }
  return [raw, decoded]
}

function collectEnvSecretValues() {
  const values = []
  try {
    const env = process.env || {}
    const names = Object.keys(env)
    for (const name of names) {
      if (!isSecretEnvName(name)) continue
      const value = env[name]
      if (typeof value === 'string') values.push(value)
    }
    for (const urlName of ['DATABASE_URL', 'DIRECT_URL']) {
      values.push(...databasePasswords(env[urlName]))
    }
  } catch { /* ignore */ }
  return values
}

function install() {
  require('./sanitize-error.cjs').setSecretCollector(collectEnvSecretValues)
}

module.exports = {
  collectEnvSecretValues,
  install,
}
