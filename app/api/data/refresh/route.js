// Manual data refresh endpoint
// Allows forcing a full data refresh from the frontend

import { NextResponse } from 'next/server'
import { forceRefreshAllData } from '../../../../lib/data-manager.js'

export async function POST(request) {
  try {
    console.log('🔄 Manual data refresh requested')
    
    // Force refresh all data
    const refreshedData = await forceRefreshAllData()
    
    return NextResponse.json({
      success: true,
      message: 'Data refreshed successfully',
      timestamp: new Date().toISOString(),
      data: {
        mlbGames: refreshedData.mlbGames.length,
        nflGames: refreshedData.nflGames.length,
        picks: refreshedData.picks.length,
        playerProps: refreshedData.playerProps.length
      }
    })
    
  } catch (error) {
    console.error('❌ Error in manual data refresh:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}

// Also allow GET for easier testing
export async function GET() {
  return POST()
}

