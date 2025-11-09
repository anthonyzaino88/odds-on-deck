// Editor's Picks API - Fetch recommended picks with insights
import { NextResponse } from 'next/server'
import { generateEditorPicks } from '../../../lib/picks.js'
import { generateQuickInsight } from '../../../lib/pick-insights.js'
import { supabase } from '../../../lib/supabase.js'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode') || 'safe'
    const includeInsights = searchParams.get('insights') !== 'false' // Default to true
    
    // Validate mode
    const validModes = ['safe', 'balanced', 'value', 'all']
    const filterMode = validModes.includes(mode) ? mode : 'safe'
    
    // Generate picks with the selected filter mode
    const picks = await generateEditorPicks(filterMode)
    
    // Add quick insights to each pick
    if (includeInsights && picks.length > 0) {
      // Fetch game data for picks that need it
      const gameIds = [...new Set(picks.map(p => p.gameId).filter(Boolean))]
      
      if (gameIds.length > 0) {
        const { data: games } = await supabase
          .from('Game')
          .select(`
            id,
            sport,
            home:Team!Game_homeId_fkey(
              abbr, last10Record, homeRecord, awayRecord,
              avgPointsLast10, avgPointsAllowedLast10
            ),
            away:Team!Game_awayId_fkey(
              abbr, last10Record, homeRecord, awayRecord,
              avgPointsLast10, avgPointsAllowedLast10
            )
          `)
          .in('id', gameIds)
        
        const gamesMap = {}
        if (games) {
          games.forEach(g => { gamesMap[g.id] = g })
        }
        
        // Add quick insights to each pick
        picks.forEach(pick => {
          const game = gamesMap[pick.gameId]
          if (game) {
            pick.quickInsight = generateQuickInsight(pick, game)
          }
        })
      }
    }
    
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

