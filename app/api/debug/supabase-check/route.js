// Debug endpoint to check Supabase connection and environment variables on Vercel
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase.js'

export async function GET() {
  try {
    // Check environment variables
    const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL
    const hasKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    // Try to query Supabase
    const { data: games, error } = await supabase
      .from('Game')
      .select('id, sport, date, status, homeScore, awayScore')
      .eq('sport', 'nhl')
      .limit(20)
    
    // Get today's date for filtering
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // Query today's games
    const { data: todayGames, error: todayError } = await supabase
      .from('Game')
      .select('id, sport, date, status, homeScore, awayScore')
      .eq('sport', 'nhl')
      .gte('date', today.toISOString())
      .lt('date', tomorrow.toISOString())
    
    return NextResponse.json({
      env: {
        hasSupabaseUrl: hasUrl,
        hasSupabaseKey: hasKey,
        urlPrefix: hasUrl ? process.env.NEXT_PUBLIC_SUPABASE_URL.substring(0, 30) + '...' : 'NOT SET',
        keyPrefix: hasKey ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.substring(0, 20) + '...' : 'NOT SET'
      },
      connection: {
        success: !error,
        error: error?.message || null,
        allNhlGames: games?.length || 0,
        todayNhlGames: todayGames?.length || 0
      },
      dateInfo: {
        now: now.toISOString(),
        today: today.toISOString(),
        tomorrow: tomorrow.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      sampleGames: games?.slice(0, 5).map(g => ({
        id: g.id,
        date: g.date,
        status: g.status,
        hasScore: !!(g.homeScore !== null || g.awayScore !== null)
      })) || []
    })
  } catch (error) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack,
      env: {
        hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasSupabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      }
    }, { status: 500 })
  }
}

