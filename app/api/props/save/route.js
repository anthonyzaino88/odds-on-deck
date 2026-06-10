// API endpoint to save individual player props for validation tracking
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { recordPropPrediction } from '../../../../lib/validation.js'
import { rateLimit, rateLimited, badRequest, serverError } from '../../../../lib/api-security.js'

export async function POST(request) {
  const limit = rateLimit(request, { key: 'props-save', limit: 30, windowMs: 60_000 })
  if (!limit.allowed) return rateLimited(limit.retryAfter)
  try {
    const body = await request.json().catch(() => ({}))
    const { prop } = body

    if (!prop || typeof prop !== 'object') {
      return badRequest('No prop data provided')
    }
    if (!prop.playerName || !prop.gameId || !prop.type) {
      return badRequest('Missing required prop fields')
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
    return serverError()
  }
}





