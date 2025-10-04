// NFL Matchup Analysis API

import { NextResponse } from 'next/server'
import { 
  analyzeGameMatchup, 
  getMatchupHistory,
  getDefensiveRankings 
} from '../../../../lib/nfl-matchups.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const gameId = searchParams.get('gameId')
    const action = searchParams.get('action')
    
    if (action === 'defensive-rankings') {
      const rankings = await getDefensiveRankings()
      return NextResponse.json({ rankings })
    }
    
    if (!gameId) {
      return NextResponse.json({ error: 'gameId required' }, { status: 400 })
    }
    
    console.log(`🏈 Analyzing matchup for game: ${gameId}`)
    
    const matchupAnalysis = await analyzeGameMatchup(gameId)
    
    if (!matchupAnalysis) {
      return NextResponse.json(
        { error: 'Game not found or matchup analysis failed' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(matchupAnalysis)
    
  } catch (error) {
    console.error('Error in NFL matchup API:', error)
    return NextResponse.json(
      { error: 'Failed to analyze matchup' },
      { status: 500 }
    )
  }
}
