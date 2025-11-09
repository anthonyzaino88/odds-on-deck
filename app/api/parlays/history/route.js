// Parlay History API Endpoint

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit')) || 50
    const sport = searchParams.get('sport')
    const status = searchParams.get('status')

    console.log(`📊 Fetching parlay history (limit: ${limit})`)

    // Build query
    let query = supabase
      .from('Parlay')
      .select('*, legs:ParlayLeg(*)')
      .order('createdAt', { ascending: false })
      .limit(limit)

    // Filter by sport if specified
    if (sport) {
      query = query.eq('sport', sport)
    }

    // Filter by status if specified
    if (status) {
      query = query.eq('status', status)
    }

    const { data: parlays, error } = await query

    if (error) {
      throw new Error(`Database query failed: ${error.message}`)
    }
    
    console.log(`✅ Found ${parlays?.length || 0} parlays in database`)

    // Calculate performance metrics
    const performance = calculatePerformanceMetrics(parlays || [])

    return NextResponse.json({
      success: true,
      parlays: parlays || [],
      count: parlays?.length || 0,
      performance: performance,
      fetchedAt: new Date().toISOString()
    })

  } catch (error) {
    console.error('❌ Error fetching parlay history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch parlay history', details: error.message },
      { status: 500 }
    )
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
