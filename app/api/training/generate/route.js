// Generate mock props for training mode
// Uses free APIs to create props for validation

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { generateAllMockProps } from '../../../../lib/mock-prop-generator.js'

export async function POST(request) {
  try {
    console.log('🧪 Generating mock props for training...')
    
    const result = await generateAllMockProps()
    
    return NextResponse.json({
      success: true,
      ...result,
      message: `Generated ${result.generated} mock props for ${result.games} games`
    })
  } catch (error) {
    console.error('❌ Error generating mock props:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

export async function GET(request) {
  return NextResponse.json({
    message: 'Use POST to generate mock props'
  })
}

