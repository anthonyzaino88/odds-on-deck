export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase.js'

export async function GET() {
  try {
    // Get a CHI @ CIN game
    const { data: games } = await supabase
      .from('Game')
      .select('id, date, sport')
      .or("id.ilike.%CHI_at_CIN%,id.ilike.%chi_at_cin%")
      .limit(1)
    
    const game = games?.[0]
    
    if (!game) {
      return NextResponse.json({
        success: false,
        error: 'CHI @ CIN game not found'
      })
    }
    
    const rawDate = game.date
    const dateObj = new Date(rawDate)
    
    return NextResponse.json({
      success: true,
      gameId: game.id,
      rawDateFromDB: rawDate,
      dateObjectToString: dateObj.toString(),
      dateObjectToISOString: dateObj.toISOString(),
      conversions: {
        UTC: dateObj.toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: true }),
        EST: dateObj.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true }),
        PST: dateObj.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: true })
      },
      expectedTime: '1:00 PM EST',
      note: 'If EST shows 1:00 PM, times are correct. If EST shows something else, database times are in a different timezone.'
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
