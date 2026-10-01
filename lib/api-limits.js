/**
 * Shared read-path clamps for public API query params.
 * Keep these pure so contract tests can cover NaN / 0 / negative / oversized
 * values without standing up Supabase or the generator.
 */

export const VALIDATION_LIMIT_DEFAULT = 100
export const VALIDATION_LIMIT_MIN = 1
export const VALIDATION_LIMIT_MAX = 200

export const PARLAY_LEGS_DEFAULT = 3
export const PARLAY_LEGS_MIN = 2
export const PARLAY_LEGS_MAX = 6

export const MAX_PARLAYS_DEFAULT = 10
export const MAX_PARLAYS_MIN = 1
export const MAX_PARLAYS_MAX = 20

export const HISTORY_LIMIT_DEFAULT = 50
export const HISTORY_LIMIT_MIN = 1
export const HISTORY_LIMIT_MAX = 100

export const PROPS_LIMIT_DEFAULT = 1000
export const PROPS_LIMIT_MIN = 1
export const PROPS_LIMIT_MAX = 1000

/** Statuses the public validation read path may serve. */
export const PUBLIC_VALIDATION_STATUSES = ['completed', 'manual_closed', 'needs_review']

export function parseInteger(value) {
  if (typeof value === 'number') return value
  if (value == null || value === '') return Number.NaN
  return Number.parseInt(String(value), 10)
}

/**
 * Clamp a positive page size. NaN, 0, negative, or missing → defaultValue.
 * Values above max are capped; values between 0 and min are raised to min.
 */
export function clampLimit(value, { defaultValue, min, max } = {}) {
  const n = parseInteger(value)
  if (!Number.isFinite(n) || n <= 0) return defaultValue
  return Math.min(max, Math.max(min, n))
}

export function clampValidationLimit(value) {
  return clampLimit(value, {
    defaultValue: VALIDATION_LIMIT_DEFAULT,
    min: VALIDATION_LIMIT_MIN,
    max: VALIDATION_LIMIT_MAX,
  })
}

export function clampParlayLegs(value) {
  const n = parseInteger(value)
  if (!Number.isFinite(n)) return PARLAY_LEGS_DEFAULT
  return Math.min(PARLAY_LEGS_MAX, Math.max(PARLAY_LEGS_MIN, n))
}

export function clampMaxParlays(value) {
  return clampLimit(value, {
    defaultValue: MAX_PARLAYS_DEFAULT,
    min: MAX_PARLAYS_MIN,
    max: MAX_PARLAYS_MAX,
  })
}

export function clampHistoryLimit(value) {
  return clampLimit(value, {
    defaultValue: HISTORY_LIMIT_DEFAULT,
    min: HISTORY_LIMIT_MIN,
    max: HISTORY_LIMIT_MAX,
  })
}

export function clampPropsLimit(value) {
  return clampLimit(value, {
    defaultValue: PROPS_LIMIT_DEFAULT,
    min: PROPS_LIMIT_MIN,
    max: PROPS_LIMIT_MAX,
  })
}

/**
 * Public /api/validation status gate.
 * Missing status is allowed (caller then excludes pending).
 * `pending` and any non-allow-listed value are rejected.
 */
export function parsePublicValidationStatus(raw) {
  if (raw == null || raw === '') {
    return { ok: true, status: undefined }
  }
  const status = String(raw).trim()
  if (status === 'pending') {
    return { ok: false, error: 'Pending validations are not available on the public API' }
  }
  if (!PUBLIC_VALIDATION_STATUSES.includes(status)) {
    return { ok: false, error: `status must be one of: ${PUBLIC_VALIDATION_STATUSES.join(', ')}` }
  }
  return { ok: true, status }
}
