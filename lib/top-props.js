// Shared PlayerPropCache query for sport hubs (and any SSR desk).
// Same live-window rules as app/api/props/route.js: non-stale, unexpired,
// future gameTime. Ordered by qualityScore desc for a short "top props" list.

import { supabase } from './supabase.js'

const MIN_DECIMAL_ODDS = 1.25
const MAX_DECIMAL_ODDS = 15.0
const VALID_SPORTS = new Set(['mlb', 'nfl', 'nhl'])

/**
 * @param {string} sport - 'mlb' | 'nfl' | 'nhl'
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function getTopProps(sport, { limit = 10 } = {}) {
  if (!supabase || !VALID_SPORTS.has(sport)) return []

  const now = new Date().toISOString()
  const fetchLimit = Math.min(Math.max(limit * 2, limit), 40)

  const { data, error } = await supabase
    .from('PlayerPropCache')
    .select('propId, gameId, playerName, team, type, pick, threshold, odds, qualityScore, sport, bookmaker, gameTime')
    .eq('sport', sport)
    .eq('isStale', false)
    .gte('expiresAt', now)
    .gt('gameTime', now)
    .order('qualityScore', { ascending: false })
    .limit(fetchLimit)

  if (error || !data) return []

  return data
    .filter((prop) => {
      if (prop.odds == null) return true
      return prop.odds >= MIN_DECIMAL_ODDS && prop.odds <= MAX_DECIMAL_ODDS
    })
    .slice(0, limit)
    .map((prop) => ({
      propId: prop.propId,
      gameId: prop.gameId,
      playerName: prop.playerName,
      team: prop.team,
      type: prop.type,
      pick: prop.pick,
      threshold: prop.threshold,
      odds: prop.odds,
      qualityScore: prop.qualityScore || 0,
      sport: prop.sport,
      bookmaker: prop.bookmaker,
      gameTime: prop.gameTime,
    }))
}
