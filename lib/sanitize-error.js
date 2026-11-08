/**
 * One scrub for logs and thrown errors. Query strings, bearer tokens,
 * database URLs, service keys, and JWTs come off before anything is printed.
 * The input error is never returned or attached.
 */

const SANITIZE_MAX_DEPTH = 8

const ALREADY_REDACTED = String.raw`(?!\[(?:redacted|jwt)\]|\*{3}(?!\S))`

export function sanitizeOddsApiLogText(text, apiKey) {
  let raw = String(text ?? '')
  if (apiKey) raw = raw.split(String(apiKey)).join('[redacted]')
  raw = raw.replace(
    new RegExp(String.raw`((?:authorization\s*[:=]\s*)?(?:bearer|basic)\s+)(?:"[^"]*"|'[^']*'|${ALREADY_REDACTED}\S+)`, 'gi'),
    '$1[redacted]',
  )
  raw = raw.replace(
    new RegExp(String.raw`(authorization\s*[:=]\s*)(?!(?:bearer|basic)\b)(?:"[^"]*"|'[^']*'|${ALREADY_REDACTED}\S+)`, 'gi'),
    '$1[redacted]',
  )
  raw = raw.replace(/\b((?:postgres|postgresql):\/\/)(?!\[redacted\])[^\s"'<>)]+/gi, '$1[redacted]')
  raw = raw.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
  raw = raw.replace(/\bsb_secret_(?!\[redacted\])[A-Za-z0-9_-]+/gi, 'sb_secret_[redacted]')
  raw = raw.replace(/((?:https?:\/\/|\/)[^\s"'<>)]*)\?[^\s"'<>)]*/gi, '$1?[redacted]')
  raw = raw.replace(
    new RegExp(String.raw`((?:api[_-]?key|apikey|access[_-]?token|token|secret|password|service[_-]?role(?:[_-]?key)?)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|${ALREADY_REDACTED}[^\s&"',<>]+)`, 'gi'),
    '$1[redacted]',
  )
  return raw
}

function freshError(message, { name = 'Error', stack, cause, errors, quota, code } = {}) {
  const error = new Error(message, cause !== undefined ? { cause } : undefined)
  error.name = name
  if (stack) error.stack = stack
  if (errors) error.errors = errors
  if (quota) error.quota = quota
  if (code !== undefined) error.code = code
  return error
}

/**
 * Fresh error chain. A frozen error or a cause that points at itself
 * cannot be reached from the result.
 */
export function sanitizeOddsApiError(error, apiKey, seen = new Set(), depth = 0) {
  if (depth > SANITIZE_MAX_DEPTH) return new Error('[redacted]')
  if (error == null || typeof error !== 'object') {
    if (typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean') {
      return new Error(sanitizeOddsApiLogText(error, apiKey))
    }
    return error
  }
  if (seen.has(error)) return new Error('[redacted]')
  seen.add(error)
  const message = sanitizeOddsApiLogText(
    typeof error.message === 'string' ? error.message : '',
    apiKey,
  )
  const name = sanitizeOddsApiLogText(
    typeof error.name === 'string' && error.name ? error.name : 'Error',
    apiKey,
  )
  const stack = typeof error.stack === 'string'
    ? sanitizeOddsApiLogText(error.stack, apiKey)
    : undefined
  let cause
  if (typeof error.cause === 'string') {
    cause = sanitizeOddsApiLogText(error.cause, apiKey)
  } else if (error.cause != null) {
    cause = sanitizeOddsApiError(error.cause, apiKey, seen, depth + 1)
  }
  let errors
  if (Array.isArray(error.errors)) {
    errors = error.errors.map((item) => (
      item && typeof item === 'object'
        ? sanitizeOddsApiError(item, apiKey, seen, depth + 1)
        : sanitizeOddsApiLogText(item, apiKey)
    ))
  }
  const quota = error.quota && typeof error.quota === 'object' ? { ...error.quota } : undefined
  const code = error.code != null && typeof error.code !== 'object' ? error.code : undefined
  return freshError(message, { name, stack, cause, errors, quota, code })
}

export function sanitizedErrorMessage(error, apiKey) {
  if (error == null) return ''
  if (typeof error !== 'object') return sanitizeOddsApiLogText(error, apiKey)
  return sanitizeOddsApiError(error, apiKey).message || ''
}

/**
 * Value safe to pass to console.error/warn/log. Errors stay errors.
 * Plain objects keep their fields, with string fields scrubbed.
 */
export function sanitizeLoggedValue(value, apiKey, seen = new Set(), depth = 0) {
  if (depth > SANITIZE_MAX_DEPTH) return '[redacted]'
  if (value instanceof Error) return sanitizeOddsApiError(value, apiKey, seen, depth)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return sanitizeOddsApiLogText(value, apiKey)
  }
  if (value == null || typeof value !== 'object') return value
  if (seen.has(value)) return '[redacted]'
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLoggedValue(item, apiKey, seen, depth + 1))
  }
  const copy = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') copy[key] = sanitizeOddsApiLogText(item, apiKey)
    else if (item && typeof item === 'object') copy[key] = sanitizeLoggedValue(item, apiKey, seen, depth + 1)
    else copy[key] = item
  }
  if (typeof value.message === 'string' && !copy.message) {
    copy.message = sanitizeOddsApiLogText(value.message, apiKey)
  }
  return copy
}
