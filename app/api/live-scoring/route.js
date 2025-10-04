// Live Scoring API - Dedicated endpoint for real-time game updates
// Optimized for live games only, maintains streamlined data flow

import { NextResponse } from 'next/server'
import { getLiveScoringData, forceUpdateLiveScoring, getLiveScoringStatus } from '../../../lib/live-scoring-manager.js'

export async function GET(request) {
  try {
    const url = new URL(request.url)
    const force = url.searchParams.get('force') === 'true'
    
    console.log(`🏈 Live Scoring API called (force: ${force})`)
    
    let liveData
    if (force) {
      liveData = await forceUpdateLiveScoring()
    } else {
      liveData = await getLiveScoringData()
    }
    
    const status = getLiveScoringStatus()
    
    return NextResponse.json({
      success: true,
      data: liveData,
      status,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('❌ Live Scoring API error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

export async function POST() {
  // POST triggers force update
  return GET(new Request('http://localhost:3000/api/live-scoring?force=true'))
}

