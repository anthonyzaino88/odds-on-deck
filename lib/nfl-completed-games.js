/**
 * Shared NFL completed-game pool for live v1.1.0 snapshots.
 *
 * The morning job loads this once per run. Each game then filters in
 * memory to priors that finished before that game's pick-lock. With no
 * lock quote, cutoff is start minus PICK_LOCK_LEAD_MS. A missing start
 * returns no priors. Zero Odds API credits.
 */

import { PICK_LOCK_LEAD_MS } from './game-line-model-rules.js'
import { pickLockTime } from './game-line-backtest.js'
import {
  NFL_COMPLETED_GAME_STATUSES,
  frozenStartMs,
  gamesAvailableBeforeLock,
} from './nfl-pregame-features.js'

export { NFL_COMPLETED_GAME_STATUSES }

const COMPLETED_NFL_SELECT = `
        id,
        sport,
        season,
        date,
        status,
        week,
        homeScore,
        awayScore,
        lastUpdate,
        homeId,
        awayId,
        home:Team!Game_homeId_fkey(id, abbr),
        away:Team!Game_awayId_fkey(id, abbr)
      `

export function pickCompletedGamesCutoff(game, oddsRows = []) {
  const lock = pickLockTime(game, oddsRows, { market: 'moneyline' })
  if (lock?.lockAt) return lock.lockAt
  const start = frozenStartMs(game)
  if (start == null || !Number.isFinite(start)) return null
  const cutoff = start - PICK_LOCK_LEAD_MS
  if (!Number.isFinite(cutoff)) return null
  return new Date(cutoff).toISOString()
}

export function completedNflGamesForGame(allCompleted, game, oddsRows = []) {
  const cutoff = pickCompletedGamesCutoff(game, oddsRows)
  if (!cutoff) return []
  return gamesAvailableBeforeLock(allCompleted, cutoff)
    .filter((prior) => prior.id !== game.id)
}

export async function loadCompletedNflGames(client) {
  try {
    const { data, error } = await client
      .from('Game')
      .select(COMPLETED_NFL_SELECT)
      .eq('sport', 'nfl')
      .in('status', [...NFL_COMPLETED_GAME_STATUSES])
      .order('date', { ascending: false })
      .limit(400)
    if (error) {
      console.log(`  ℹ️  completedGames skipped: ${error.message}`)
      return []
    }
    return data || []
  } catch (error) {
    console.log(`  ℹ️  completedGames skipped: ${error.message}`)
    return []
  }
}

export async function completedNflGamesForGames(client, games = [], oddsByGameId = {}) {
  const all = await loadCompletedNflGames(client)
  const byId = {}
  for (const game of games) {
    byId[game.id] = completedNflGamesForGame(all, game, oddsByGameId[game.id] || [])
  }
  return { all, byId }
}
