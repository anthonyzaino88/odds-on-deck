export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase.js'

export async function GET() {
  try {
    // Get 5 games with their raw times
    const { data: games } = await supabase
      .from('Game')
      .select('id, date, sport, status')
      .limit(5)
    
    // Show raw times and converted times
    const formatted = games?.map(game => {
      const utcDate = new Date(game.date)
      
      return {
        id: game.id,
        sport: game.sport,
        rawDate: game.date,
        utcTime: utcDate.toUTCString(),
        localTime: utcDate.toLocaleString(),
        timestamp: utcDate.getTime(),
        isoString: utcDate.toISOString(),
        // Try different timezone conversions
        est: utcDate.toLocaleString('en-US', { timeZone: 'America/New_York' }),
        cst: utcDate.toLocaleString('en-US', { timeZone: 'America/Chicago' }),
        mst: utcDate.toLocaleString('en-US', { timeZone: 'America/Denver' }),
        pst: utcDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
      }
    })
    
    return NextResponse.json({
      success: true,
      games: formatted,
      serverTimeZone: new Date().toString()
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
