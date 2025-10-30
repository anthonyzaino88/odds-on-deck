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
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() // 0-11
  
  // Determine season year
  // NFL season runs Sep-Feb, so Jan-Feb games are from previous year's season
  const seasonYear = currentMonth <= 1 ? currentYear - 1 : currentYear
  
  // NFL 2025 season starts Thursday, September 4, 2025 (Week 1)
  // 2024 season started Thursday, September 5, 2024
  const seasonStartDate = new Date(seasonYear, 8, 4) // September 4 of season year
  
  // Calculate weeks since season start
  const daysSinceStart = Math.floor((now - seasonStartDate) / (1000 * 60 * 60 * 24))
  const weeksSinceStart = Math.floor(daysSinceStart / 7)
  
  // Week 1 starts on day 0, so add 1
  let currentWeek = weeksSinceStart + 1
  
  // NFL regular season is weeks 1-18
  if (currentWeek < 1) currentWeek = 1
  if (currentWeek > 18) currentWeek = 18
  
  // Check if we're past the season (after February)
  const isPastSeason = currentMonth > 1 && currentMonth < 8
  
  console.log(`📅 Current date: ${now.toISOString().split('T')[0]}`)
  console.log(`🏈 Calculated current week: ${currentWeek} (${seasonYear} season)`)
  console.log(`📊 Days since season start: ${daysSinceStart}`)
  
  return { week: currentWeek, seasonYear, isPastSeason }
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
