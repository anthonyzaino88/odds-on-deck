import { canRefresh, API_CONFIG } from '../../../lib/api-usage-manager'
import { NextResponse } from 'next/server'

/**
 * API endpoint to check if a refresh is allowed based on cooldown
 */
export async function GET() {
  try {
    // Check if refresh is allowed
    const status = canRefresh()
    
    return NextResponse.json({
      ...status,
      lastRefreshTime: API_CONFIG.LAST_REFRESH_TIME,
      cooldownMinutes: API_CONFIG.REFRESH_COOLDOWN_MINUTES
    })
  } catch (error) {
    console.error('Error checking refresh status:', error)
    return NextResponse.json(
      { error: 'Failed to check refresh status', message: error.message },
      { status: 500 }
    )
  }
}
