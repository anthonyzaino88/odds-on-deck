// Export training mode data for analysis
// Returns all mock prop validations in various formats

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'json' // json, csv, or analysis
    const sport = searchParams.get('sport') // optional filter
    const status = searchParams.get('status') // optional: pending, completed
    
    // Build where clause
    const where = {}
    if (sport) where.sport = sport
    if (status) where.status = status
    
    // Get all mock validations
    const mockValidations = await prisma.mockPropValidation.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    })
    
    if (format === 'csv') {
      // Convert to CSV
      const csv = convertToCSV(mockValidations)
      
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="training-data-${new Date().toISOString().split('T')[0]}.csv"`
        }
      })
    }
    
    if (format === 'analysis') {
      // Return analysis-ready format
      const analysis = generateAnalysis(mockValidations)
      
      return NextResponse.json(analysis)
    }
    
    // Default: JSON format
    return NextResponse.json({
      success: true,
      count: mockValidations.length,
      data: mockValidations
    })
    
  } catch (error) {
    console.error('❌ Error exporting training data:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

/**
 * Convert data to CSV format
 */
function convertToCSV(data) {
  if (data.length === 0) return ''
  
  // CSV headers
  const headers = [
    'id',
    'gameIdRef',
    'playerName',
    'propType',
    'threshold',
    'prediction',
    'expectedValue',
    'actualValue',
    'result',
    'status',
    'sport',
    'probability',
    'syntheticOdds',
    'confidence',
    'qualityScore',
    'createdAt',
    'validatedAt'
  ]
  
  // Create CSV rows
  const rows = data.map(item => 
    headers.map(header => {
      const value = item[header]
      // Handle null/undefined
      if (value === null || value === undefined) return ''
      // Escape quotes in strings
      if (typeof value === 'string') {
        return `"${value.replace(/"/g, '""')}"`
      }
      // Handle dates
      if (value instanceof Date) {
        return value.toISOString()
      }
      return value
    }).join(',')
  )
  
  // Combine headers and rows
  return [headers.join(','), ...rows].join('\n')
}

/**
 * Generate analysis-ready data
 */
function generateAnalysis(data) {
  const completed = data.filter(d => d.status === 'completed')
  
  // Overall stats
  const overall = {
    total: data.length,
    completed: completed.length,
    pending: data.filter(d => d.status === 'pending').length,
    accuracy: completed.length > 0 
      ? (completed.filter(d => d.result === 'correct').length / completed.length)
      : 0
  }
  
  // By sport
  const bySport = {}
  for (const sport of ['mlb', 'nfl', 'nhl']) {
    const sportData = completed.filter(d => d.sport === sport)
    bySport[sport] = {
      total: sportData.length,
      correct: sportData.filter(d => d.result === 'correct').length,
      incorrect: sportData.filter(d => d.result === 'incorrect').length,
      accuracy: sportData.length > 0
        ? (sportData.filter(d => d.result === 'correct').length / sportData.length)
        : 0
    }
  }
  
  // By prop type
  const byPropType = {}
  const propTypes = [...new Set(completed.map(d => d.propType))]
  for (const propType of propTypes) {
    const propData = completed.filter(d => d.propType === propType)
    byPropType[propType] = {
      total: propData.length,
      correct: propData.filter(d => d.result === 'correct').length,
      incorrect: propData.filter(d => d.result === 'incorrect').length,
      accuracy: propData.length > 0
        ? (propData.filter(d => d.result === 'correct').length / propData.length)
        : 0,
      avgProbability: propData.reduce((sum, d) => sum + (d.probability || 0), 0) / propData.length
    }
  }
  
  // By confidence
  const byConfidence = {}
  for (const confidence of ['high', 'medium', 'low']) {
    const confData = completed.filter(d => d.confidence === confidence)
    byConfidence[confidence] = {
      total: confData.length,
      correct: confData.filter(d => d.result === 'correct').length,
      incorrect: confData.filter(d => d.result === 'incorrect').length,
      accuracy: confData.length > 0
        ? (confData.filter(d => d.result === 'correct').length / confData.length)
        : 0
    }
  }
  
  // Best and worst performers
  const sortedPropTypes = Object.entries(byPropType)
    .filter(([_, stats]) => stats.total >= 5) // Min 5 samples
    .sort((a, b) => b[1].accuracy - a[1].accuracy)
  
  const bestPropTypes = sortedPropTypes.slice(0, 3)
  const worstPropTypes = sortedPropTypes.slice(-3).reverse()
  
  // Calibration analysis (how well probabilities match actual results)
  const calibration = []
  for (let prob = 0.5; prob <= 1.0; prob += 0.05) {
    const bucket = completed.filter(d => 
      d.probability >= prob - 0.025 && d.probability < prob + 0.025
    )
    if (bucket.length > 0) {
      calibration.push({
        probability: prob,
        count: bucket.length,
        actualAccuracy: bucket.filter(d => d.result === 'correct').length / bucket.length
      })
    }
  }
  
  return {
    summary: overall,
    bySport,
    byPropType,
    byConfidence,
    insights: {
      bestPropTypes: bestPropTypes.map(([type, stats]) => ({
        propType: type,
        accuracy: stats.accuracy,
        count: stats.total
      })),
      worstPropTypes: worstPropTypes.map(([type, stats]) => ({
        propType: type,
        accuracy: stats.accuracy,
        count: stats.total
      })),
      calibration
    },
    rawData: data
  }
}

