import { NextResponse } from 'next/server'
import { getValidationStats, getValidationRecords, getAccuracyByEdge, getMostAccuratePropTypes, updatePropResult } from '../../../lib/validation.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'stats'
    
    let data = {}
    
    if (type === 'stats') {
      // Get validation statistics
      const options = {
        propType: searchParams.get('propType'),
        playerId: searchParams.get('playerId'),
        gameId: searchParams.get('gameId'),
        confidence: searchParams.get('confidence'),
        startDate: searchParams.get('startDate'),
        endDate: searchParams.get('endDate')
      }
      
      data = await getValidationStats(options)
    } else if (type === 'records') {
      // Get validation records
      const options = {
        status: searchParams.get('status'),
        propType: searchParams.get('propType'),
        playerId: searchParams.get('playerId'),
        gameId: searchParams.get('gameId'),
        result: searchParams.get('result'),
        startDate: searchParams.get('startDate'),
        endDate: searchParams.get('endDate'),
        limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')) : 100
      }
      
      data = await getValidationRecords(options)
    } else if (type === 'accuracy-by-edge') {
      // Get accuracy by edge
      data = await getAccuracyByEdge()
    } else if (type === 'most-accurate') {
      // Get most accurate prop types
      const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')) : 5
      data = await getMostAccuratePropTypes(limit)
    }
    
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Error in validation API:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    
    if (!body.propId || !body.actualValue) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: propId and actualValue' },
        { status: 400 }
      )
    }
    
    const result = await updatePropResult(body.propId, body.actualValue)
    
    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Failed to update prop result' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('Error updating prop result:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
