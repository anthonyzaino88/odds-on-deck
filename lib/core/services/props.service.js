/**
 * Props Service
 * 
 * Handles player prop generation and management.
 * This breaks down player-props-enhanced.js (515 lines) into manageable pieces.
 */

import { prisma } from '../database/prisma.js'
import { fetchAllPlayerProps, parsePlayerProps, getBestPropOdds } from '../../vendors/player-props-odds.js'
import { recordPropPrediction } from '../../../lib/validation.js'
import { calculateQualityScore } from '../../../lib/quality-score.js'

export class PropsService {
  constructor() {
    this.sports = ['mlb', 'nfl', 'nhl']
  }

  /**
   * Generate player props with real odds from The Odds API
   */
  async generatePropsWithRealOdds() {
    console.log('🎯 PropsService: Generating props with real odds...')
    
    try {
      const allProps = []
      
      // Get upcoming games for each sport
      const [mlbGames, nhlGames] = await Promise.all([
        this._getUpcomingMLBGames(),
        this._getUpcomingNHLGames()
      ])
      
      // Fetch prop odds from API
      const [mlbPropsData, nhlPropsData] = await Promise.all([
        mlbGames.length > 0 ? fetchAllPlayerProps('baseball_mlb') : Promise.resolve([]),
        nhlGames.length > 0 ? fetchAllPlayerProps('icehockey_nhl') : Promise.resolve([])
      ])
      
      // Process MLB props
      for (const propsData of mlbPropsData) {
        const props = await this._processMLBGameProps(propsData, mlbGames)
        allProps.push(...props)
      }
      
      // Process NHL props
      for (const propsData of nhlPropsData) {
        const props = await this._processNHLGameProps(propsData, nhlGames)
        allProps.push(...props)
      }
      
      console.log(`✅ PropsService: Generated ${allProps.length} props`)
      
      // Record for validation
      await this._recordPropsForValidation(allProps)
      
      // Sort by win probability
      return this._sortProps(allProps)
      
    } catch (error) {
      console.error('❌ PropsService: Error generating props:', error)
      return []
    }
  }

  /**
   * Generate model-based props (fallback when not using real odds)
   */
  async generateModelBasedProps() {
    const { generatePlayerProps } = await import('../../../lib/player-props.js')
    return await generatePlayerProps()
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Get upcoming MLB games
   */
  async _getUpcomingMLBGames() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayAfterTomorrow = new Date(today)
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
    
    return await prisma.game.findMany({
      where: {
        date: { gte: today, lt: dayAfterTomorrow },
        sport: 'mlb',
        status: { in: ['scheduled', 'pre-game', 'pre_game', 'delayed_start', 'warmup', 'in_progress'] }
      },
      include: {
        home: true,
        away: true,
        lineups: {
          include: { player: true },
          where: { isStarting: true }
        }
      }
    })
  }

  /**
   * Get upcoming NHL games
   */
  async _getUpcomingNHLGames() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayAfterTomorrow = new Date(today)
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
    
    return await prisma.game.findMany({
      where: {
        date: { gte: today, lt: dayAfterTomorrow },
        sport: 'nhl',
        status: { in: ['scheduled', 'pre-game', 'pre_game', 'delayed_start', 'warmup', 'in_progress'] }
      },
      include: {
        home: true,
        away: true
      }
    })
  }

  /**
   * Process MLB game props
   */
  async _processMLBGameProps(propsData, games) {
    const matchingGame = this._findMatchingGame(propsData, games, 'mlb')
    
    if (!matchingGame) {
      console.warn(`⚠️ PropsService: Could not match game: ${propsData.away_team} @ ${propsData.home_team}`)
      return []
    }
    
    const parsedProps = parsePlayerProps(propsData, matchingGame.id)
    const groupedProps = this._groupPropsByPlayerMarket(parsedProps)
    
    const gameProps = []
    
    for (const [key, props] of Object.entries(groupedProps)) {
      const prop = this._createPropFromGroup(props, matchingGame, 'mlb')
      if (prop) {
        gameProps.push(prop)
      }
    }
    
    return gameProps
  }

  /**
   * Process NHL game props
   */
  async _processNHLGameProps(propsData, games) {
    const matchingGame = this._findMatchingGame(propsData, games, 'nhl')
    
    if (!matchingGame) {
      console.warn(`⚠️ PropsService: Could not match game: ${propsData.away_team} @ ${propsData.home_team}`)
      return []
    }
    
    const parsedProps = parsePlayerProps(propsData, matchingGame.id)
    const groupedProps = this._groupPropsByPlayerMarket(parsedProps)
    
    const gameProps = []
    
    for (const [key, props] of Object.entries(groupedProps)) {
      const prop = this._createPropFromGroup(props, matchingGame, 'nhl')
      if (prop) {
        gameProps.push(prop)
      }
    }
    
    return gameProps
  }

  /**
   * Find matching game in database
   */
  _findMatchingGame(propsData, games, sport) {
    return games.find(g => 
      this._teamsMatch(g.away.name, propsData.away_team) &&
      this._teamsMatch(g.home.name, propsData.home_team)
    )
  }

  /**
   * Check if team names match
   */
  _teamsMatch(dbName, apiName) {
    const normalize = (name) => name.toLowerCase().trim().replace(/\s+/g, ' ')
    return normalize(dbName).includes(normalize(apiName.split(' ')[0])) ||
           normalize(apiName).includes(normalize(dbName.split(' ')[0]))
  }

  /**
   * Group props by player and market
   */
  _groupPropsByPlayerMarket(props) {
    const grouped = {}
    
    for (const prop of props) {
      const key = `${prop.playerName}_${prop.market}_${prop.threshold}`
      if (!grouped[key]) {
        grouped[key] = []
      }
      grouped[key].push(prop)
    }
    
    return grouped
  }

  /**
   * Create prop object from grouped props
   */
  _createPropFromGroup(props, game, sport) {
    const bestOdds = getBestPropOdds(props)
    
    if (!bestOdds.over || !bestOdds.under) return null
    
    const threshold = props[0].threshold
    const projection = this._calculateProjection(props[0].playerName, props[0].market, game, threshold)
    const pick = projection >= threshold ? 'over' : 'under'
    const selectedOdds = pick === 'over' ? bestOdds.over.odds : bestOdds.under.odds
    
    // Calculate probabilities and edge
    const impliedProb = this._oddsToImpliedProbability(selectedOdds)
    const ourProb = this._calculateOurProbability(projection, threshold, pick)
    const edge = (ourProb - impliedProb) / impliedProb
    
    // Sanity check: filter unrealistic edges
    if (edge < 0.02 || edge > 0.50) return null
    
    const confidence = this._getConfidence(edge)
    const qualityScore = calculateQualityScore({
      probability: ourProb,
      edge: edge,
      confidence: confidence
    })
    
    return {
      id: `${sport}-prop-${props[0].playerName.replace(/\s+/g, '-')}-${props[0].market}-${game.id}`,
      playerId: props[0].playerName,
      playerName: props[0].playerName,
      gameId: game.id,
      team: null,
      type: props[0].market,
      pick: pick,
      threshold: threshold,
      odds: selectedOdds,
      probability: ourProb,
      edge: edge,
      confidence: confidence,
      qualityScore: qualityScore,
      reasoning: `${props[0].playerName} projects ${projection.toFixed(1)} vs ${threshold} line`,
      gameTime: game.date,
      sport: sport,
      category: 'player_prop',
      projection: projection,
      bookmaker: bestOdds[pick].bookmaker,
      lastUpdate: bestOdds[pick].lastUpdate
    }
  }

  /**
   * Calculate projection (simplified for now)
   */
  _calculateProjection(playerName, market, game, threshold) {
    // Random adjustment: -5% to +5% of threshold
    const adjustmentPercent = (Math.random() - 0.5) * 0.10
    return Math.max(0, threshold * (1 + adjustmentPercent))
  }

  /**
   * Calculate our probability estimate
   */
  _calculateOurProbability(projection, threshold, pick) {
    const diff = projection - threshold
    const percentDiff = diff / threshold
    
    if (pick === 'over') {
      return projection > threshold
        ? Math.min(0.58, 0.50 + (percentDiff * 0.3))
        : Math.max(0.42, 0.50 + (percentDiff * 0.3))
    } else {
      return projection < threshold
        ? Math.min(0.58, 0.50 - (percentDiff * 0.3))
        : Math.max(0.42, 0.50 - (percentDiff * 0.3))
    }
  }

  /**
   * Convert American odds to implied probability
   */
  _oddsToImpliedProbability(americanOdds) {
    return americanOdds > 0
      ? 100 / (americanOdds + 100)
      : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)
  }

  /**
   * Get confidence level based on edge
   */
  _getConfidence(edge) {
    if (edge >= 0.20) return 'very_high'
    if (edge >= 0.15) return 'high'
    if (edge >= 0.08) return 'medium'
    return 'low'
  }

  /**
   * Record props for validation
   */
  async _recordPropsForValidation(props) {
    for (const prop of props) {
      try {
        await recordPropPrediction(prop)
      } catch (error) {
        // Silent fail - validation is non-critical
      }
    }
  }

  /**
   * Sort props by win probability
   */
  _sortProps(props) {
    return props.sort((a, b) => {
      // Primary: probability
      if (Math.abs(a.probability - b.probability) > 0.01) {
        return b.probability - a.probability
      }
      // Tiebreaker: edge
      return b.edge - a.edge
    })
  }
}


