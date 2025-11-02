export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase.js'

export async function GET() {
  try {
    // Get all teams
    const { data: teams, error } = await supabase
      .from('Team')
      .select('id, name, abbr, sport')
    
    if (error) throw error
    
    // Group by sport
    const nflTeams = teams?.filter(t => t.sport === 'nfl') || []
    const mlbTeams = teams?.filter(t => t.sport === 'mlb') || []
    const nhlTeams = teams?.filter(t => t.sport === 'nhl') || []
    
    return NextResponse.json({
      success: true,
      totalTeams: teams?.length,
      nfl: nflTeams.slice(0, 3),
      mlb: mlbTeams.slice(0, 3),
      nhl: nhlTeams.slice(0, 3),
      nflCount: nflTeams.length,
      mlbCount: mlbTeams.length,
      nhlCount: nhlTeams.length
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
