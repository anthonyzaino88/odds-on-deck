// API endpoint to get demo usage statistics
import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET() {
  try {
    // Only return stats in demo mode
    if (process.env.DEMO_MODE !== 'true') {
      return NextResponse.json({ error: 'Not in demo mode' }, { status: 404 })
    }

    // Return default stats (API usage tracking not implemented yet)
    // In production, this would query actual usage logs
    const todayUsage = 0
    const monthUsage = 0
    const cacheHitRate = 0

    return NextResponse.json({
      today: todayUsage,
      month: monthUsage,
      todayLimit: 16,
      monthLimit: 500,
      cacheHitRate,
      remainingToday: Math.max(0, 16 - todayUsage),
      remainingMonth: Math.max(0, 500 - monthUsage)
    })

  } catch (error) {
    console.error('Error fetching demo stats:', error)
    // Return default values on error
    return NextResponse.json({
      today: 0,
      month: 0,
      todayLimit: 16,
      monthLimit: 500,
      cacheHitRate: 0,
      remainingToday: 16,
      remainingMonth: 500
    })
  }
}

