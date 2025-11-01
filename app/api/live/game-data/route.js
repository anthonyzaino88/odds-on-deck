// API endpoint to fetch and update live game data
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { fetchAndStoreLiveGameData } from '../../../../lib/live-data.js'

export async function GET() {
  try {
    console.log('Starting live game data refresh...')
    
    const result = await fetchAndStoreLiveGameData()
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      result
    })
    
  } catch (error) {
    console.error('Error in live game data refresh:', error)
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
