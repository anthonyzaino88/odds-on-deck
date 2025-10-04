// Comprehensive data refresh endpoint

import { NextResponse } from 'next/server'
import { fetchAndStoreLiveGameData } from '../../../lib/live-data.js'
import { fetchAndStoreNFLLiveData } from '../../../lib/nfl-data.js'
import { fetchAndStoreLiveLineups } from '../../../lib/live-data.js'
import { fetchOdds } from '../../../lib/vendors/odds.js'
import { createOdds } from '../../../lib/db.js'

export async function GET() {
  try {
    console.log('🔄 Starting comprehensive data refresh...')
    
    const results = {
      liveData: { mlb: 0, nfl: 0 },
      lineups: { playersAdded: 0 },
      odds: { stored: 0 },
      timestamp: new Date().toISOString()
    }
    
    // 1. Refresh live game data
    try {
      const [mlbLive, nflLive] = await Promise.all([
        fetchAndStoreLiveGameData(),
        fetchAndStoreNFLLiveData()
      ])
      
      results.liveData.mlb = mlbLive.gamesUpdated || 0
      results.liveData.nfl = nflLive.gamesUpdated || 0
      
      console.log(`✅ Live data: MLB ${results.liveData.mlb}, NFL ${results.liveData.nfl}`)
    } catch (error) {
      console.error('❌ Live data error:', error.message)
    }
    
    // 2. Refresh lineups
    try {
      const lineupResult = await fetchAndStoreLiveLineups()
      results.lineups.playersAdded = lineupResult.playersAdded || 0
      console.log(`✅ Lineups: ${results.lineups.playersAdded} players added/updated`)
    } catch (error) {
      console.error('❌ Lineup error:', error.message)
    }
    
    // 3. Odds are now managed by dedicated endpoint with usage limits
    // Call the managed odds refresh endpoint
    try {
      const oddsResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/cron/refresh-odds`)
      const oddsResult = await oddsResponse.json()
      
      if (oddsResult.success) {
        results.odds = {
          stored: (oddsResult.results.mlb.oddsStored || 0) + (oddsResult.results.nfl.oddsStored || 0),
          usage: oddsResult.results.usage
        }
        console.log(`✅ Odds: ${results.odds.stored} new odds stored (managed)`)
      } else {
        console.error('❌ Managed odds refresh failed:', oddsResult.error)
        results.odds = { stored: 0, error: oddsResult.error }
      }
    } catch (error) {
      console.error('❌ Odds error:', error.message)
      results.odds = { stored: 0, error: error.message }
    }
    
    console.log('🎯 Comprehensive refresh complete:', results)
    
    return NextResponse.json({
      success: true,
      results,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('❌ Comprehensive refresh error:', error)
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
