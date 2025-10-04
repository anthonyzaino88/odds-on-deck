// Debug endpoint to force refresh all current rosters

import { NextResponse } from 'next/server'
import { forceRefreshAllRosters } from '../../../../lib/live-data.js'

export async function GET() {
  try {
    console.log('Starting force roster refresh...')
    
    const result = await forceRefreshAllRosters()
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      result
    })
    
  } catch (error) {
    console.error('Error in force roster refresh:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

export async function POST() {
  return GET()
}
