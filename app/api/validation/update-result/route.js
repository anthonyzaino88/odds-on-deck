// API endpoint to manually update prop results after games complete
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { updatePropResult } from '../../../../lib/validation.js'

/**
 * POST /api/validation/update-result
 * 
 * Update a prop prediction with the actual result
 * 
 * Body:
 * {
 *   "propId": "SEA_at_DET_2025-10-08-12345-strikeouts",
 *   "actualValue": 7
 * }
 */
export async function POST(request) {
  try {
    const { propId, actualValue } = await request.json()
    
    if (!propId) {
      return NextResponse.json(
        { success: false, message: 'propId is required' },
        { status: 400 }
      )
    }
    
    if (actualValue === null || actualValue === undefined) {
      return NextResponse.json(
        { success: false, message: 'actualValue is required' },
        { status: 400 }
      )
    }
    
    const updated = await updatePropResult(propId, actualValue)
    
    if (!updated) {
      return NextResponse.json(
        { success: false, message: 'Prop prediction not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({
      success: true,
      message: 'Result updated successfully',
      data: updated
    })
    
  } catch (error) {
    console.error('Error updating prop result:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to update result', error: error.message },
      { status: 500 }
    )
  }
}

/**
 * GET /api/validation/update-result?gameId=SEA_at_DET_2025-10-08
 * 
 * Get all pending props for a specific game (to help with manual entry)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const gameId = searchParams.get('gameId')
    
    if (!gameId) {
      return NextResponse.json(
        { success: false, message: 'gameId query parameter is required' },
        { status: 400 }
      )
    }
    
    const { getValidationRecords } = await import('../../../../lib/validation.js')
    const props = await getValidationRecords({ gameId, status: 'pending' })
    
    return NextResponse.json({
      success: true,
      count: props.length,
      props: props.map(p => ({
        propId: p.propId,
        playerName: p.playerName,
        propType: p.propType,
        prediction: p.prediction,
        threshold: p.threshold,
        projectedValue: p.projectedValue,
        confidence: p.confidence,
        edge: p.edge
      }))
    })
    
  } catch (error) {
    console.error('Error fetching pending props:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to fetch props', error: error.message },
      { status: 500 }
    )
  }
}

