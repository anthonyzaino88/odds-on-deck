// Parlay History API Endpoint

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit')) || 50
    const sport = searchParams.get('sport')
    const status = searchParams.get('status')

    console.log(`📊 Fetching parlay history (limit: ${limit})`)

    // Fetch parlays from database
    const parlays = await prisma.parlay.findMany({
      take: limit,
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        legs: true
      }
    })
    
    console.log(`✅ Found ${parlays.length} parlays in database`)

    // Filter by sport if specified (additional client-side filtering)
    let filteredParlays = parlays
    if (sport) {
      filteredParlays = parlays.filter(parlay => parlay.sport === sport)
    }

    // Filter by status if specified (additional client-side filtering)
    if (status) {
      filteredParlays = filteredParlays.filter(parlay => parlay.status === status)
    }

    // Calculate performance metrics
    const performance = calculatePerformanceMetrics(filteredParlays)

    return NextResponse.json({
      success: true,
      parlays: filteredParlays,
      count: filteredParlays.length,
      performance: performance,
      fetchedAt: new Date().toISOString()
    })

  } catch (error) {
    console.error('❌ Error fetching parlay history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch parlay history', details: error.message },
      { status: 500 }
    )
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Calculate performance metrics for parlays
 */
function calculatePerformanceMetrics(parlays) {
  const completedParlays = parlays.filter(p => p.outcome && p.outcome !== 'pending')
  const wonParlays = completedParlays.filter(p => p.outcome === 'won')
  const lostParlays = completedParlays.filter(p => p.outcome === 'lost')

  const totalParlays = completedParlays.length
  const winRate = totalParlays > 0 ? (wonParlays.length / totalParlays) * 100 : 0

  // Calculate average edge and expected value
  const avgEdge = parlays.length > 0 
    ? parlays.reduce((sum, p) => sum + p.edge, 0) / parlays.length 
    : 0

  const avgExpectedValue = parlays.length > 0 
    ? parlays.reduce((sum, p) => sum + p.expectedValue, 0) / parlays.length 
    : 0

  // Calculate ROI (simplified)
  const totalWagered = totalParlays * 100 // Assuming $100 per parlay
  const totalWon = wonParlays.reduce((sum, p) => sum + (p.totalOdds * 100), 0)
  const roi = totalWagered > 0 ? ((totalWon - totalWagered) / totalWagered) * 100 : 0

  return {
    totalParlays: totalParlays,
    wonParlays: wonParlays.length,
    lostParlays: lostParlays.length,
    winRate: Math.round(winRate * 100) / 100,
    avgEdge: Math.round(avgEdge * 1000) / 1000,
    avgExpectedValue: Math.round(avgExpectedValue * 1000) / 1000,
    roi: Math.round(roi * 100) / 100
  }
}
