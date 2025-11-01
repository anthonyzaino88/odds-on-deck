// Dedicated odds refresh endpoint with API usage management
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { fetchOdds } from '../../../../lib/vendors/odds.js'
import { createOdds } from '../../../../lib/db.js'
import { getApiUsageStats } from '../../../../lib/api-usage-manager.js'

export async function GET() {
  try {
    console.log('💰 Starting managed odds refresh...')
    
    const results = {
      success: true,
      mlb: { oddsFetched: 0, oddsStored: 0 },
      nfl: { oddsFetched: 0, oddsStored: 0 },
      usage: null,
      timestamp: new Date().toISOString()
    }
    
    // Get current API usage stats
    const usageStats = await getApiUsageStats()
    results.usage = usageStats
    
    console.log('📊 Current API Usage:', {
      callsThisHour: usageStats?.callsThisHour || 0,
      remainingCalls: usageStats?.remainingCallsThisHour || 0,
      estimatedCostToday: usageStats?.estimatedCostToday || 0
    })
    
    // Fetch MLB odds (will be rate-limited by API Usage Manager)
    try {
      console.log('⚾ Fetching MLB odds...')
      const mlbOdds = await fetchOdds('mlb')
      results.mlb.oddsFetched = mlbOdds.length
      
      let mlbStored = 0
      for (const odds of mlbOdds) {
        try {
          await createOdds(odds)
          mlbStored++
        } catch (error) {
          // Skip duplicates
        }
      }
      results.mlb.oddsStored = mlbStored
      console.log(`✅ MLB: Fetched ${mlbOdds.length} odds, stored ${mlbStored}`)
    } catch (error) {
      console.error('❌ MLB odds error:', error.message)
    }
    
    // Fetch NFL odds (will be rate-limited by API Usage Manager)
    try {
      console.log('🏈 Fetching NFL odds...')
      const nflOdds = await fetchOdds('nfl')
      results.nfl.oddsFetched = nflOdds.length
      
      let nflStored = 0
      for (const odds of nflOdds) {
        try {
          await createOdds(odds)
          nflStored++
        } catch (error) {
          // Skip duplicates
        }
      }
      results.nfl.oddsStored = nflStored
      console.log(`✅ NFL: Fetched ${nflOdds.length} odds, stored ${nflStored}`)
    } catch (error) {
      console.error('❌ NFL odds error:', error.message)
    }
    
    console.log('🎯 Managed odds refresh complete:', results)
    
    return NextResponse.json({
      success: true,
      results,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('❌ Managed odds refresh error:', error)
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

