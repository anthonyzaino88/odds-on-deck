// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getValidationStats, getValidationRecords, getAccuracyByEdge, getMostAccuratePropTypes } from '../../../lib/validation.js'
import { clampValidationLimit, parsePublicValidationStatus } from '../../../lib/api-limits.js'

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
      const statusResult = parsePublicValidationStatus(searchParams.get('status'))
      if (!statusResult.ok) {
        return NextResponse.json({ success: false, error: statusResult.error }, { status: 400 })
      }

      // Get validation records. Pending (ungraded / pregame) rows are never
      // served here — excludePending is opt-in on getValidationRecords so the
      // admin update-result path can still load them.
      const options = {
        status: statusResult.status,
        propType: searchParams.get('propType'),
        playerId: searchParams.get('playerId'),
        gameId: searchParams.get('gameId'),
        result: searchParams.get('result'),
        startDate: searchParams.get('startDate'),
        endDate: searchParams.get('endDate'),
        limit: clampValidationLimit(searchParams.get('limit')),
        excludePending: true,
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

// POST removed: anonymous grading used the service-role client and could
// rewrite any PropValidation row. Grading stays on CRON-gated
// /api/validation/update-result and ops scripts.
