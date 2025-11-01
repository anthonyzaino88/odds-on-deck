// Debug endpoint to check environment variables
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL
  const supabaseUrl = process.env.SUPABASE_DATABASE_URL
  
  return Response.json({
    DATABASE_URL: {
      exists: !!databaseUrl,
      length: databaseUrl ? databaseUrl.length : 0,
      prefix: databaseUrl ? databaseUrl.substring(0, 20) + '...' : 'NOT SET',
      isPostgres: databaseUrl ? (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) : false
    },
    SUPABASE_DATABASE_URL: {
      exists: !!supabaseUrl,
      length: supabaseUrl ? supabaseUrl.length : 0,
      prefix: supabaseUrl ? supabaseUrl.substring(0, 20) + '...' : 'NOT SET',
      isPostgres: supabaseUrl ? (supabaseUrl.startsWith('postgresql://') || supabaseUrl.startsWith('postgres://')) : false
    },
    allEnvKeys: Object.keys(process.env).filter(key => key.includes('DATABASE') || key.includes('POSTGRES'))
  })
}

