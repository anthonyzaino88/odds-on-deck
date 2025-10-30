/**
 * Odds Service
 * 
 * Handles fetching and managing odds data from The Odds API.
 * Includes schedule and team management.
 */

import { prisma } from '../database/prisma.js'
import { fetchOdds } from '../../vendors/odds.js'

export class OddsService {
  constructor() {
    this.sports = ['mlb', 'nfl', 'nhl']
  }

  /**
   * Refresh schedules and teams for all sports
   */
  async refreshSchedulesAndTeams() {
    console.log('📅 OddsService: Refreshing schedules and teams...')
    
    try {
      const results = await Promise.allSettled([
        this._refreshMLBSchedule(),
        this._refreshNFLSchedule(),
        this._refreshNHLSchedule()
      ])
      
      let totalGames = 0
      let totalTeams = 0
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          totalGames += result.value.gamesAdded || 0
          totalTeams += result.value.teamsAdded || 0
        } else {
          console.error(`❌ OddsService: Error refreshing ${this.sports[index]}:`, result.reason)
        }
      })
      
      console.log(`✅ OddsService: Added ${totalGames} games, ${totalTeams} teams`)
      
      return { gamesAdded: totalGames, teamsAdded: totalTeams }
      
    } catch (error) {
      console.error('❌ OddsService: Error refreshing schedules:', error)
      return { gamesAdded: 0, teamsAdded: 0 }
    }
  }

  /**
   * Refresh odds for all sports
   */
  async refreshOdds() {
    console.log('📊 OddsService: Refreshing odds...')
    
    try {
      const [mlbOdds, nflOdds, nhlOdds] = await Promise.all([
        fetchOdds('mlb'),
        fetchOdds('nfl'),
        fetchOdds('nhl')
      ])
      
      let oddsStored = 0
      
      // Store odds (combine all sports)
      const allOdds = [...mlbOdds, ...nflOdds, ...nhlOdds]
      
      for (const odds of allOdds) {
        try {
          await this._createOdds(odds)
          oddsStored++
        } catch (error) {
          // Skip duplicates silently
        }
      }
      
      console.log(`✅ OddsService: Stored ${oddsStored} odds`)
      
      return { oddsStored }
      
    } catch (error) {
      console.error('❌ OddsService: Error refreshing odds:', error)
      return { oddsStored: 0 }
    }
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Refresh MLB schedule
   */
  async _refreshMLBSchedule() {
    const { fetchSchedule, fetchTeams } = await import('../../vendors/stats.js')
    
    console.log('⚾ OddsService: Fetching MLB schedule...')
    
    let gamesAdded = 0
    let teamsAdded = 0
    
    // Fetch teams
    const teams = await fetchTeams(true)
    for (const team of teams) {
      try {
        await this._upsertTeam(team)
        teamsAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    
    // Fetch games
    const games = await fetchSchedule({ useLocalDate: true, noCache: true })
    for (const game of games) {
      try {
        await this._upsertGame(this._transformMLBGame(game))
        gamesAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    
    console.log(`✅ OddsService: MLB - ${gamesAdded} games, ${teamsAdded} teams`)
    
    return { gamesAdded, teamsAdded }
  }

  /**
   * Refresh NFL schedule
   */
  async _refreshNFLSchedule() {
    const { fetchNFLSchedule, fetchNFLTeams } = await import('../../vendors/nfl-stats.js')
    
    console.log('🏈 OddsService: Fetching NFL schedule...')
    
    let gamesAdded = 0
    let teamsAdded = 0
    
    // Fetch teams
    const teams = await fetchNFLTeams()
    for (const team of teams) {
      try {
        await this._upsertTeam(team)
        teamsAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    
    // Fetch games
    const games = await fetchNFLSchedule()
    for (const game of games) {
      try {
        await this._upsertGame(game)
        gamesAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    
    console.log(`✅ OddsService: NFL - ${gamesAdded} games, ${teamsAdded} teams`)
    
    return { gamesAdded, teamsAdded }
  }

  /**
   * Refresh NHL schedule
   */
  async _refreshNHLSchedule() {
    const { fetchNHLSchedule, fetchNHLTeams } = await import('../../vendors/nhl-stats.js')
    
    console.log('🏒 OddsService: Fetching NHL schedule...')
    
    let gamesAdded = 0
    let teamsAdded = 0
    
    // Fetch teams
    const teams = await fetchNHLTeams()
    for (const team of teams) {
      try {
        await this._upsertTeam(team)
        teamsAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    
    // Fetch games
    const games = await fetchNHLSchedule()
    for (const game of games) {
      try {
        await this._upsertGame(game)
        gamesAdded++
      } catch (error) {
        // Skip duplicates
      }
    }
    
    console.log(`✅ OddsService: NHL - ${gamesAdded} games, ${teamsAdded} teams`)
    
    return { gamesAdded, teamsAdded }
  }

  /**
   * Upsert team
   */
  async _upsertTeam(teamData) {
    const { upsertTeam } = await import('../../../lib/db.js') // Legacy helper
    return await upsertTeam(teamData)
  }

  /**
   * Upsert game
   */
  async _upsertGame(gameData) {
    const { upsertGame } = await import('../../../lib/db.js') // Legacy helper
    return await upsertGame(gameData)
  }

  /**
   * Create odds record
   */
  async _createOdds(oddsData) {
    const { createOdds } = await import('../../../lib/db.js') // Legacy helper
    return await createOdds(oddsData)
  }

  /**
   * Transform MLB game data for database
   */
  _transformMLBGame(game) {
    return {
      id: game.id,
      mlbGameId: game.mlbGameId,
      date: game.date,
      status: game.status,
      homeId: game.home.id,
      awayId: game.away.id,
      probableHomePitcherId: game.probablePitchers?.home?.id || null,
      probableAwayPitcherId: game.probablePitchers?.away?.id || null
    }
  }
}


