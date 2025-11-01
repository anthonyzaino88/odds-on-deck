// NFL Data Refresh API - Store NFL games and teams in database
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { fetchAndStoreNFLSchedule, fetchAndStoreNFLLiveData } from '../../../../lib/nfl-data.js'

export async function GET() {
  try {
    console.log('Starting NFL data refresh...')

    // Store NFL schedule and teams
    const scheduleResult = await fetchAndStoreNFLSchedule()
    console.log('NFL schedule result:', scheduleResult)

    // Store live NFL data
    const liveResult = await fetchAndStoreNFLLiveData()
    console.log('NFL live data result:', liveResult)

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      schedule: scheduleResult,
      liveData: liveResult
    })

  } catch (error) {
    console.error('Error in NFL data refresh:', error)
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
