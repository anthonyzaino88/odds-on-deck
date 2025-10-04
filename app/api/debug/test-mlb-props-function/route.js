// Test getMLBPropsFromDatabase function directly

import { NextResponse } from 'next/server'
import { getMLBPropsFromDatabase } from '../../../../lib/player-props.js'

export async function GET() {
  try {
    console.log('🎯 Testing getMLBPropsFromDatabase function...')
    
    const mlbProps = await getMLBPropsFromDatabase()
    
    return NextResponse.json({
      success: true,
      mlbPropsCount: mlbProps.length,
      mlbProps: mlbProps.map(p => ({
        playerName: p.playerName,
        type: p.type,
        team: p.team,
        opponent: p.opponent,
        edge: p.edge,
        confidence: p.confidence
      })),
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

