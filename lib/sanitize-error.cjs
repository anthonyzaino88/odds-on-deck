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
  while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) cursor += 1
  return cursor
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

function matchHttp(text, index) {
  const https = matchScheme(text, index, 'https://')
  const http = https ? 0 : matchScheme(text, index, 'http://')
  const length = https || http
  if (!length) return null
  let cursor = index + length
  const bodyStart = cursor
  while (cursor < text.length && !isWs(text[cursor]) && text[cursor] !== '"' && text[cursor] !== "'" && text[cursor] !== '<' && text[cursor] !== '>') {
    cursor += 1
  }
  const token = text.slice(bodyStart, cursor)
  const slash = token.indexOf('/')
  const at = token.indexOf('@')
  const query = token.indexOf('?')
  let rebuilt = text.slice(index, index + length)
  let rest = token
  if (at !== -1 && (slash === -1 || at < slash) && (query === -1 || at < query)) {
    rebuilt += '[redacted]@'
    rest = token.slice(at + 1)
  }
  const queryAt = rest.indexOf('?')
  if (queryAt !== -1) rebuilt += rest.slice(0, queryAt) + '?[redacted]'
  else rebuilt += rest
  return { text: rebuilt, end: cursor }
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
  if (ch === '"' || ch === "'") return readQuoted(text, index)
  if (ch === '{' || ch === '[') {
    const open = ch
    const close = ch === '{' ? '}' : ']'
    let depth = 0
    let cursor = index
    while (cursor < text.length) {
      const current = text[cursor]
      if (current === '"' || current === "'") {
        const quoted = readQuoted(text, cursor)
        if (!quoted) return null
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
    return null
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
  if (!key || !isSensitiveName(key.value)) return null
  let cursor = skipSpaces(text, key.end)
  if (text[cursor] !== ':') return null
  cursor = skipSpaces(text, cursor + 1)
  const value = readJsonValue(text, cursor)
  if (!value) return null
  return { text: text.slice(index, cursor) + '"[redacted]"', end: value.end }
}

function matchAssignment(text, index) {
  if (!/[A-Za-z_]/.test(text[index] || '')) return null
  if (index > 0 && isIdent(text[index - 1])) return null
  let cursor = index
  while (cursor < text.length && (isIdent(text[cursor]) || text[cursor] === '-')) cursor += 1
  const key = text.slice(index, cursor)
  if (!isSensitiveName(key)) return null
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
    if (raw.length > MAX_TEXT) raw = raw.slice(0, MAX_TEXT)
    if (typeof apiKey === 'string' && apiKey.length > 0) raw = raw.split(apiKey).join('[redacted]')
    else if (apiKey != null && typeof apiKey !== 'object') {
      const key = String(apiKey)
      if (key) raw = raw.split(key).join('[redacted]')
    }
    return scan(raw, true)
  } catch {
    return '[redacted]'
  }
}

function freshError(message, fields) {
  const error = new Error(message, fields.cause !== undefined ? { cause: fields.cause } : undefined)
  error.name = fields.name || 'Error'
  if (fields.stack) error.stack = fields.stack
  if (fields.errors) error.errors = fields.errors
  if (fields.quota !== undefined) error.quota = fields.quota
  if (fields.code !== undefined) error.code = fields.code
  return error
}

function readData(value, key) {
  try {
    const desc = Object.getOwnPropertyDescriptor(value, key)
    if (!desc) return { missed: true }
    if (typeof desc.get === 'function') {
      try {
        return { value: desc.get.call(value) }
      } catch {
        return { missed: true }
      }
    }
    return { value: desc.value }
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
    names = Object.getOwnPropertyNames(value)
  } catch {
    return null
  }
  const fields = []
  const limit = names.length < MAX_BREADTH ? names.length : MAX_BREADTH
  for (let i = 0; i < limit; i += 1) {
    const key = names[i]
    let desc
    try {
      desc = Object.getOwnPropertyDescriptor(value, key)
    } catch {
      fields.push([key, '[redacted]'])
      continue
    }
    let fieldValue = '[redacted]'
    if (desc && typeof desc.get !== 'function') fieldValue = desc.value
    else if (desc && typeof desc.get === 'function') {
      try {
        fieldValue = desc.get.call(value)
      } catch {
        fieldValue = '[redacted]'
      }
    }
    if (desc && !desc.enumerable && key !== 'message' && key !== 'stack' && key !== 'name') continue
    fields.push([key, fieldValue])
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
      const copy = []
      for (const [key, item] of fields) {
        if (key === 'length') continue
        const index = Number(key)
        if (!Number.isInteger(index) || index < 0) continue
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
    const messageRead = readData(error, 'message')
    const nameRead = readData(error, 'name')
    const stackRead = readData(error, 'stack')
    const message = sanitizeOddsApiLogText(typeof messageRead.value === 'string' ? messageRead.value : '', apiKey)
    const name = sanitizeOddsApiLogText(
      typeof nameRead.value === 'string' && nameRead.value ? nameRead.value : 'Error',
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
      errors = []
      for (const [key, item] of listed) {
        if (key === 'length') continue
        const index = Number(key)
        if (!Number.isInteger(index) || index < 0) continue
        errors[index] = item && typeof item === 'object'
          ? sanitizeOddsApiError(item, apiKey, trail, level + 1)
          : sanitizeOddsApiLogText(item, apiKey)
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
    return freshError(message, { name, stack, cause, errors, quota, code })
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
