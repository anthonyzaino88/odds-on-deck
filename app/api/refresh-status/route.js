export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { canRefresh, API_CONFIG } from '../../../lib/api-usage-manager'
import { supabase } from '../../../lib/supabase.js'
import { isUsableSupabase } from '../../../lib/supabase-admin.js'
import { parseStoredGameDate } from '../../../lib/score-updater.js'
import { NextResponse } from 'next/server'

/**
 * Most recent Game.lastUpdate. In-memory LAST_REFRESH_TIME is per
 * serverless instance and resets on every cold start, so it is meaningless
 * on Vercel. Game.lastUpdate is written by the live score path and is a
 * real persisted "data was updated" timestamp.
 */
export async function getLatestGameLastUpdate(client = supabase) {
  if (!isUsableSupabase(client)) return null

  const { data, error } = await client
    .from('Game')
    .select('lastUpdate')
    .not('lastUpdate', 'is', null)
    .order('lastUpdate', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data?.lastUpdate) return null
  // Game.lastUpdate is timestamp without time zone, stored as UTC.
  // Return a Z-suffixed ISO string so browsers do not parse it as local.
  return parseStoredGameDate(data.lastUpdate)?.toISOString() ?? null
}

/**
 * API endpoint to check if a refresh is allowed based on cooldown.
 * lastRefreshTime is derived from the DB, not the in-memory cooldown clock.
 */
export async function GET() {
  try {
    const status = canRefresh()
    const lastRefreshTime = await getLatestGameLastUpdate()

    return NextResponse.json({
      ...status,
      lastRefreshTime,
      cooldownMinutes: API_CONFIG.REFRESH_COOLDOWN_MINUTES
    })
  } catch (error) {
    console.error('Error checking refresh status:', error)
    return NextResponse.json(
      { error: 'Failed to check refresh status', message: error.message },
      { status: 500 }
    )
  }
}
