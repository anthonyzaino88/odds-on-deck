/**
 * ESM facade. The implementation lives in sanitize-error.cjs so CommonJS
 * scripts can require() it on Node versions that do not load ESM.
 */
import sanitizer from './sanitize-error.cjs'

export const sanitizeOddsApiLogText = sanitizer.sanitizeOddsApiLogText
export const sanitizeOddsApiError = sanitizer.sanitizeOddsApiError
export const sanitizedErrorMessage = sanitizer.sanitizedErrorMessage
export const sanitizeLoggedValue = sanitizer.sanitizeLoggedValue
