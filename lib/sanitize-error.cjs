'use strict'

/**
 * One scrub for logs and thrown errors. The input error is never returned
 * or attached. Public functions do not throw.
 *
 * CommonJS so scripts can require() this file on Node versions that cannot
 * load ESM. lib/sanitize-error.js re-exports the same functions.
 */

const MAX_DEPTH = 8
const MAX_BREADTH = 32
const MAX_TEXT = 32 * 1024

const SENSITIVE_WORDS = new Set([
  'key',
  'token',
  'secret',
  'password',
  'authorization',
  'cookie',
  'apikey',
  'auth',
  'credential',
  'credentials',
])

function isSensitiveName(name) {
  const parts = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (parts.some((part) => SENSITIVE_WORDS.has(part))) return true
  const joined = parts.join('')
  return joined.includes('servicerole') || joined.includes('accesstoken') || joined.includes('apikey')
}

function isWs(ch) {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\v'
}

function isIdent(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_'
}

function wordAt(text, index, word) {
  const end = index + word.length
  if (end > text.length) return false
  if (text.slice(index, end).toLowerCase() !== word) return false
  if (index > 0 && isIdent(text[index - 1])) return false
  if (end < text.length && isIdent(text[end])) return false
  return true
}

function exactRedaction(value) {
  const bare = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]
    ? value.slice(1, -1)
    : value
  return bare === '[redacted]' || bare === '[jwt]' || bare === '***'
}

function readQuoted(text, index) {
  const quote = text[index]
  if (quote !== '"' && quote !== "'") return null
  let cursor = index + 1
  while (cursor < text.length) {
    if (text[cursor] === '\\') {
      cursor += 2
      continue
    }
    if (text[cursor] === quote) return { value: text.slice(index + 1, cursor), end: cursor + 1, quoted: true }
    cursor += 1
  }
  return null
}

function readBare(text, index, stop) {
  let cursor = index
  while (cursor < text.length && !isWs(text[cursor]) && !stop.has(text[cursor])) cursor += 1
  if (cursor === index) return null
  return { value: text.slice(index, cursor), end: cursor, quoted: false }
}

function readToken(text, index) {
  if (text[index] === '"' || text[index] === "'") return readQuoted(text, index)
  return readBare(text, index, new Set())
}

function skipSpaces(text, index) {
  let cursor = index
  while (cursor < text.length && isWs(text[cursor])) cursor += 1
  return cursor
}

function decodeJsonEscapes(value) {
  let out = ''
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== '\\') {
      out += value[i]
      continue
    }
    const next = value[i + 1]
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(value.slice(i + 2, i + 6))) {
      out += String.fromCharCode(parseInt(value.slice(i + 2, i + 6), 16))
      i += 5
      continue
    }
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', "'": "'", '\\': '\\', '/': '/' }
    if (next && Object.prototype.hasOwnProperty.call(simple, next)) {
      out += simple[next]
      i += 1
      continue
    }
    out += value[i]
  }
  return out
}

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

function secretVariants(value) {
  const found = []
  const add = (item) => {
    if (typeof item === 'string' && item.length >= 8 && item !== '[redacted]' && item !== '[jwt]' && item !== '***') {
      found.push(item)
    }
  }
  add(value)
  try { add(encodeURIComponent(value)) } catch { /* ignore */ }
  try { add(JSON.stringify(value).slice(1, -1)) } catch { /* ignore */ }
  try { add(Buffer.from(value, 'utf8').toString('base64')) } catch { /* ignore */ }
  return found
}

function collectSecrets(extra) {
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
  if (typeof extra === 'string') values.push(extra)
  const seen = new Set()
  const secrets = []
  for (const value of values) {
    if (typeof value !== 'string' || value.length < 8) continue
    for (const variant of secretVariants(value)) {
      if (seen.has(variant)) continue
      seen.add(variant)
      secrets.push(variant)
    }
  }
  secrets.sort((a, b) => b.length - a.length)
  return secrets
}

function applyExactSecrets(text, secrets) {
  let raw = text
  for (const secret of secrets) {
    if (raw.indexOf(secret) !== -1) raw = raw.split(secret).join('[redacted]')
  }
  return raw
}

function safeTruncate(text) {
  if (text.length <= MAX_TEXT) return text
  let cut = MAX_TEXT
  let quote = ''
  let quoteStart = -1
  for (let i = 0; i < cut; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\' && i + 1 < cut) {
        i += 1
        continue
      }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      quoteStart = i
    }
  }
  if (quote && quoteStart >= 0) cut = quoteStart
  const marker = '[redacted]'
  const start = Math.max(0, cut - (marker.length - 1))
  const slice = text.slice(start, cut)
  const open = slice.lastIndexOf('[')
  if (open !== -1 && marker.startsWith(slice.slice(open))) cut = start + open
  return text.slice(0, cut)
}

function matchBearer(text, index) {
  let cursor = index
  if (wordAt(text, index, 'authorization')) {
    cursor = index + 'authorization'.length
    const spaced = skipSpaces(text, cursor)
    if (text[spaced] !== ':' && text[spaced] !== '=') return null
    cursor = skipSpaces(text, spaced + 1)
    if (wordAt(text, cursor, 'bearer') || wordAt(text, cursor, 'basic')) {
      cursor += text.slice(cursor, cursor + 6).toLowerCase() === 'bearer' ? 6 : 5
      const after = skipSpaces(text, cursor)
      if (after === cursor) return null
      const token = readToken(text, after)
      if (!token) return null
      const prefix = text.slice(index, after)
      if (exactRedaction(token.value)) return { text: text.slice(index, token.end), end: token.end }
      return { text: prefix + '[redacted]', end: token.end }
    }
    const token = readToken(text, cursor)
    if (!token) return null
    if (exactRedaction(token.value)) return { text: text.slice(index, token.end), end: token.end }
    return { text: text.slice(index, cursor) + '[redacted]', end: token.end }
  }
  if (!wordAt(text, index, 'bearer') && !wordAt(text, index, 'basic')) return null
  cursor = index + (text.slice(index, index + 6).toLowerCase() === 'bearer' ? 6 : 5)
  const after = skipSpaces(text, cursor)
  if (after === cursor) return null
  const token = readToken(text, after)
  if (!token) return null
  const prefix = text.slice(index, after)
  if (exactRedaction(token.value)) return { text: text.slice(index, token.end), end: token.end }
  return { text: prefix + '[redacted]', end: token.end }
}

function matchScheme(text, index, scheme) {
  if (text.slice(index, index + scheme.length).toLowerCase() !== scheme) return 0
  if (index > 0 && isIdent(text[index - 1])) return 0
  return scheme.length
}

function matchPostgres(text, index) {
  const length = matchScheme(text, index, 'postgresql://') || matchScheme(text, index, 'postgres://')
  if (!length) return null
  let cursor = index + length
  while (cursor < text.length && !isWs(text[cursor])) cursor += 1
  return { text: text.slice(index, index + length) + '[redacted]', end: cursor }
}

function authorityEnd(token) {
  let end = token.length
  for (const mark of ['/', '?', '#']) {
    const at = token.indexOf(mark)
    if (at !== -1 && at < end) end = at
  }
  return end
}

function redactPathQueryHash(rest) {
  let path = rest
  let query = ''
  let hash = ''
  const queryAt = path.indexOf('?')
  if (queryAt !== -1) {
    query = path.slice(queryAt)
    path = path.slice(0, queryAt)
  }
  const hashInQuery = query.indexOf('#')
  if (hashInQuery !== -1) {
    hash = query.slice(hashInQuery)
    query = query.slice(0, hashInQuery)
  } else {
    const hashAt = path.indexOf('#')
    if (hashAt !== -1) {
      hash = path.slice(hashAt)
      path = path.slice(0, hashAt)
    }
  }
  path = path.replace(/sb_secret_[A-Za-z0-9_-]+/gi, 'sb_secret_[redacted]')
  if (query) query = '?[redacted]'
  if (hash && (hash.indexOf('=') !== -1 || /secret|token|key|auth/i.test(hash))) hash = '#[redacted]'
  return path + query + hash
}

function finishUrl(text, index, schemeLength) {
  let cursor = index + schemeLength
  while (cursor < text.length && !isWs(text[cursor]) && text[cursor] !== '"' && text[cursor] !== "'" && text[cursor] !== '<' && text[cursor] !== '>') {
    cursor += 1
  }
  const token = text.slice(index + schemeLength, cursor)
  const at = token.slice(0, authorityEnd(token)).lastIndexOf('@')
  let rebuilt = text.slice(index, index + schemeLength)
  let rest = token
  if (at !== -1) {
    rebuilt += '[redacted]@'
    rest = token.slice(at + 1)
  }
  return { text: rebuilt + redactPathQueryHash(rest), end: cursor }
}

function matchHttp(text, index) {
  const https = matchScheme(text, index, 'https://')
  const http = https ? 0 : matchScheme(text, index, 'http://')
  const length = https || http
  if (!length) return null
  return finishUrl(text, index, length)
}

function embeddedSecret(token) {
  const lower = token.toLowerCase()
  return lower.includes('eyj')
    || lower.includes('sb_secret_')
    || lower.includes('postgres')
    || lower.includes('bearer')
    || lower.includes('basic')
    || lower.includes('://')
}

function matchSlash(text, index) {
  if (text[index] !== '/') return null
  if (text[index + 1] === '/' && (index === 0 || text[index - 1] !== ':')) return finishUrl(text, index, 2)
  let cursor = index
  while (cursor < text.length && !isWs(text[cursor]) && text[cursor] !== '"' && text[cursor] !== "'" && text[cursor] !== '<' && text[cursor] !== '>') {
    cursor += 1
  }
  const token = text.slice(index, cursor)
  const query = token.indexOf('?')
  if (query !== -1) return { text: token.slice(0, query) + '?[redacted]', end: cursor }
  if (embeddedSecret(token)) return { text: scan(token, false), end: cursor }
  return { text: token, end: cursor }
}

function matchQuery(text, index) {
  if (text[index] !== '?') return null
  let cursor = index + 1
  let hasValue = false
  while (cursor < text.length && !isWs(text[cursor]) && text[cursor] !== '"' && text[cursor] !== "'") {
    if (text[cursor] === '=') hasValue = true
    cursor += 1
  }
  if (!hasValue) return null
  return { text: '?[redacted]', end: cursor }
}

function matchJwt(text, index) {
  if (text.slice(index, index + 3) !== 'eyJ') return null
  if (index > 0 && isIdent(text[index - 1])) return null
  let cursor = index + 3
  const readPart = () => {
    const start = cursor
    while (cursor < text.length) {
      const ch = text[cursor]
      const ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_' || ch === '-'
      if (!ok) break
      cursor += 1
    }
    return cursor - start
  }
  if (readPart() < 8 || text[cursor] !== '.') return null
  cursor += 1
  if (readPart() < 8 || text[cursor] !== '.') return null
  cursor += 1
  if (readPart() < 8) return null
  if (cursor < text.length && isIdent(text[cursor])) return null
  return { end: cursor }
}

function matchSecretToken(text, index) {
  if (text.slice(index, index + 10).toLowerCase() !== 'sb_secret_') return null
  if (index > 0 && isIdent(text[index - 1])) return null
  let cursor = index + 10
  while (cursor < text.length && !isWs(text[cursor]) && text[cursor] !== '"' && text[cursor] !== "'" && text[cursor] !== ',' && text[cursor] !== '}') {
    cursor += 1
  }
  const body = text.slice(index + 10, cursor)
  if (!body) return null
  if (body === '[redacted]') return { text: text.slice(index, cursor), end: cursor }
  return { text: 'sb_secret_[redacted]', end: cursor }
}

function readJsonValue(text, index) {
  const ch = text[index]
  if (ch === '"' || ch === "'") {
    const quoted = readQuoted(text, index)
    if (!quoted) return { end: text.length }
    return quoted
  }
  if (ch === '{' || ch === '[') {
    const open = ch
    const close = ch === '{' ? '}' : ']'
    let depth = 0
    let cursor = index
    while (cursor < text.length) {
      const current = text[cursor]
      if (current === '"' || current === "'") {
        const quoted = readQuoted(text, cursor)
        if (!quoted) return { end: text.length }
        cursor = quoted.end
        continue
      }
      if (current === open) depth += 1
      else if (current === close) {
        depth -= 1
        if (depth === 0) return { end: cursor + 1 }
      }
      cursor += 1
    }
    return { end: text.length }
  }
  let cursor = index
  while (cursor < text.length && !isWs(text[cursor]) && text[cursor] !== ',' && text[cursor] !== '}' && text[cursor] !== ']') {
    cursor += 1
  }
  if (cursor === index) return null
  return { end: cursor }
}

function matchJsonField(text, index) {
  if (text[index] !== '"' && text[index] !== "'") return null
  const key = readQuoted(text, index)
  if (!key || !isSensitiveName(decodeJsonEscapes(key.value))) return null
  let cursor = skipSpaces(text, key.end)
  if (text[cursor] !== ':') return null
  cursor = skipSpaces(text, cursor + 1)
  const value = readJsonValue(text, cursor)
  if (!value) return { text: text.slice(index, cursor) + '"[redacted]"', end: text.length }
  return { text: text.slice(index, cursor) + '"[redacted]"', end: value.end }
}

function matchAssignment(text, index) {
  if (!/[A-Za-z_]/.test(text[index] || '')) return null
  if (index > 0 && isIdent(text[index - 1])) return null
  let cursor = index
  while (cursor < text.length && (isIdent(text[cursor]) || text[cursor] === '-')) cursor += 1
  const key = text.slice(index, cursor)
  if (!isSensitiveName(decodeJsonEscapes(key))) return null
  const sep = skipSpaces(text, cursor)
  if (text[sep] !== '=' && text[sep] !== ':') return null
  const valueAt = skipSpaces(text, sep + 1)
  if (wordAt(text, valueAt, 'bearer') || wordAt(text, valueAt, 'basic')) return null
  const token = text[valueAt] === '"' || text[valueAt] === "'"
    ? readQuoted(text, valueAt)
    : readBare(text, valueAt, new Set(['&', '"', "'", ',', '<', '>', '}']))
  if (!token) return null
  if (exactRedaction(token.value)) return { text: text.slice(index, token.end), end: token.end }
  return { text: text.slice(index, valueAt) + '[redacted]', end: token.end }
}

function scan(text, allowSlash) {
  const parts = []
  let index = 0
  while (index < text.length) {
    const bearer = matchBearer(text, index)
    if (bearer) { parts.push(bearer.text); index = bearer.end; continue }
    const postgres = matchPostgres(text, index)
    if (postgres) { parts.push(postgres.text); index = postgres.end; continue }
    const http = matchHttp(text, index)
    if (http) { parts.push(http.text); index = http.end; continue }
    const jwt = matchJwt(text, index)
    if (jwt) { parts.push('[redacted]'); index = jwt.end; continue }
    const secret = matchSecretToken(text, index)
    if (secret) { parts.push(secret.text); index = secret.end; continue }
    const field = matchJsonField(text, index)
    if (field) { parts.push(field.text); index = field.end; continue }
    const assignment = matchAssignment(text, index)
    if (assignment) { parts.push(assignment.text); index = assignment.end; continue }
    const query = matchQuery(text, index)
    if (query) { parts.push(query.text); index = query.end; continue }
    if (allowSlash) {
      const slash = matchSlash(text, index)
      if (slash) { parts.push(slash.text); index = slash.end; continue }
    }
    parts.push(text[index])
    index += 1
  }
  return parts.join('')
}

function coerceText(value) {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function sanitizeOddsApiLogText(text, apiKey) {
  try {
    let raw = coerceText(text)
    if (raw == null) return '[redacted]'
    const extra = typeof apiKey === 'string' ? apiKey : (apiKey != null && typeof apiKey !== 'object' ? String(apiKey) : '')
    raw = applyExactSecrets(raw, collectSecrets(extra))
    raw = safeTruncate(raw)
    return scan(raw, true)
  } catch {
    return '[redacted]'
  }
}

function errorConstructor(error) {
  try {
    if (typeof DOMException !== 'undefined' && error instanceof DOMException) return DOMException
    if (error instanceof TypeError) return TypeError
    if (error instanceof RangeError) return RangeError
    if (error instanceof SyntaxError) return SyntaxError
    if (error instanceof ReferenceError) return ReferenceError
    if (error instanceof URIError) return URIError
    if (error instanceof EvalError) return EvalError
  } catch { /* ignore */ }
  return Error
}

function freshError(message, fields) {
  const Ctor = fields.ctor || Error
  let error
  try {
    if (typeof DOMException !== 'undefined' && Ctor === DOMException) error = new DOMException(message, fields.name || 'Error')
    else error = new Ctor(message)
  } catch {
    error = new Error(message)
  }
  if (fields.cause !== undefined) {
    try { error.cause = fields.cause } catch { /* ignore */ }
  }
  if (fields.name) {
    try { error.name = fields.name } catch { /* ignore */ }
  }
  if (fields.stack) {
    try { error.stack = fields.stack } catch { /* ignore */ }
  }
  if (fields.errors) error.errors = fields.errors
  if (fields.quota !== undefined) error.quota = fields.quota
  if (fields.code !== undefined) error.code = fields.code
  return error
}

function readData(value, key, allowInherited) {
  try {
    const own = Object.getOwnPropertyDescriptor(value, key)
    if (own) {
      if (typeof own.get === 'function' || typeof own.set === 'function') return { missed: true }
      return { value: own.value }
    }
    if (!allowInherited) return { missed: true }
    let proto = Object.getPrototypeOf(value)
    while (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, key)
      if (desc) {
        if (typeof desc.get === 'function') {
          try { return { value: desc.get.call(value) } } catch { return { missed: true } }
        }
        if (typeof desc.set === 'function') return { missed: true }
        return { value: desc.value }
      }
      proto = Object.getPrototypeOf(proto)
    }
    return { missed: true }
  } catch {
    return { missed: true }
  }
}

function isErrorInstance(value) {
  try {
    return value instanceof Error
  } catch {
    return false
  }
}

function ownFields(value) {
  let names
  try {
    names = Object.keys(value)
  } catch {
    return null
  }
  const fields = []
  const limit = names.length < MAX_BREADTH ? names.length : MAX_BREADTH
  for (let i = 0; i < limit; i += 1) {
    const key = names[i]
    const read = readData(value, key)
    if (read.missed) {
      fields.push([key, '[redacted]'])
      continue
    }
    if (typeof read.value === 'function') continue
    fields.push([key, read.value])
  }
  return fields
}

function sanitizeValue(value, apiKey, seen, depth) {
  try {
    if (depth > MAX_DEPTH) return '[redacted]'
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'string') return sanitizeOddsApiLogText(value, apiKey)
    if (typeof value !== 'object') return '[redacted]'
    if (seen.has(value)) return '[redacted]'
    if (isErrorInstance(value)) return sanitizeOddsApiError(value, apiKey, seen, depth)
    seen.add(value)
    const fields = ownFields(value)
    if (!fields) return '[redacted]'
    if (Array.isArray(value)) {
      const indexes = []
      for (const [key] of fields) {
        if (!/^\d+$/.test(key)) continue
        const index = Number(key)
        if (Number.isSafeInteger(index) && index >= 0) indexes.push(index)
      }
      const dense = indexes.every((index, position) => index === position)
        && (indexes.length === 0 || indexes[indexes.length - 1] < MAX_BREADTH)
      if (!dense) {
        const copy = {}
        for (const [key, item] of fields) {
          copy[key] = isSensitiveName(key) ? '[redacted]' : sanitizeValue(item, apiKey, seen, depth + 1)
        }
        return copy
      }
      const copy = []
      for (const [key, item] of fields) {
        if (!/^\d+$/.test(key)) continue
        const index = Number(key)
        copy[index] = isSensitiveName(key) ? '[redacted]' : sanitizeValue(item, apiKey, seen, depth + 1)
      }
      return copy
    }
    const copy = {}
    for (const [key, item] of fields) {
      copy[key] = isSensitiveName(key) ? '[redacted]' : sanitizeValue(item, apiKey, seen, depth + 1)
    }
    return copy
  } catch {
    return '[redacted]'
  }
}

function sanitizeOddsApiError(error, apiKey, seen, depth) {
  try {
    const trail = seen || new Set()
    const level = depth || 0
    if (level > MAX_DEPTH) return new Error('[redacted]')
    if (error == null || typeof error !== 'object') {
      if (typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean') {
        return new Error(sanitizeOddsApiLogText(error, apiKey))
      }
      return error
    }
    if (trail.has(error)) return new Error('[redacted]')
    trail.add(error)
    const messageRead = readData(error, 'message', true)
    const nameRead = readData(error, 'name', true)
    const stackRead = readData(error, 'stack')
    const message = sanitizeOddsApiLogText(typeof messageRead.value === 'string' ? messageRead.value : '', apiKey)
    const ctor = errorConstructor(error)
    const domException = typeof DOMException === 'function' ? DOMException : null
    const fallbackName = ctor && ctor.name && ctor !== domException ? ctor.name : 'Error'
    const name = sanitizeOddsApiLogText(
      typeof nameRead.value === 'string' && nameRead.value ? nameRead.value : (fallbackName || 'Error'),
      apiKey,
    )
    const stack = typeof stackRead.value === 'string'
      ? sanitizeOddsApiLogText(stackRead.value, apiKey)
      : undefined
    let cause
    const causeRead = readData(error, 'cause')
    if (!causeRead.missed && typeof causeRead.value === 'string') cause = sanitizeOddsApiLogText(causeRead.value, apiKey)
    else if (!causeRead.missed && causeRead.value != null) cause = sanitizeOddsApiError(causeRead.value, apiKey, trail, level + 1)
    let errors
    const errorsRead = readData(error, 'errors')
    if (!errorsRead.missed && Array.isArray(errorsRead.value)) {
      const listed = ownFields(errorsRead.value) || []
      const indexes = listed
        .map(([key]) => key)
        .filter((key) => /^\d+$/.test(key))
        .map((key) => Number(key))
        .filter((index) => Number.isSafeInteger(index) && index >= 0)
      const dense = indexes.every((index, position) => index === position)
        && (indexes.length === 0 || indexes[indexes.length - 1] < MAX_BREADTH)
      const sanitizedItems = listed.map(([key, item]) => [
        key,
        item && typeof item === 'object'
          ? sanitizeOddsApiError(item, apiKey, trail, level + 1)
          : sanitizeOddsApiLogText(item, apiKey),
      ])
      if (!dense) {
        errors = {}
        for (const [key, item] of sanitizedItems) errors[key] = item
      } else {
        errors = []
        for (const [key, item] of sanitizedItems) {
          if (!/^\d+$/.test(key)) continue
          errors[Number(key)] = item
        }
      }
    }
    let quota
    const quotaRead = readData(error, 'quota')
    if (!quotaRead.missed && quotaRead.value && typeof quotaRead.value === 'object') {
      quota = sanitizeValue(quotaRead.value, apiKey, trail, level + 1)
    }
    let code
    const codeRead = readData(error, 'code')
    if (!codeRead.missed && codeRead.value != null && typeof codeRead.value !== 'object') {
      code = typeof codeRead.value === 'string'
        ? sanitizeOddsApiLogText(codeRead.value, apiKey)
        : codeRead.value
    } else if (!codeRead.missed && codeRead.value && typeof codeRead.value === 'object') {
      code = sanitizeValue(codeRead.value, apiKey, trail, level + 1)
    }
    return freshError(message, { name, stack, cause, errors, quota, code, ctor: errorConstructor(error) })
  } catch {
    return new Error('[redacted]')
  }
}

function sanitizedErrorMessage(error, apiKey) {
  try {
    if (error == null) return ''
    if (typeof error !== 'object') return sanitizeOddsApiLogText(error, apiKey)
    return sanitizeOddsApiError(error, apiKey).message || ''
  } catch {
    return '[redacted]'
  }
}

function sanitizeLoggedValue(value, apiKey, seen, depth) {
  try {
    return sanitizeValue(value, apiKey, seen || new Set(), depth || 0)
  } catch {
    return '[redacted]'
  }
}

module.exports = {
  sanitizeOddsApiLogText,
  sanitizeOddsApiError,
  sanitizedErrorMessage,
  sanitizeLoggedValue,
}
