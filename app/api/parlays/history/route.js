// Parlay History API - Fetch completed parlay results and statistics

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const sport = searchParams.get('sport') // null | 'nfl' | 'nhl' | 'mlb'
    const outcome = searchParams.get('outcome') // null | 'won' | 'lost'
    
    console.log(`📊 Fetching parlay history (limit: ${limit}, sport: ${sport || 'all'}, outcome: ${outcome || 'all'})`)
    
    // FETCH PENDING PARLAYS from Parlay table
    let pendingQuery = supabase
      .from('Parlay')
      .select('*')
      .eq('status', 'pending')
      .order('createdAt', { ascending: false })
      .limit(limit)
    
    if (sport) {
      pendingQuery = pendingQuery.eq('sport', sport)
    }
    
    const { data: pendingParlays, error: pendingError } = await pendingQuery
    
    if (pendingError) {
      console.warn('⚠️ Error fetching pending parlays:', pendingError.message)
    }
    
    console.log(`📋 Found ${pendingParlays?.length || 0} pending parlays`)
    
    // FETCH COMPLETED PARLAYS from ParlayHistory table
    let historyQuery = supabase
      .from('ParlayHistory')
      .select('*')
      .order('completedAt', { ascending: false })
      .limit(limit)
    
    // Apply filters
    if (sport) {
      historyQuery = historyQuery.eq('sport', sport)
    }
    
    if (outcome) {
      historyQuery = historyQuery.eq('outcome', outcome)
    }
    
    const { data: history, error } = await historyQuery
    
    if (error) {
      // If table doesn't exist yet, return empty data gracefully
      if (error.message.includes('Could not find the table') || error.message.includes('ParlayHistory')) {
        console.log('⚠️ ParlayHistory table not created yet. Run scripts/create-parlay-history-table.sql')
        return NextResponse.json({
          success: true,
          pending: pendingParlays || [],
          history: [],
          stats: calculateStats([]),
          count: 0,
          message: 'ParlayHistory table not created yet. Please run the SQL script to enable tracking.'
        })
      }
      throw new Error(`Failed to fetch parlay history: ${error.message}`)
    }
    
    // Calculate statistics
    const stats = calculateStats(history || [])

    // Normalize dates - ensure they're all in UTC format with 'Z' marker
    // Supabase returns timestamps without 'Z', which can cause parsing issues
    const normalizeDates = (games) => games.map(game => ({
      ...game,
      date: game.date && !game.date.endsWith('Z') && !game.date.includes('+')
        ? game.date + 'Z'
        : game.date
    }))

    // Normalize dates in parlay legs (they reference game dates)
    const normalizeParlays = (parlays) => parlays.map(parlay => ({
      ...parlay,
      legs: parlay.legs ? parlay.legs.map(leg => ({
        ...leg,
        gameTime: leg.gameTime && !leg.gameTime.endsWith('Z') && !leg.gameTime.includes('+')
          ? leg.gameTime + 'Z'
          : leg.gameTime
      })) : parlay.legs
    }))

    return NextResponse.json({
      success: true,
      pending: normalizeParlays(pendingParlays || []),
      history: normalizeParlays(history || []),
      stats,
      count: (history?.length || 0) + (pendingParlays?.length || 0)
    })
    
  } catch (error) {
    console.error('❌ Error fetching parlay history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch parlay history', details: error.message },
      { status: 500 }
    )
  }
}

function calculateStats(history) {
  if (!history || history.length === 0) {
    return {
      total: 0,
      won: 0,
      lost: 0,
      cancelled: 0,
      winRate: 0,
      avgOdds: 0,
      avgEdge: 0,
      bySport: {},
      byLegCount: {},
      byConfidence: {}
    }
  }
  
  const total = history.length
  const won = history.filter(p => p.outcome === 'won').length
  const lost = history.filter(p => p.outcome === 'lost').length
  const cancelled = history.filter(p => p.outcome === 'cancelled').length
  const winRate = total > 0 ? ((won / total) * 100).toFixed(1) : 0
  
  // Calculate averages
  const avgOdds = history.length > 0 
    ? (history.reduce((sum, p) => sum + (p.totalOdds || 0), 0) / history.length).toFixed(2)
    : 0
  
  const avgEdge = history.length > 0
    ? (history.reduce((sum, p) => sum + (p.edge || 0), 0) / history.length * 100).toFixed(1)
    : 0
  
  // By sport
  const bySport = {}
  history.forEach(p => {
    const sport = p.sport || 'unknown'
    if (!bySport[sport]) {
      bySport[sport] = { total: 0, won: 0, lost: 0, winRate: 0 }
    }
    bySport[sport].total++
    if (p.outcome === 'won') bySport[sport].won++
    if (p.outcome === 'lost') bySport[sport].lost++
  })
  
  // Calculate win rates for each sport
  Object.keys(bySport).forEach(sport => {
    const sportStats = bySport[sport]
    sportStats.winRate = sportStats.total > 0
      ? ((sportStats.won / sportStats.total) * 100).toFixed(1)
      : 0
  })
  
  // By leg count
  const byLegCount = {}
  history.forEach(p => {
    const legCount = p.legCount || 0
    if (!byLegCount[legCount]) {
      byLegCount[legCount] = { total: 0, won: 0, lost: 0, winRate: 0 }
    }
    byLegCount[legCount].total++
    if (p.outcome === 'won') byLegCount[legCount].won++
    if (p.outcome === 'lost') byLegCount[legCount].lost++
  })
  
  // Calculate win rates for each leg count
  Object.keys(byLegCount).forEach(legCount => {
    const stats = byLegCount[legCount]
    stats.winRate = stats.total > 0
      ? ((stats.won / stats.total) * 100).toFixed(1)
      : 0
  })
  
  // By confidence
  const byConfidence = {}
  history.forEach(p => {
    const conf = p.confidence || 'unknown'
    if (!byConfidence[conf]) {
      byConfidence[conf] = { total: 0, won: 0, lost: 0, winRate: 0 }
    }
    byConfidence[conf].total++
    if (p.outcome === 'won') byConfidence[conf].won++
    if (p.outcome === 'lost') byConfidence[conf].lost++
  })
  
  // Calculate win rates for each confidence level
  Object.keys(byConfidence).forEach(conf => {
    const stats = byConfidence[conf]
    stats.winRate = stats.total > 0
      ? ((stats.won / stats.total) * 100).toFixed(1)
      : 0
  })
  
  return {
    total,
    won,
    lost,
    cancelled,
    winRate: parseFloat(winRate),
    avgOdds: parseFloat(avgOdds),
    avgEdge: parseFloat(avgEdge),
    bySport,
    byLegCount,
    byConfidence
  }
}
