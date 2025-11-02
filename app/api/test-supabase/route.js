export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase.js'

export async function GET() {
  try {
    console.log('🧪 Testing Supabase...')
    
    // Get one game
    const { data: game } = await supabase
      .from('Game')
      .select('id, homeId, awayId, sport')
      .limit(1)
    
    // Get all teams
    const { data: teams } = await supabase
      .from('Team')
      .select('id, name, abbr, sport')
    
    const firstGame = game?.[0]
    const homeTeam = teams?.find(t => t.id === firstGame?.homeId)
    const awayTeam = teams?.find(t => t.id === firstGame?.awayId)
    
    console.log('Game homeId:', firstGame?.homeId)
    console.log('Home team found:', homeTeam ? 'YES' : 'NO')
    console.log('Sample teams:', teams?.slice(0, 3))
    
    return NextResponse.json({
      success: true,
      game: firstGame,
      homeTeamFound: !!homeTeam,
      awayTeamFound: !!awayTeam,
      homeTeam: homeTeam,
      awayTeam: awayTeam,
      sampleTeams: teams?.slice(0, 5),
      totalTeams: teams?.length,
      idMismatch: {
        gameHomeId: firstGame?.homeId,
        teamIds: teams?.slice(0, 5).map(t => t.id),
        match: homeTeam ? 'FOUND' : 'NOT FOUND'
      }
    })
  } catch (error) {
    console.error('❌ Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
