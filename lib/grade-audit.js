/**
 * Optional tamper-evidence fields for PropValidation grade writes.
 *
 * Parlay / ParlayLeg already have updatedAt. Published / graded
 * PropValidation rows only had timestamp + completedAt, so a later
 * overwrite left no updatedAt / who / source.
 *
 * These columns land in scripts/migrations/005_prop_validation_grade_audit.sql.
 * Writes must work before the owner applies that file: try the audit
 * fields, then retry without them on a missing-column error.
 */

export const PROP_VALIDATION_AUDIT_FIELDS = Object.freeze([
  'updatedAt',
  'gradedAt',
  'gradedBy',
  'gradeSource',
])

export function propValidationGradeAudit(now = new Date(), options = {}) {
  const instant = (now instanceof Date ? now : new Date(now)).toISOString()
  const gradedBy = String(options.gradedBy || 'system').slice(0, 64)
  const gradeSource = String(options.gradeSource || 'unknown').slice(0, 64)
  return {
    updatedAt: instant,
    gradedAt: instant,
    gradedBy,
    gradeSource,
  }
}

export function isMissingColumnError(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '42703' || code === 'PGRST204') return true
  const msg = String(error.message || error.details || '')
  return /column|schema cache|does not exist/i.test(msg)
}

export function withoutAuditFields(payload) {
  const next = { ...(payload || {}) }
  for (const key of PROP_VALIDATION_AUDIT_FIELDS) delete next[key]
  return next
}

/**
 * @param {(payload: object) => Promise<{ data?: any, error?: any }>} doUpdate
 */
export async function updateWithOptionalAudit(doUpdate, payload) {
  const first = await doUpdate(payload)
  if (!first?.error) return first
  if (!isMissingColumnError(first.error)) return first
  return doUpdate(withoutAuditFields(payload))
}
