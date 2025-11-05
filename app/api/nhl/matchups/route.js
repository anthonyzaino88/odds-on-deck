// NHL Matchup Analysis API

export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { analyzeNHLMatchup } from '../../../../lib/nhl-matchups.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const gameId = searchParams.get('gameId')
    
    if (!gameId) {
      return NextResponse.json({ error: 'gameId required' }, { status: 400 })
    }
    
    console.log(`🏒 Analyzing NHL matchup for game: ${gameId}`)
    
    const matchupAnalysis = await analyzeNHLMatchup(gameId)
    
    if (!matchupAnalysis) {
      return NextResponse.json(
        { error: 'Game not found or matchup analysis failed' },
        { status: 404 }
      )
    }
    
    // Debug: Log the structure being returned
    console.log('📊 Matchup analysis structure:', {
      hasGame: !!matchupAnalysis.game,
      hasAdvantages: !!matchupAnalysis.advantages,
      homeAdvantages: matchupAnalysis.advantages?.home,
      awayAdvantages: matchupAnalysis.advantages?.away,
      homeGamesAnalyzed: matchupAnalysis.advantages?.home?.gamesAnalyzed,
      awayGamesAnalyzed: matchupAnalysis.advantages?.away?.gamesAnalyzed
    })
    
    return NextResponse.json(matchupAnalysis)
    
  } catch (error) {
    console.error('Error in NHL matchup API:', error)
    return NextResponse.json(
      { error: 'Failed to analyze matchup' },
      { status: 500 }
    )
  }
}


