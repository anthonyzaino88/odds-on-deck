/**
 * Client-safe scrubber. Pattern redaction only. Env-var names and values
 * are read from lib/sanitize-secrets.js, which is server-only.
 */
import sanitizer from './sanitize-error.cjs'

export const sanitizeOddsApiLogText = sanitizer.sanitizeOddsApiLogText
export const sanitizeOddsApiError = sanitizer.sanitizeOddsApiError
export const sanitizedErrorMessage = sanitizer.sanitizedErrorMessage
export const sanitizeLoggedValue = sanitizer.sanitizeLoggedValue
