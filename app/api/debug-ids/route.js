export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase.js'

export async function GET() {
  try {
    // Get sample games
    const { data: games } = await supabase
      .from('Game')
      .select('id, homeId, awayId, sport')
      .limit(3)
    
    // Get sample teams
    const { data: teams } = await supabase
      .from('Team')
      .select('id, name, abbr, sport')
      .limit(5)
    
    return NextResponse.json({
      success: true,
      gameIds: {
        count: games?.length,
        samples: games?.map(g => ({
          gameId: g.id,
          homeId: g.homeId,
          awayId: g.awayId,
          sport: g.sport
        }))
      },
      teamIds: {
        count: teams?.length,
        samples: teams?.map(t => ({
          teamId: t.id,
          name: t.name,
          abbr: t.abbr,
          sport: t.sport
        }))
      },
      match: {
        firstGameHomeId: games?.[0]?.homeId,
        doesItExistInTeams: teams?.some(t => t.id === games?.[0]?.homeId) ? 'YES ✅' : 'NO ❌'
      }
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
