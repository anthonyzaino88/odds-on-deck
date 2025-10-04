// Test player props generation

import { NextResponse } from 'next/server'
import { generatePlayerProps } from '../../../../lib/player-props.js'

export async function GET() {
  try {
    console.log('🎯 Testing player props generation...')
    
    const props = await generatePlayerProps()
    
    // Group props by type
    const mlbProps = props.filter(p => !p.type.includes('passing') && !p.type.includes('rushing') && !p.type.includes('rec'))
    const nflProps = props.filter(p => p.type.includes('passing') || p.type.includes('rushing') || p.type.includes('rec'))
    
    const hitProps = props.filter(p => p.type === 'hits')
    const rbiProps = props.filter(p => p.type === 'rbis') 
    const strikeoutProps = props.filter(p => p.type === 'strikeouts')
    const passingProps = props.filter(p => p.type.includes('passing'))
    const rushingProps = props.filter(p => p.type.includes('rushing'))
    const receivingProps = props.filter(p => p.type.includes('rec'))
    
    return NextResponse.json({
      success: true,
      totalProps: props.length,
      mlbProps: mlbProps.length,
      nflProps: nflProps.length,
      breakdown: {
        hitProps: hitProps.length,
        rbiProps: rbiProps.length,
        strikeoutProps: strikeoutProps.length,
        passingProps: passingProps.length,
        rushingProps: rushingProps.length,
        receivingProps: receivingProps.length
      },
      sampleProps: props.slice(0, 10).map(p => ({
        playerName: p.playerName,
        type: p.type,
        team: p.team,
        opponent: p.opponent,
        edge: p.edge,
        confidence: p.confidence
      })),
      allProps: props
    })
    
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

