// Unified Data API - Single endpoint for all application data
// Replaces multiple scattered endpoints with one reliable source

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAllData, forceRefreshAllData, getDataStatus } from '../../../lib/data-manager.js'

export async function GET(request) {
  try {
    console.log('⏸️  /api/data DISABLED - Use /api/games/today instead')
    
    // TEMPORARILY DISABLED: This uses Prisma which we're migrating to Supabase
    // Redirect to the Supabase-based endpoint
    return NextResponse.json({
      success: false,
      error: 'This endpoint is disabled during Supabase migration. Use /api/games/today instead.',
      message: 'Migration in progress - use /api/games/today for game data',
      redirectTo: '/api/games/today',
      timestamp: new Date().toISOString()
    }, { status: 503 }) // Service Unavailable
    
  } catch (error) {
    console.error('❌ Data API error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

export async function POST() {
  // POST triggers force refresh
  return GET(new Request('http://localhost:3000/api/data?force=true'))
}
