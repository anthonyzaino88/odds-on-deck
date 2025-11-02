export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase.js'

export async function GET() {
  try {
    // Get first game with all data
    const { data: gameRaw, error: gameError } = await supabase
      .from('Game')
      .select('*')
      .limit(1)
    
    if (gameError) throw gameError
    
    const firstGame = gameRaw?.[0]
    
    // Get first team
    const { data: teamRaw, error: teamError } = await supabase
      .from('Team')
      .select('*')
      .limit(1)
    
    if (teamError) throw teamError
    
    const firstTeam = teamRaw?.[0]
    
    return NextResponse.json({
      success: true,
      tables: {
        Game: {
          sampleRecord: firstGame,
          fieldNames: firstGame ? Object.keys(firstGame) : [],
          totalFields: firstGame ? Object.keys(firstGame).length : 0
        },
        Team: {
          sampleRecord: firstTeam,
          fieldNames: firstTeam ? Object.keys(firstTeam) : [],
          totalFields: firstTeam ? Object.keys(firstTeam).length : 0
        }
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
