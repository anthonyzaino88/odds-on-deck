// Editor's Picks API - Fetch recommended picks
import { NextResponse } from 'next/server'
import { generateEditorPicks } from '../../../lib/picks.js'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode') || 'safe'
    
    // Validate mode
    const validModes = ['safe', 'balanced', 'value', 'all']
    const filterMode = validModes.includes(mode) ? mode : 'safe'
    
    // Generate picks with the selected filter mode
    const picks = await generateEditorPicks(filterMode)
    
    return NextResponse.json({
      success: true,
      picks,
      count: picks.length,
      mode: filterMode
    })
    
  } catch (error) {
    console.error('Error in picks API:', error)
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to generate picks', 
        details: error.message 
      },
      { status: 500 }
    )
  }
}

