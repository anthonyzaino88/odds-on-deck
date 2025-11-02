export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase.js'

export async function GET() {
  try {
    // Get first 2 games with team data
    const { data: games, error } = await supabase
      .from('Game')
      .select(`
        *,
        home:homeId (id, name, abbr, sport),
        away:awayId (id, name, abbr, sport)
      `)
      .limit(2)
    
    if (error) throw error
    
    return NextResponse.json({
      success: true,
      gameCount: games?.length,
      games: games,
      firstGame: games?.[0],
      fieldCheck: {
        hasHome: !!games?.[0]?.home,
        hasAway: !!games?.[0]?.away,
        homeAbbr: games?.[0]?.home?.abbr,
        awayAbbr: games?.[0]?.away?.abbr
      }
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
