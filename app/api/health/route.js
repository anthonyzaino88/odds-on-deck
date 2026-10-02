// Process health + admin-client key selection. No database calls.
// Safe to curl after deploy: does not print keys or connection strings.

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getAdminClientHealth } from '../../../lib/supabase-admin.js'

export async function GET() {
  const supabaseAdmin = getAdminClientHealth()
  return NextResponse.json({
    ok: true,
    degraded: supabaseAdmin.degraded,
    supabaseAdmin,
  })
}
