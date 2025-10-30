/**
 * Games Repository
 * 
 * Handles all database operations for games.
 * Centralizes game queries and prevents scattered Prisma calls.
 */

import { BaseRepository } from './base.repository.js'

export class GamesRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'game')
  }

  /**
   * Get today's games for a specific sport
   */
  async getTodaysGames(sport, options = {}) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(6, 0, 0, 0) // Include late-night games
    
    return await this.findMany({
      date: { gte: today, lt: tomorrow },
      sport
    }, {
      include: {
        home: true,
        away: true,
        odds: {
          orderBy: { ts: 'desc' },
          take: 1
        },
        edges: {
          orderBy: { ts: 'desc' },
          take: 1
        },
        ...options.include
      },
      orderBy: { date: 'asc' }
    })
  }

  /**
   * Get MLB games with additional data (lineups, pitchers)
   */
  async getTodaysMLBGames() {
    return await this.getTodaysGames('mlb', {
      include: {
        lineups: {
          include: { player: true },
          orderBy: [{ team: 'asc' }, { battingOrder: 'asc' }]
        },
        probableHomePitcher: true,
        probableAwayPitcher: true
      }
    })
  }

  /**
   * Get this week's NFL games
   */
  async getThisWeeksNFLGames() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() - today.getDay())
    
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 7)
    
    return await this.findMany({
      date: { gte: weekStart, lt: weekEnd },
      sport: 'nfl'
    }, {
      include: {
        home: true,
        away: true,
        nflData: true,
        odds: {
          orderBy: { ts: 'desc' },
          take: 1
        },
        edges: {
          orderBy: { ts: 'desc' },
          take: 1
        }
      },
      orderBy: { date: 'asc' }
    })
  }

  /**
   * Get today's NHL games
   */
  async getTodaysNHLGames() {
    return await this.getTodaysGames('nhl')
  }

  /**
   * Get games by status
   */
  async getGamesByStatus(sport, statuses) {
    return await this.findMany({
      sport,
      status: { in: statuses }
    }, {
      include: {
        home: true,
        away: true
      }
    })
  }

  /**
   * Get games in progress
   */
  async getLiveGames(sport = null) {
    const where = {
      status: { in: ['in_progress', 'live'] }
    }
    
    if (sport) {
      where.sport = sport
    }
    
    return await this.findMany(where, {
      include: {
        home: true,
        away: true
      }
    })
  }

  /**
   * Get upcoming games (next 24 hours)
   */
  async getUpcomingGames(sport = null) {
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    const where = {
      date: { gte: now, lt: tomorrow },
      status: { in: ['scheduled', 'pre-game', 'pre_game'] }
    }
    
    if (sport) {
      where.sport = sport
    }
    
    return await this.findMany(where, {
      include: {
        home: true,
        away: true,
        odds: {
          orderBy: { ts: 'desc' },
          take: 1
        }
      },
      orderBy: { date: 'asc' }
    })
  }

  /**
   * Upsert a game (create or update)
   */
  async upsertGame(gameData) {
    return await this.upsert(
      { id: gameData.id },
      {
        date: gameData.date,
        status: gameData.status,
        homeScore: gameData.homeScore,
        awayScore: gameData.awayScore,
        // Update other mutable fields
      },
      gameData // Full data for create
    )
  }

  /**
   * Update game score
   */
  async updateScore(gameId, homeScore, awayScore) {
    return await this.update(gameId, {
      homeScore,
      awayScore
    })
  }

  /**
   * Update game status
   */
  async updateStatus(gameId, status) {
    return await this.update(gameId, { status })
  }

  /**
   * Batch upsert games (for schedule refresh)
   */
  async batchUpsertGames(games) {
    const operations = games.map(game => 
      this.model.upsert({
        where: { id: game.id },
        update: {
          date: game.date,
          status: game.status,
          homeScore: game.homeScore,
          awayScore: game.awayScore
        },
        create: game
      })
    )
    
    return await this.transaction(operations)
  }
}


