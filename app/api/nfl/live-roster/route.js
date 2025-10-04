// API endpoint to fetch and store live NFL rosters from ESPN

import { fetchAndStoreLiveNFLRosters } from '../../../../lib/nfl-live-roster.js'

export async function GET() {
  try {
    console.log('🏈 API: Fetching live NFL rosters...')
    
    const result = await fetchAndStoreLiveNFLRosters()
    
    if (result.success) {
      return Response.json({
        success: true,
        message: '✅ Live NFL rosters updated successfully',
        data: {
          teamsProcessed: result.teamsProcessed,
          playersAdded: result.playersAdded,
          rosterEntries: result.rosterEntries
        }
      })
    } else {
      return Response.json({
        success: false,
        message: '❌ Failed to update live NFL rosters',
        error: result.error
      }, { status: 500 })
    }
    
  } catch (error) {
    console.error('❌ Live NFL roster API error:', error.message)
    return Response.json({
      success: false,
      message: 'API error',
      error: error.message
    }, { status: 500 })
  }
}

export async function POST() {
  return GET() // Same functionality for POST requests
}
