// High-frequency live data refresh for active games

import { NextResponse } from 'next/server'
import { fetchAndStoreLiveGameData } from '../../../../lib/live-data.js'
import { fetchAndStoreNFLLiveData } from '../../../../lib/nfl-data.js'
import { fetchOdds } from '../../../../lib/vendors/odds.js'
import { createOdds } from '../../../../lib/db.js'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET() {
  try {
    console.log('🔄 Starting high-frequency live refresh...')
    
    const results = {
      mlb: { success: false, gamesUpdated: 0 },
      nfl: { success: false, gamesUpdated: 0 },
      odds: { success: false, oddsStored: 0 },
      timestamp: new Date().toISOString()
    }
    
    // 1. Refresh MLB live data
    try {
      const mlbResult = await fetchAndStoreLiveGameData()
      results.mlb = mlbResult
      console.log(`✅ MLB: Updated ${mlbResult.gamesUpdated || 0} games`)
    } catch (error) {
      console.error('❌ MLB live data error:', error.message)
    }
    
    // 2. Refresh NFL live data
    try {
      const nflResult = await fetchAndStoreNFLLiveData()
      results.nfl = nflResult
      console.log(`✅ NFL: Updated ${nflResult.gamesUpdated || 0} games`)
    } catch (error) {
      console.error('❌ NFL live data error:', error.message)
    }
    
    // 3. Odds are now managed by the API Usage Manager
    // This endpoint focuses on live data only to reduce API calls
    results.odds = { success: true, oddsStored: 0, message: 'Odds managed by API Usage Manager' }
    
    console.log('🎯 Live refresh complete:', results)
    
    return NextResponse.json({
      success: true,
      results,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('❌ Live refresh error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

export async function POST() {
  return GET()
}
