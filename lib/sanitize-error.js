/**
 * ESM facade. The implementation lives in sanitize-error.cjs so CommonJS
 * scripts can require() it. Env values are installed from the server-only
 * secrets module by that file. Client bundles alias the secrets module to
 * an empty stub, so the env var names are not shipped.
 */
import sanitizer from './sanitize-error.cjs'

export const sanitizeOddsApiLogText = sanitizer.sanitizeOddsApiLogText
export const sanitizeOddsApiError = sanitizer.sanitizeOddsApiError
export const sanitizedErrorMessage = sanitizer.sanitizedErrorMessage
export const sanitizeLoggedValue = sanitizer.sanitizeLoggedValue
