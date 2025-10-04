// Manual odds refresh endpoint - bypasses smart timing for specific needs

import { NextResponse } from 'next/server'
import { fetchOdds } from '../../../../lib/vendors/odds.js'
import { createOdds } from '../../../../lib/db.js'
import { getApiUsageStats } from '../../../../lib/api-usage-manager.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const sport = searchParams.get('sport') || 'mlb'
    const force = searchParams.get('force') === 'true'
    
    console.log(`💰 Manual odds refresh for ${sport.toUpperCase()}${force ? ' (FORCED)' : ''}...`)
    
    const results = {
      success: true,
      sport,
      force,
      oddsFetched: 0,
      oddsStored: 0,
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
    
    // For manual refresh, we can bypass the smart timing if force=true
    if (force) {
      console.log('⚠️ FORCE mode - bypassing smart timing checks')
    }
    
    // Fetch odds (will still respect hourly limits)
    try {
      console.log(`📊 Fetching ${sport.toUpperCase()} odds...`)
      const odds = await fetchOdds(sport)
      results.oddsFetched = odds.length
      
      let stored = 0
      for (const odd of odds) {
        try {
          await createOdds(odd)
          stored++
        } catch (error) {
          // Skip duplicates
        }
      }
      results.oddsStored = stored
      console.log(`✅ ${sport.toUpperCase()}: Fetched ${odds.length} odds, stored ${stored}`)
    } catch (error) {
      console.error(`❌ ${sport.toUpperCase()} odds error:`, error.message)
      results.success = false
      results.error = error.message
    }
    
    console.log('🎯 Manual odds refresh complete:', results)
    
    return NextResponse.json({
      success: results.success,
      results,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('❌ Manual odds refresh error:', error)
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

