// API endpoint to save individual player props for validation tracking
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { recordPropPrediction } from '../../../../lib/validation.js'

export async function POST(request) {
  try {
    const { prop } = await request.json()
    
    if (!prop) {
      return NextResponse.json(
        { success: false, error: 'No prop data provided' },
        { status: 400 }
      )
    }
    
    console.log(`💾 Saving individual prop: ${prop.playerName} ${prop.type}`)
    
    // Record the prop prediction with source = 'user_saved'
    const validation = await recordPropPrediction(prop, 'user_saved', null)
    
    if (!validation) {
      return NextResponse.json(
        { success: false, error: 'Failed to record prop prediction' },
        { status: 500 }
      )
    }
    
    console.log(`✅ Saved prop validation: ${validation.id}`)
    
    return NextResponse.json({
      success: true,
      validationId: validation.id,
      message: 'Prop saved successfully'
    })
    
  } catch (error) {
    console.error('❌ Error saving prop:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}





