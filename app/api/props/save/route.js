// Retired: anonymous Track/Save used the service-role client and could
// overwrite Published / graded PropValidation rows (same cache propId).
// Browser Track now persists only in localStorage via addSavedProp.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { gone } from '../../../../lib/api-security.js'

export async function POST() {
  return gone('Prop tracking is local-only. This endpoint no longer writes.')
}
