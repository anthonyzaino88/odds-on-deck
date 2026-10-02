// Process health + admin-client key selection. No database calls and
// no supabaseAdmin construction — imports only the pure key helpers
// so a missing secret with SUPABASE_REQUIRE_SECRET_KEY=1 still 200s.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getAdminClientHealth } from '../../../lib/supabase-admin-key.js'

export async function GET() {
  const supabaseAdmin = getAdminClientHealth()
  return NextResponse.json({
    ok: true,
    degraded: supabaseAdmin.degraded,
    supabaseAdmin,
  })
}
