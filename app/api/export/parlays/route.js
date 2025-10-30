// Export parlays and validation data to CSV/Excel format

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'csv' // csv or json
    const days = parseInt(searchParams.get('days')) || 90 // last 90 days by default
    const includeValidation = searchParams.get('includeValidation') !== 'false'

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    // Fetch parlays with legs
    const parlays = await prisma.parlay.findMany({
      where: {
        createdAt: { gte: cutoffDate }
      },
      include: {
        legs: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    console.log(`📊 Exporting ${parlays.length} parlays from last ${days} days`)

    // Fetch validation data if requested
    let validations = []
    if (includeValidation) {
      validations = await prisma.propValidation.findMany({
        where: {
          timestamp: { gte: cutoffDate }
        },
        orderBy: {
          timestamp: 'desc'
        }
      })
      console.log(`📊 Including ${validations.length} validation records`)
    }

    if (format === 'json') {
      return NextResponse.json({
        success: true,
        exportDate: new Date().toISOString(),
        dateRange: {
          from: cutoffDate.toISOString(),
          to: new Date().toISOString(),
          days: days
        },
        parlays: parlays,
        validations: validations,
        summary: {
          totalParlays: parlays.length,
          totalValidations: validations.length,
          statusBreakdown: getStatusBreakdown(parlays),
          validationBreakdown: getValidationBreakdown(validations)
        }
      })
    }

    // CSV format
    if (format === 'csv') {
      const csv = generateCSV(parlays, validations)
      
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="parlays_export_${new Date().toISOString().split('T')[0]}.csv"`
        }
      })
    }

    // Excel-compatible CSV with multiple sheets (combined in one file with separators)
    if (format === 'excel') {
      const excelData = generateExcelFormat(parlays, validations)
      
      return new NextResponse(excelData, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="parlays_export_${new Date().toISOString().split('T')[0]}.csv"`
        }
      })
    }

    return NextResponse.json(
      { error: 'Invalid format. Use csv, excel, or json' },
      { status: 400 }
    )

  } catch (error) {
    console.error('❌ Error exporting data:', error)
    return NextResponse.json(
      { error: 'Failed to export data', details: error.message },
      { status: 500 }
    )
  }
}

function getStatusBreakdown(parlays) {
  const breakdown = {
    pending: 0,
    won: 0,
    lost: 0,
    cancelled: 0
  }
  
  parlays.forEach(p => {
    const status = p.status || 'pending'
    breakdown[status] = (breakdown[status] || 0) + 1
  })
  
  return breakdown
}

function getValidationBreakdown(validations) {
  const breakdown = {
    pending: 0,
    completed: 0,
    correct: 0,
    incorrect: 0,
    pushes: 0
  }
  
  validations.forEach(v => {
    breakdown[v.status] = (breakdown[v.status] || 0) + 1
    if (v.result) {
      breakdown[v.result] = (breakdown[v.result] || 0) + 1
    }
  })
  
  return breakdown
}

function generateCSV(parlays, validations) {
  let csv = ''
  
  // Parlay Summary Sheet
  csv += '=== PARLAY SUMMARY ===\n'
  csv += 'ID,Date,Sport,Type,Legs,Odds,Probability,Edge,Expected Value,Confidence,Status,Outcome\n'
  
  parlays.forEach(p => {
    csv += [
      p.id,
      new Date(p.createdAt).toISOString(),
      p.sport,
      p.type,
      p.legCount,
      p.totalOdds,
      p.probability,
      p.edge,
      p.expectedValue,
      p.confidence,
      p.status,
      p.outcome || 'pending'
    ].join(',') + '\n'
  })
  
  // Parlay Legs Sheet
  csv += '\n=== PARLAY LEGS ===\n'
  csv += 'Parlay ID,Parlay Date,Leg Order,Game ID,Bet Type,Player Name,Prop Type,Threshold,Selection,Odds,Probability,Edge,Confidence,Outcome\n'
  
  parlays.forEach(p => {
    p.legs.forEach(leg => {
      csv += [
        p.id,
        new Date(p.createdAt).toISOString(),
        leg.legOrder,
        leg.gameIdRef,
        leg.betType,
        leg.playerName || '',
        leg.propType || '',
        leg.threshold || '',
        leg.selection,
        leg.odds,
        leg.probability,
        leg.edge,
        leg.confidence,
        leg.outcome || 'pending'
      ].join(',') + '\n'
    })
  })
  
  // Validation Data Sheet
  if (validations.length > 0) {
    csv += '\n=== VALIDATION DATA ===\n'
    csv += 'Prop ID,Date,Player Name,Sport,Game ID,Prop Type,Threshold,Prediction,Projected Value,Confidence,Edge,Odds,Probability,Quality Score,Status,Actual Value,Result,Source,Parlay ID\n'
    
    validations.forEach(v => {
      csv += [
        v.propId,
        new Date(v.timestamp).toISOString(),
        v.playerName,
        v.sport || 'N/A',
        v.gameIdRef,
        v.propType,
        v.threshold,
        v.prediction,
        v.projectedValue,
        v.confidence,
        v.edge,
        v.odds || '',
        v.probability || '',
        v.qualityScore || '',
        v.status,
        v.actualValue || '',
        v.result || 'pending',
        v.source,
        v.parlayId || ''
      ].join(',') + '\n'
    })
  }
  
  return csv
}

function generateExcelFormat(parlays, validations) {
  let output = ''
  
  // Summary Statistics (for pivot tables/charts)
  output += '=== SUMMARY STATISTICS ===\n'
  output += 'Metric,Value\n'
  output += `Total Parlays,${parlays.length}\n`
  output += `Date Range,${new Date().toISOString()}\n`
  
  const statusBreakdown = getStatusBreakdown(parlays)
  output += `Pending Parlays,${statusBreakdown.pending || 0}\n`
  output += `Won Parlays,${statusBreakdown.won || 0}\n`
  output += `Lost Parlays,${statusBreakdown.lost || 0}\n`
  
  if (validations.length > 0) {
    const validationBreakdown = getValidationBreakdown(validations)
    const completed = validationBreakdown.correct + validationBreakdown.incorrect
    const accuracy = completed > 0 ? (validationBreakdown.correct / completed * 100).toFixed(1) : 0
    
    output += `Total Predictions,${validations.length}\n`
    output += `Completed Predictions,${completed}\n`
    output += `Correct Predictions,${validationBreakdown.correct || 0}\n`
    output += `Incorrect Predictions,${validationBreakdown.incorrect || 0}\n`
    output += `Accuracy %,${accuracy}\n`
  }
  
  // Add the detailed data
  output += '\n' + generateCSV(parlays, validations)
  
  return output
}





