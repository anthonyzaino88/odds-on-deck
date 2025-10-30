// Import validation data into production database
// POST with JSON data from local export

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function POST(request) {
  try {
    const data = await request.json()
    
    if (!Array.isArray(data)) {
      return NextResponse.json({
        success: false,
        error: 'Expected array of prop validations'
      }, { status: 400 })
    }
    
    console.log(`📥 Importing ${data.length} prop validations...`)
    
    let imported = 0
    let skipped = 0
    let errors = 0
    
    for (const prop of data) {
      try {
        await prisma.propValidation.upsert({
          where: { propId: prop.propId },
          update: {
            actualValue: prop.actualValue,
            result: prop.result,
            status: prop.status,
            completedAt: prop.completedAt ? new Date(prop.completedAt) : null,
            notes: prop.notes
          },
          create: {
            id: prop.id,
            propId: prop.propId,
            gameIdRef: prop.gameIdRef,
            playerName: prop.playerName,
            propType: prop.propType,
            threshold: prop.threshold,
            prediction: prop.prediction,
            projectedValue: prop.projectedValue,
            confidence: prop.confidence,
            edge: prop.edge,
            odds: prop.odds,
            probability: prop.probability,
            qualityScore: prop.qualityScore,
            source: prop.source || 'system_generated',
            parlayId: prop.parlayId,
            actualValue: prop.actualValue,
            result: prop.result,
            status: prop.status,
            sport: prop.sport,
            timestamp: new Date(prop.timestamp),
            completedAt: prop.completedAt ? new Date(prop.completedAt) : null,
            notes: prop.notes
          }
        })
        imported++
      } catch (error) {
        if (error.code === 'P2002') {
          skipped++
        } else {
          console.error(`Error importing prop ${prop.propId}:`, error.message)
          errors++
        }
      }
    }
    
    console.log(`✅ Import complete: ${imported} imported, ${skipped} skipped, ${errors} errors`)
    
    return NextResponse.json({
      success: true,
      imported,
      skipped,
      errors,
      total: data.length
    })
    
  } catch (error) {
    console.error('❌ Error importing validation data:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

export async function GET() {
  // Return current validation count
  try {
    const count = await prisma.propValidation.count()
    const completed = await prisma.propValidation.count({ where: { status: 'completed' } })
    const correct = await prisma.propValidation.count({ where: { result: 'correct' } })
    const incorrect = await prisma.propValidation.count({ where: { result: 'incorrect' } })
    
    const accuracy = (completed > 0) ? (correct / completed * 100).toFixed(1) : 0
    
    return NextResponse.json({
      total: count,
      completed,
      correct,
      incorrect,
      accuracy: parseFloat(accuracy)
    })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

