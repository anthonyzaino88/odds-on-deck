// Unified Data API - Single endpoint for all application data
// Replaces multiple scattered endpoints with one reliable source

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getAllData, forceRefreshAllData, getDataStatus } from '../../../lib/data-manager.js'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const forceRefresh = url.searchParams.get('force') === 'true'
    
    console.log(`📊 Data API called (force: ${forceRefresh})`)
    
    let data
    let success = true
    let error = null
    
    if (forceRefresh) {
      const result = await forceRefreshAllData(false) // Don't bypass cooldown
      
      // Check if refresh was successful
      if (result.success === false) {
        success = false
        error = result.error
        data = result.data // Use cached data
      } else {
        data = result
      }
    } else {
      data = await getAllData()
    }
    
    const status = getDataStatus()
    
    return NextResponse.json({
      success,
      error,
      data,
      status,
      timestamp: new Date().toISOString()
    })
    
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
