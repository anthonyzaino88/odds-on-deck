// Validate completed mock props
// Checks game results against predictions

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { validateCompletedMockProps } from '../../../../lib/mock-prop-generator.js'

export async function POST(request) {
  try {
    console.log('🔍 Validating completed mock props...')
    
    // Check for force parameter
    let body = {}
    try {
      body = await request.json()
    } catch (e) {
      // No body provided, that's ok
    }
    
    const result = await validateCompletedMockProps(body.force)
    
    return NextResponse.json({
      success: true,
      ...result,
      message: `Validated ${result.validated} mock props`
    })
  } catch (error) {
    console.error('❌ Error validating mock props:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

export async function GET(request) {
  return NextResponse.json({
    message: 'Use POST to validate mock props'
  })
}

