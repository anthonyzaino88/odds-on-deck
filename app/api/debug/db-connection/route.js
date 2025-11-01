export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const dbUrl = process.env.DATABASE_URL
    
    // Parse the connection string
    let parsed = {}
    if (dbUrl) {
      try {
        const url = new URL(dbUrl)
        parsed = {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          username: url.username ? url.username.substring(0, 3) + '***' : 'N/A',
          hasPassword: !!url.password,
          database: url.pathname.split('/')[1],
          searchParams: Object.fromEntries(url.searchParams)
        }
      } catch (e) {
        parsed = { error: 'Could not parse URL' }
      }
    }
    
    return NextResponse.json({
      debug: true,
      databaseUrl: {
        exists: !!dbUrl,
        length: dbUrl ? dbUrl.length : 0,
        prefix: dbUrl ? dbUrl.substring(0, 40) + '...' : 'NOT SET',
        parsed
      },
      help: {
        issue: 'Cannot reach database server',
        solution: [
          '1. Go to Vercel Settings → Environment Variables',
          '2. Check DATABASE_URL value',
          '3. If using Supabase, use "Session pooler" NOT "Direct connection"',
          '4. Format should be: postgresql://user:password@host:port/database?schema=public',
          '5. Make sure password doesn\'t have special characters (or is URL-encoded)'
        ]
      }
    })
    
  } catch (error) {
    return NextResponse.json({
      error: error.message
    }, { status: 500 })
  }
}
