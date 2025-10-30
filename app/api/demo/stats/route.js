// API endpoint to get demo usage statistics
import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET() {
  try {
    // Only return stats in demo mode
    if (process.env.DEMO_MODE !== 'true') {
      return NextResponse.json({ error: 'Not in demo mode' }, { status: 404 })
    }

    const now = new Date()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    // Get API usage from logs
    const [todayUsage, monthUsage] = await Promise.all([
      prisma.apiUsageLog.count({
        where: {
          timestamp: { gte: today },
          success: true
        }
      }),
      prisma.apiUsageLog.count({
        where: {
          timestamp: { gte: thisMonth },
          success: true
        }
      })
    ])

    // Get cache stats
    const { getCacheStats } = await import('../../../../lib/prop-cache-manager.js')
    const cacheStats = await getCacheStats()

    const cacheHitRate = cacheStats.total > 0 
      ? Math.round((cacheStats.fresh / cacheStats.total) * 100) 
      : 0

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
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    )
  }
}

