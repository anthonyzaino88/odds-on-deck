// API endpoint to refresh current and upcoming NFL weeks

import { NextResponse } from 'next/server'
import { fetchAndStoreNFLSchedule, fetchAndStoreNFLLiveData } from '../../../../lib/nfl-data.js'

/**
 * Determine the current NFL week based on the date
 * NFL season typically starts first Thursday of September
 * Each week is 7 days
 */
function getCurrentNFLWeek() {
  const now = new Date()
  
  // 2024 NFL Season schedule:
  // Week 1: Sep 5-9, 2024
  // Week 2: Sep 12-16, 2024
  // Week 3: Sep 19-23, 2024
  // Week 4: Sep 26-30, 2024
  // Week 5: Oct 3-7, 2024
  // Week 6: Oct 10-14, 2024
  
  // For now, hardcode to Week 5 since we're in late September/early October
  // In production, you'd use the ESPN API to get the current week
  const currentWeek = 5
  const seasonYear = 2024
  
  console.log(`📅 Current date: ${now.toISOString().split('T')[0]}`)
  console.log(`🏈 Setting current week to: ${currentWeek}`)
  
  return { week: currentWeek, seasonYear, isPastSeason: false }
}

export async function GET() {
  try {
    console.log('🏈 Starting automatic NFL week refresh...')
    
    const { week: currentWeek, seasonYear, isPastSeason } = getCurrentNFLWeek()
    
    console.log(`📅 Detected current week: ${currentWeek} (${seasonYear} season)`)
    
    const results = {
      success: true,
      currentWeek,
      seasonYear,
      weeks: [],
      totalGames: 0,
      timestamp: new Date().toISOString()
    }
    
    // Fetch only current week (Week 5)
    const weeksToFetch = [currentWeek]
    
    for (const week of weeksToFetch) {
      console.log(`📅 Fetching week ${week}...`)
      
      try {
        const scheduleResult = await fetchAndStoreNFLSchedule(week, seasonYear)
        
        results.weeks.push({
          week,
          games: scheduleResult.games,
          success: scheduleResult.success
        })
        
        results.totalGames += scheduleResult.games
        
        // Small delay between weeks
        await new Promise(resolve => setTimeout(resolve, 100))
        
      } catch (error) {
        console.error(`❌ Error fetching week ${week}:`, error)
        results.weeks.push({
          week,
          error: error.message,
          success: false
        })
      }
    }
    
    // Update live data for all active games
    console.log('📡 Updating live data for all games...')
    const liveResult = await fetchAndStoreNFLLiveData()
    results.liveData = liveResult
    
    console.log(`✅ Auto-refresh complete! Current week is ${currentWeek}, fetched ${results.totalGames} games`)
    
    return NextResponse.json(results)
    
  } catch (error) {
    console.error('❌ Error in auto-refresh:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}
