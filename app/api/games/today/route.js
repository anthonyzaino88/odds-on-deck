import { sanitizedErrorMessage, sanitizeLoggedValue } from '../../../../lib/sanitize-error.js'
// Simple API endpoint to get today's games
// Using Supabase client instead of Prisma (no build-time dependency!)

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { getTodaysGames } from '../../../../lib/todays-games.js'

export async function GET() {
  try {
    console.log('📅 API: Fetching today\'s games...')
    const result = await getTodaysGames()

    if (!result.success) {
      const safeError = sanitizeLoggedValue(result.error)
      console.error('❌ Database error:', safeError)
      return NextResponse.json({ ...result, error: safeError }, { status: 500 })
    }

    console.log(`📊 Games: MLB=${result.data.mlb.length}, NFL=${result.data.nfl.length} (week), NHL=${result.data.nhl.length}`)
    return NextResponse.json(result)
  } catch (error) {
    console.error('❌ API Error:', sanitizedErrorMessage(error))
    const isSupabaseError = error.message?.includes('Supabase') || error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED')
    const userMessage = isSupabaseError
      ? 'Database connection failed. Your Supabase project may be paused — check https://supabase.com/dashboard'
      : sanitizedErrorMessage(error)
    return NextResponse.json({ success: false, error: userMessage }, { status: 500 })
  }
}