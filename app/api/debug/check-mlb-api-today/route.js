// Check what the MLB API returns for today

import { NextResponse } from 'next/server'
import { fetchSchedule } from '../../../../lib/vendors/stats.js'

export async function GET() {
  try {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    
    console.log(`Checking MLB API for ${todayStr}`)
    
    const scheduleData = await fetchSchedule(todayStr, { noCache: true })
    
    return NextResponse.json({
      success: true,
      date: todayStr,
      gamesCount: scheduleData.length,
      games: scheduleData.map(g => ({
        id: g.id,
        matchup: `${g.away.abbr} @ ${g.home.abbr}`,
        date: g.date,
        status: g.status,
        mlbGameId: g.mlbGameId
      }))
    })
    
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
