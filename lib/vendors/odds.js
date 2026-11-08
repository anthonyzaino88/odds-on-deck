// Vendor layer for odds data - easily swappable for different providers.
// No production importer today; getBestLines is pinned by
// __tests__/lib/odds-best-lines.test.js so the totals contract stays tested.

import { createGameId, getTeamAbbr } from '../team-mapping.js'
import { shouldFetchOdds, logApiUsage } from '../api-usage-manager.js'
import { sanitizedErrorMessage } from '../odds-api-budget.js'

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'

// Simple in-memory cache for opening lines
const openingLinesCache = new Map()

export async function fetchOdds(sport = 'mlb', date = null) {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) {
    console.warn('⚠️ ODDS_API_KEY not configured - skipping odds fetch')
    return []
  }

  // ✅ QUICK WIN: Check if we have recent odds in database (last 60 minutes)
  const { prisma } = await import('../db.js')
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  
  const recentOdds = await prisma.odds.findMany({
    where: {
      ts: { gte: oneHourAgo }
    },
    include: {
      game: {
        include: {
          home: true,
          away: true
        }
      }
    },
    orderBy: { ts: 'desc' }
  })
  
  // Filter by sport
  const sportOdds = recentOdds.filter(odd => odd.game?.sport === sport)
  
  if (sportOdds.length > 0) {
    const ageMinutes = Math.round((Date.now() - new Date(sportOdds[0].ts).getTime()) / (1000 * 60))
    console.log(`✅ Using recent ${sport.toUpperCase()} odds from database (${sportOdds.length} odds, ${ageMinutes} min old) - API call saved!`)
    
    // Return in the expected format (no 'sport', 'selection', 'odds' fields - they don't exist in schema)
    return sportOdds.map(odd => ({
      gameId: odd.gameId,
      book: odd.book,
      market: odd.market,
      priceHome: odd.priceHome,
      priceAway: odd.priceAway,
      total: odd.total,
      spread: odd.spread,
      ts: odd.ts
    }))
  }

  // Check if we should fetch odds based on usage limits
  const usageCheck = await shouldFetchOdds(sport)
  if (!usageCheck.shouldFetch) {
    console.log(`⏭️ Skipping ${sport.toUpperCase()} odds fetch: ${usageCheck.reason}`)
    return []
  }

  // Create a shared timestamp for this API call
  const apiCallTimestamp = new Date()

  // Map sports to API endpoints
  const sportEndpoints = {
    'mlb': 'baseball_mlb',
    'nfl': 'americanfootball_nfl',
    'nhl': 'icehockey_nhl'
  }
  
  const endpoint = sportEndpoints[sport] || 'baseball_mlb'
  const url = `${ODDS_API_BASE}/sports/${endpoint}/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=american&apiKey=${apiKey}`
  
  try {
    console.log(`📊 Fetching ${sport.toUpperCase()} odds from API... (${usageCheck.reason})`)
    
    const res = await fetch(url, { 
      cache: 'no-store',
      headers: {
        'User-Agent': 'OddsOnDeck/1.0'
      }
    })
    
    if (!res.ok) {
      // Handle specific error codes
      if (res.status === 401) {
        console.error('🔑 Odds API: Invalid or expired API key')
        await logApiUsage(sport, 0, false)
        return []
      } else if (res.status === 429) {
        console.error('⏰ Odds API: Rate limit exceeded - too many requests')
        await logApiUsage(sport, 0, false)
        return []
      } else if (res.status === 403) {
        console.error('🚫 Odds API: Access forbidden - check API key permissions')
        await logApiUsage(sport, 0, false)
        return []
      } else {
        console.error(`❌ Odds API error: ${res.status}`)
        await logApiUsage(sport, 0, false)
        return []
      }
    }
    
    const data = await res.json()
    const mappedData = mapOddsData(data, apiCallTimestamp)
    
    // Log successful API usage
    await logApiUsage(sport, mappedData.length, true)
    
    console.log(`✅ Successfully fetched ${data.length} ${sport.toUpperCase()} games from odds API`)
    return mappedData
  } catch (error) {
    console.error('❌ Failed to fetch odds:', sanitizedErrorMessage(error, apiKey))
    await logApiUsage(sport, 0, false)
    // Return empty array for graceful degradation
    return []
  }
}

function mapOddsData(apiData, sharedTimestamp = new Date()) {
  const mappedOdds = []
  
  for (const game of apiData) {
    // Convert team names to abbreviations for consistent game ID generation
    const awayAbbr = getTeamAbbr(game.away_team) || game.away_team
    const homeAbbr = getTeamAbbr(game.home_team) || game.home_team
    const gameDate = game.commence_time.split('T')[0]
    const gameId = createGameId(awayAbbr, homeAbbr, gameDate)
    const commence_time = new Date(game.commence_time)
    
    for (const bookmaker of game.bookmakers) {
      const book = bookmaker.title
      
      for (const market of bookmaker.markets) {
        if (market.key === 'h2h') {
          // Head-to-head (moneyline) odds
          const homeOutcome = market.outcomes.find(o => o.name === game.home_team)
          const awayOutcome = market.outcomes.find(o => o.name === game.away_team)
          
          // Get opening lines and calculate movement
          const openingLines = getOpeningLines(gameId, book, 'h2h')
          const movement = calculateMovement(
            { home: homeOutcome?.price, away: awayOutcome?.price },
            openingLines
          )
          
          mappedOdds.push({
            gameId,
            book,
            market: 'h2h',
            priceHome: homeOutcome?.price || null,
            priceAway: awayOutcome?.price || null,
            total: null,
            spread: null,
            openingPriceHome: openingLines.home,
            openingPriceAway: openingLines.away,
            movementDirection: movement.direction,
            isSharpMoney: movement.isSharp,
            commence_time,
            ts: sharedTimestamp
          })
        } else if (market.key === 'totals') {
          // Over/Under totals
          const overOutcome = market.outcomes.find(o => o.name === 'Over')
          const underOutcome = market.outcomes.find(o => o.name === 'Under')
          
          // Get opening lines and calculate movement
          const openingLines = getOpeningLines(gameId, book, 'totals')
          const movement = calculateMovement(
            { over: overOutcome?.price, under: underOutcome?.price, total: overOutcome?.point || underOutcome?.point },
            openingLines
          )
          
          mappedOdds.push({
            gameId,
            book,
            market: 'totals',
            // Canonical: Over = priceAway, Under = priceHome (same as fetch-live-odds).
            priceHome: underOutcome?.price || null,
            priceAway: overOutcome?.price || null,
            total: overOutcome?.point || underOutcome?.point || null,
            spread: null,
            openingTotal: openingLines.total,
            movementDirection: movement.direction,
            isSharpMoney: movement.isSharp,
            commence_time,
            ts: sharedTimestamp
          })
        } else if (market.key === 'spreads') {
          // Point spreads
          const homeOutcome = market.outcomes.find(o => o.name === game.home_team)
          const awayOutcome = market.outcomes.find(o => o.name === game.away_team)
          
          mappedOdds.push({
            gameId,
            book,
            market: 'spreads',
            priceHome: homeOutcome?.price || null,
            priceAway: awayOutcome?.price || null,
            total: null,
            spread: homeOutcome?.point || null, // Home team spread
            commence_time,
            ts: sharedTimestamp
          })
        }
      }
    }
  }
  
  return mappedOdds
}

/**
 * Get opening lines for a game/book/market combination
 */
function getOpeningLines(gameId, book, market) {
  const key = `${gameId}_${book}_${market}`
  return openingLinesCache.get(key) || { home: null, away: null, total: null }
}

/**
 * Set opening lines for a game/book/market combination
 */
function setOpeningLines(gameId, book, market, lines) {
  const key = `${gameId}_${book}_${market}`
  if (!openingLinesCache.has(key)) {
    openingLinesCache.set(key, lines)
  }
}

/**
 * Calculate market movement and detect sharp money
 */
function calculateMovement(currentLines, openingLines) {
  let direction = null
  let isSharp = false
  
  if (openingLines.home && currentLines.home) {
    const homeMovement = currentLines.home - openingLines.home
    if (Math.abs(homeMovement) > 20) { // Significant movement
      direction = homeMovement > 0 ? 'toward_home' : 'toward_away'
      isSharp = Math.abs(homeMovement) > 50 // Sharp money indicator
    }
  }
  
  if (openingLines.total && currentLines.total) {
    const totalMovement = currentLines.total - openingLines.total
    if (Math.abs(totalMovement) > 0.5) { // Significant movement
      direction = totalMovement > 0 ? 'toward_over' : 'toward_under'
      isSharp = Math.abs(totalMovement) > 1.0 // Sharp money indicator
    }
  }
  
  return { direction, isSharp }
}

/**
 * Best available h2h / totals across books.
 *
 * Totals use the same stored mapping as fetch-live-odds, edge, and picks:
 * Over = priceAway, Under = priceHome. Each side keeps that book's total
 * so over/under from different books are not mixed onto one line.
 */
export function getBestLines(oddsArray) {
  const bestLines = {
    h2h: { home: null, away: null },
    totals: { over: null, under: null, total: null }
  }

  for (const odds of oddsArray || []) {
    if (odds.market === 'h2h') {
      if (odds.priceHome != null && (!bestLines.h2h.home || odds.priceHome > bestLines.h2h.home.price)) {
        bestLines.h2h.home = { price: odds.priceHome, book: odds.book }
      }
      if (odds.priceAway != null && (!bestLines.h2h.away || odds.priceAway > bestLines.h2h.away.price)) {
        bestLines.h2h.away = { price: odds.priceAway, book: odds.book }
      }
    } else if (odds.market === 'totals') {
      const overPrice = odds.priceAway
      const underPrice = odds.priceHome
      const total = odds.total ?? null
      if (overPrice != null && (!bestLines.totals.over || overPrice > bestLines.totals.over.price)) {
        bestLines.totals.over = { price: overPrice, book: odds.book, total }
      }
      if (underPrice != null && (!bestLines.totals.under || underPrice > bestLines.totals.under.price)) {
        bestLines.totals.under = { price: underPrice, book: odds.book, total }
      }
    }
  }

  const over = bestLines.totals.over
  const under = bestLines.totals.under
  if (over?.book && under?.book && over.book === under.book) {
    bestLines.totals.total = over.total ?? under.total ?? null
  } else if (over?.total != null && under?.total != null && over.total === under.total) {
    bestLines.totals.total = over.total
  } else {
    bestLines.totals.total = null
  }

  return bestLines
}

