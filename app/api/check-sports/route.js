export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase.js'

export async function GET() {
  try {
    const { data: games } = await supabase
      .from('Game')
      .select('id, sport, date')
    
    const counts = {
      total: games?.length || 0,
      nfl: games?.filter(g => g.sport === 'nfl').length || 0,
      nhl: games?.filter(g => g.sport === 'nhl').length || 0,
      mlb: games?.filter(g => g.sport === 'mlb').length || 0,
      other: games?.filter(g => !['nfl', 'nhl', 'mlb'].includes(g.sport)).length || 0
    }
    
    // Show sample of each sport
    const nflSample = games?.find(g => g.sport === 'nfl')
    const nhlSample = games?.find(g => g.sport === 'nhl')
    
    return NextResponse.json({
      success: true,
      counts: counts,
      samples: {
        nflGame: nflSample,
        nhlGame: nhlSample
      }
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
