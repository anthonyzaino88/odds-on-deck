export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { canRefresh, API_CONFIG } from '../../../lib/api-usage-manager'
import { supabase } from '../../../lib/supabase.js'
import { isUsableSupabase } from '../../../lib/supabase-admin.js'
import { parseStoredGameDate } from '../../../lib/score-updater.js'
import { isMissingLineShopQuoteColumnError } from '../../../lib/line-shopping.js'
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
 * Newest PlayerPropCache.quoteUpdatedAt. Prefers book last_update age
 * over live-score Game.lastUpdate. Missing SQL 010 → null (caller falls
 * back to Game.lastUpdate).
 */
export async function getLatestQuoteUpdatedAt(client = supabase) {
  if (!isUsableSupabase(client)) return null

  const { data, error } = await client
    .from('PlayerPropCache')
    .select('quoteUpdatedAt')
    .not('quoteUpdatedAt', 'is', null)
    .order('quoteUpdatedAt', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (isMissingLineShopQuoteColumnError(error)) return null
    return null
  }
  if (!data?.quoteUpdatedAt) return null
  const parsed = parseStoredGameDate(data.quoteUpdatedAt)
  if (parsed) return parsed.toISOString()
  const ms = Date.parse(data.quoteUpdatedAt)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * API endpoint to check if a refresh is allowed based on cooldown.
 * lastRefreshTime prefers quote age, then Game.lastUpdate.
 */
export async function GET() {
  try {
    const status = canRefresh()
    const quoteUpdatedAt = await getLatestQuoteUpdatedAt()
    const gameUpdatedAt = quoteUpdatedAt ? null : await getLatestGameLastUpdate()
    const lastRefreshTime = quoteUpdatedAt || gameUpdatedAt

    return NextResponse.json({
      ...status,
      lastRefreshTime,
      quoteUpdatedAt,
      freshnessSource: quoteUpdatedAt ? 'quotes' : (gameUpdatedAt ? 'game' : null),
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
