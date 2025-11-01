// Debug endpoint to check environment variables
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL
  
  return Response.json({
    hasDatabaseUrl: !!databaseUrl,
    urlLength: databaseUrl ? databaseUrl.length : 0,
    urlPrefix: databaseUrl ? databaseUrl.substring(0, 15) + '...' : 'NOT SET',
    startsWithPostgres: databaseUrl ? (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) : false,
    allEnvKeys: Object.keys(process.env).filter(key => key.includes('DATABASE') || key.includes('POSTGRES'))
  })
}

