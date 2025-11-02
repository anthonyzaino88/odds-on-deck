export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

export async function GET() {
  const dbUrl = process.env.DATABASE_URL || 'NOT SET'
  
  return NextResponse.json({
    database_url_set: !!process.env.DATABASE_URL,
    database_url_length: dbUrl.length,
    database_url_preview: dbUrl.substring(0, 50) + '...',
    is_postgres: dbUrl.includes('postgresql') || dbUrl.includes('postgres'),
    is_supabase: dbUrl.includes('supabase'),
    hostname: dbUrl.includes('@') ? dbUrl.split('@')[1]?.split(':')[0] : 'unknown'
  })
}
