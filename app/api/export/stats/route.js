// Export analytics and chart data for Excel
import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days')) || 90

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    // Fetch all data
    const [parlays, validations] = await Promise.all([
      prisma.parlay.findMany({
        where: { createdAt: { gte: cutoffDate } },
        include: { legs: true },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.propValidation.findMany({
        where: { timestamp: { gte: cutoffDate } },
        orderBy: { timestamp: 'desc' }
      })
    ])

    // Calculate statistics
    const stats = calculateStatistics(parlays, validations)

    // Generate CSV with chart-ready data
    const csv = generateStatsCSV(stats, parlays, validations)

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="parlay_stats_${new Date().toISOString().split('T')[0]}.csv"`
      }
    })

  } catch (error) {
    console.error('❌ Error exporting stats:', error)
    return NextResponse.json(
      { error: 'Failed to export stats', details: error.message },
      { status: 500 }
    )
  }
}

function calculateStatistics(parlays, validations) {
  // Parlay statistics
  const parlayStats = {
    total: parlays.length,
    byStatus: {},
    bySport: {},
    byType: {},
    byLegCount: {},
    avgOdds: 0,
    avgEdge: 0,
    avgProbability: 0
  }

  let totalOdds = 0
  let totalEdge = 0
  let totalProb = 0

  parlays.forEach(p => {
    parlayStats.byStatus[p.status] = (parlayStats.byStatus[p.status] || 0) + 1
    parlayStats.bySport[p.sport] = (parlayStats.bySport[p.sport] || 0) + 1
    parlayStats.byType[p.type] = (parlayStats.byType[p.type] || 0) + 1
    parlayStats.byLegCount[p.legCount] = (parlayStats.byLegCount[p.legCount] || 0) + 1
    
    totalOdds += p.totalOdds || 0
    totalEdge += p.edge || 0
    totalProb += p.probability || 0
  })

  if (parlays.length > 0) {
    parlayStats.avgOdds = totalOdds / parlays.length
    parlayStats.avgEdge = totalEdge / parlays.length
    parlayStats.avgProbability = totalProb / parlays.length
  }

  // Validation statistics
  const validationStats = {
    total: validations.length,
    completed: 0,
    pending: 0,
    correct: 0,
    incorrect: 0,
    pushes: 0,
    accuracy: 0,
    byPropType: {},
    byConfidence: {},
    bySport: {},
    avgEdge: 0,
    roi: 0
  }

  let totalEdgeVal = 0

  validations.forEach(v => {
    validationStats[v.status] = (validationStats[v.status] || 0) + 1
    
    if (v.result) {
      validationStats[v.result] = (validationStats[v.result] || 0) + 1
    }

    if (v.status === 'completed') {
      validationStats.completed++
    } else {
      validationStats.pending++
    }

    // By prop type
    if (!validationStats.byPropType[v.propType]) {
      validationStats.byPropType[v.propType] = {
        total: 0,
        correct: 0,
        incorrect: 0,
        pushes: 0,
        accuracy: 0
      }
    }
    validationStats.byPropType[v.propType].total++
    if (v.result === 'correct') validationStats.byPropType[v.propType].correct++
    if (v.result === 'incorrect') validationStats.byPropType[v.propType].incorrect++
    if (v.result === 'push') validationStats.byPropType[v.propType].pushes++

    // By confidence
    if (!validationStats.byConfidence[v.confidence]) {
      validationStats.byConfidence[v.confidence] = {
        total: 0,
        correct: 0,
        incorrect: 0
      }
    }
    validationStats.byConfidence[v.confidence].total++
    if (v.result === 'correct') validationStats.byConfidence[v.confidence].correct++
    if (v.result === 'incorrect') validationStats.byConfidence[v.confidence].incorrect++

    // By sport
    if (v.sport) {
      validationStats.bySport[v.sport] = (validationStats.bySport[v.sport] || 0) + 1
    }

    totalEdgeVal += v.edge || 0
  })

  // Calculate accuracy
  const completedValidations = validationStats.correct + validationStats.incorrect
  if (completedValidations > 0) {
    validationStats.accuracy = (validationStats.correct / completedValidations * 100).toFixed(2)
    validationStats.roi = ((validationStats.correct * 0.91 - validationStats.incorrect) / completedValidations * 100).toFixed(2)
  }

  if (validations.length > 0) {
    validationStats.avgEdge = (totalEdgeVal / validations.length * 100).toFixed(2)
  }

  // Calculate accuracy by prop type
  Object.keys(validationStats.byPropType).forEach(type => {
    const stat = validationStats.byPropType[type]
    const completed = stat.correct + stat.incorrect
    if (completed > 0) {
      stat.accuracy = (stat.correct / completed * 100).toFixed(2)
    }
  })

  // Calculate accuracy by confidence
  Object.keys(validationStats.byConfidence).forEach(conf => {
    const stat = validationStats.byConfidence[conf]
    const completed = stat.correct + stat.incorrect
    if (completed > 0) {
      stat.accuracy = (stat.correct / completed * 100).toFixed(2)
    }
  })

  return { parlayStats, validationStats }
}

function generateStatsCSV(stats, parlays, validations) {
  let csv = ''

  // Sheet 1: Overall Summary
  csv += '=== OVERALL SUMMARY ===\n'
  csv += 'Metric,Value\n'
  csv += `Export Date,${new Date().toISOString()}\n`
  csv += `Total Parlays,${stats.parlayStats.total}\n`
  csv += `Average Odds,${stats.parlayStats.avgOdds.toFixed(2)}\n`
  csv += `Average Edge,${(stats.parlayStats.avgEdge * 100).toFixed(2)}%\n`
  csv += `Average Win Probability,${(stats.parlayStats.avgProbability * 100).toFixed(2)}%\n`
  csv += `Total Predictions,${stats.validationStats.total}\n`
  csv += `Completed Predictions,${stats.validationStats.completed}\n`
  csv += `Accuracy,${stats.validationStats.accuracy}%\n`
  csv += `ROI,${stats.validationStats.roi}%\n`
  csv += `Average Edge,${stats.validationStats.avgEdge}%\n`

  // Sheet 2: Parlay Breakdown (for pie charts)
  csv += '\n=== PARLAYS BY STATUS ===\n'
  csv += 'Status,Count\n'
  Object.entries(stats.parlayStats.byStatus).forEach(([status, count]) => {
    csv += `${status},${count}\n`
  })

  csv += '\n=== PARLAYS BY SPORT ===\n'
  csv += 'Sport,Count\n'
  Object.entries(stats.parlayStats.bySport).forEach(([sport, count]) => {
    csv += `${sport},${count}\n`
  })

  csv += '\n=== PARLAYS BY LEG COUNT ===\n'
  csv += 'Legs,Count\n'
  Object.entries(stats.parlayStats.byLegCount).forEach(([legs, count]) => {
    csv += `${legs},${count}\n`
  })

  // Sheet 3: Validation Breakdown (for bar charts)
  csv += '\n=== ACCURACY BY PROP TYPE ===\n'
  csv += 'Prop Type,Total,Correct,Incorrect,Pushes,Accuracy %\n'
  Object.entries(stats.validationStats.byPropType).forEach(([type, stat]) => {
    csv += `${type},${stat.total},${stat.correct},${stat.incorrect},${stat.pushes},${stat.accuracy}\n`
  })

  csv += '\n=== ACCURACY BY CONFIDENCE ===\n'
  csv += 'Confidence,Total,Correct,Incorrect,Accuracy %\n'
  Object.entries(stats.validationStats.byConfidence).forEach(([conf, stat]) => {
    csv += `${conf},${stat.total},${stat.correct},${stat.incorrect},${stat.accuracy}\n`
  })

  // Sheet 4: Time Series (for line charts)
  csv += '\n=== DAILY PERFORMANCE ===\n'
  csv += 'Date,Parlays Generated,Predictions Made,Correct,Incorrect,Daily Accuracy %\n'
  
  const dailyStats = calculateDailyStats(parlays, validations)
  dailyStats.forEach(day => {
    csv += `${day.date},${day.parlays},${day.predictions},${day.correct},${day.incorrect},${day.accuracy}\n`
  })

  return csv
}

function calculateDailyStats(parlays, validations) {
  const dailyMap = new Map()

  // Group parlays by date
  parlays.forEach(p => {
    const date = new Date(p.createdAt).toISOString().split('T')[0]
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        parlays: 0,
        predictions: 0,
        correct: 0,
        incorrect: 0,
        accuracy: 0
      })
    }
    dailyMap.get(date).parlays++
  })

  // Group validations by date
  validations.forEach(v => {
    const date = new Date(v.timestamp).toISOString().split('T')[0]
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date,
        parlays: 0,
        predictions: 0,
        correct: 0,
        incorrect: 0,
        accuracy: 0
      })
    }
    const day = dailyMap.get(date)
    day.predictions++
    if (v.result === 'correct') day.correct++
    if (v.result === 'incorrect') day.incorrect++
  })

  // Calculate daily accuracy
  dailyMap.forEach(day => {
    const completed = day.correct + day.incorrect
    if (completed > 0) {
      day.accuracy = (day.correct / completed * 100).toFixed(2)
    }
  })

  // Convert to array and sort by date
  return Array.from(dailyMap.values()).sort((a, b) => 
    new Date(a.date) - new Date(b.date)
  )
}





