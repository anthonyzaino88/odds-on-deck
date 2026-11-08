import { sanitizedErrorMessage, sanitizeLoggedValue } from '../../../lib/sanitize-error.js'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { canRefresh, API_CONFIG } from '../../../lib/api-usage-manager'
import { supabase } from '../../../lib/supabase.js'
import { isUsableSupabase } from '../../../lib/supabase-admin.js'
import { parseStoredGameDate } from '../../../lib/score-updater.js'
import { isMissingLineShopQuoteColumnError } from '../../../lib/line-shopping.js'
import { NextResponse } from 'next/server'

/** After PGRST204 / 42703 on quoteUpdatedAt, later polls select fetchedAt only. */
let quoteUpdatedAtColumnMissing = false

export function resetQuoteFreshnessColumnCache() {
  quoteUpdatedAtColumnMissing = false
}

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

function isoFromStamp(value) {
  if (!value) return null
  const parsed = parseStoredGameDate(value)
  if (parsed) return parsed.toISOString()
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function playerPropCacheFreshnessQuery(client, columns) {
  return client
    .from('PlayerPropCache')
    .select(columns)
    .not('fetchedAt', 'is', null)
    .order('fetchedAt', { ascending: false })
    .limit(1)
    .maybeSingle()
}

/**
 * One PlayerPropCache poll: prefer quoteUpdatedAt (book last_update), else
 * fetchedAt (morning fetch). Missing SQL 010 degrades to fetchedAt after
 * one retry; other errors are logged and do not fall through to Game.
 */
export async function getLatestOddsFreshness(client = supabase) {
  const empty = { lastRefreshTime: null, quoteUpdatedAt: null, freshnessSource: null }
  if (!isUsableSupabase(client)) return empty

  const columns = quoteUpdatedAtColumnMissing ? 'fetchedAt' : 'quoteUpdatedAt, fetchedAt'
  const { data, error } = await playerPropCacheFreshnessQuery(client, columns)

  if (error) {
    if (!quoteUpdatedAtColumnMissing && isMissingLineShopQuoteColumnError(error)) {
      quoteUpdatedAtColumnMissing = true
      return getLatestOddsFreshness(client)
    }
    console.error('getLatestOddsFreshness:', sanitizeLoggedValue(error))
    return empty
  }

  const quoteUpdatedAt = isoFromStamp(data?.quoteUpdatedAt)
  const fetchedAt = isoFromStamp(data?.fetchedAt)
  if (quoteUpdatedAt) {
    return { lastRefreshTime: quoteUpdatedAt, quoteUpdatedAt, freshnessSource: 'quotes' }
  }
  if (fetchedAt) {
    return { lastRefreshTime: fetchedAt, quoteUpdatedAt: null, freshnessSource: 'cache' }
  }
  return empty
}

/**
 * Newest PlayerPropCache.quoteUpdatedAt. Missing SQL 010 → null.
 * Other PostgREST errors are logged and return null.
 */
export async function getLatestQuoteUpdatedAt(client = supabase) {
  const freshness = await getLatestOddsFreshness(client)
  return freshness.quoteUpdatedAt
}

/**
 * API endpoint to check if a refresh is allowed based on cooldown.
 * lastRefreshTime is the morning odds as-of time (quote, else cache fetch).
 */
export async function GET() {
  try {
    const status = canRefresh()
    const freshness = await getLatestOddsFreshness()

    return NextResponse.json({
      ...status,
      lastRefreshTime: freshness.lastRefreshTime,
      quoteUpdatedAt: freshness.quoteUpdatedAt,
      freshnessSource: freshness.freshnessSource,
      cooldownMinutes: API_CONFIG.REFRESH_COOLDOWN_MINUTES
    })
  } catch (error) {
    console.error('Error checking refresh status:', sanitizeLoggedValue(error))
    return NextResponse.json(
      { error: 'Failed to check refresh status', message: sanitizedErrorMessage(error) },
      { status: 500 }
    )
  }
}
