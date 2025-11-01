// Background refresh endpoint - does heavy data operations
// Called after initial page load to populate props, rosters, etc.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAllData } from '../../../../lib/data-manager.js'

export async function POST(request) {
  try {
    console.log('🔄 Background refresh started...')
    
    // Fire and forget - don't wait for completion
    // This allows the page to load while heavy operations happen
    getAllData().catch(error => {
      console.error('❌ Background refresh error (non-blocking):', error)
    })
    
    // Return immediately to not block the request
    return NextResponse.json({
      success: true,
      message: 'Background refresh started',
      status: 'processing'
    })
  } catch (error) {
    console.error('❌ Error starting background refresh:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

export async function GET(request) {
  try {
    // Check if background data is ready (check for props/picks in DB)
    const { prisma } = await import('../../../../lib/db.js')
    
    // Check if we have cached props or picks
    const propsCount = await prisma.playerPropCache.count().catch(() => 0)
    const hasData = propsCount > 0
    
    return NextResponse.json({
      ready: hasData,
      propsCount,
      message: hasData ? 'Background data is ready' : 'Background data still loading...'
    })
  } catch (error) {
    console.error('❌ Error checking background refresh status:', error)
    return NextResponse.json({
      ready: false,
      error: error.message
    }, { status: 500 })
  }
}

