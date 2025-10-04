// Unified Data API - Single endpoint for all application data
// Replaces multiple scattered endpoints with one reliable source

import { NextResponse } from 'next/server'
import { getAllData, forceRefreshAllData, getDataStatus } from '../../../lib/data-manager.js'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const forceRefresh = url.searchParams.get('force') === 'true'
    
    console.log(`📊 Data API called (force: ${forceRefresh})`)
    
    let data
    if (forceRefresh) {
      data = await forceRefreshAllData()
    } else {
      data = await getAllData()
    }
    
    const status = getDataStatus()
    
    return NextResponse.json({
      success: true,
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
