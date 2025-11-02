export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase.js'

export async function GET() {
  try {
    // Get games by sport
    const { data: mlbGames } = await supabase
      .from('Game')
      .select('id, homeId, awayId, sport')
      .eq('sport', 'mlb')
      .limit(2)
    
    const { data: nflGames } = await supabase
      .from('Game')
      .select('id, homeId, awayId, sport')
      .eq('sport', 'nfl')
      .limit(2)
    
    const { data: nhlGames } = await supabase
      .from('Game')
      .select('id, homeId, awayId, sport')
      .eq('sport', 'nhl')
      .limit(2)
    
    // Get teams by sport
    const { data: mlbTeams } = await supabase
      .from('Team')
      .select('id, name, abbr, sport')
      .eq('sport', 'mlb')
    
    const { data: nflTeams } = await supabase
      .from('Team')
      .select('id, name, abbr, sport')
      .eq('sport', 'nfl')
    
    const { data: nhlTeams } = await supabase
      .from('Team')
      .select('id, name, abbr, sport')
      .eq('sport', 'nhl')
    
    return NextResponse.json({
      success: true,
      MLB: {
        games: mlbGames?.length,
        teams: mlbTeams?.length,
        samples: {
          game: mlbGames?.[0],
          team: mlbTeams?.[0]
        }
      },
      NFL: {
        games: nflGames?.length,
        teams: nflTeams?.length,
        samples: {
          game: nflGames?.[0],
          team: nflTeams?.[0]
        }
      },
      NHL: {
        games: nhlGames?.length,
        teams: nhlTeams?.length,
        samples: {
          game: nhlGames?.[0],
          team: nhlTeams?.[0]
        }
      }
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
