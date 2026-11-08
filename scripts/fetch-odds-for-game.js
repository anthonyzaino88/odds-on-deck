#!/usr/bin/env node

/**
 * Fetch odds for a specific game by game ID
 * Usage: node scripts/fetch-odds-for-game.js VAN_at_NSH_2025-11-04
 */

import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { oddsInsertPayload } from '../lib/live-odds-landing.js'
import {
  bookmakerQuoteTimeIso,
  isMissingQuotedAtColumnError,
  oddsTableHasQuotedAt,
  omitQuotedAtFields,
} from '../lib/odds-quote-time.js'
import { sanitizeOddsApiError, sanitizedErrorMessage } from '../lib/odds-api-budget.js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createScriptSupabaseClient()

const ODDS_API_KEY = process.env.ODDS_API_KEY
const ODDS_API_BASE = 'https://api.the-odds-api.com'

async function fetchOddsForGame(gameId) {
  console.log(`🔍 Fetching odds for game: ${gameId}\n`)
  
  // Get game details
  const { data: game, error: gameError } = await supabase
    .from('Game')
    .select(`
      id,
      sport,
      date,
      oddsApiEventId,
      home:Team!Game_homeId_fkey(name, abbr),
      away:Team!Game_awayId_fkey(name, abbr)
    `)
    .eq('id', gameId)
    .single()
  
  if (gameError || !game) {
    console.error(`❌ Game not found: ${gameId}`)
    console.error(`   Error: ${gameError?.message || 'Game does not exist'}`)
    return
  }
  
  console.log(`📊 Game: ${game.away?.abbr} @ ${game.home?.abbr}`)
  console.log(`   Sport: ${game.sport.toUpperCase()}`)
  console.log(`   Odds API Event ID: ${game.oddsApiEventId || 'NOT MAPPED'}\n`)
  
  if (!game.oddsApiEventId) {
    console.error(`❌ Game is not mapped to Odds API event ID`)
    console.error(`   Run the mapping script first: node scripts/fetch-live-odds.js ${game.sport}`)
    return
  }
  
  // Get sport config
  const sportConfigs = {
    nhl: { id: 'icehockey_nhl', markets: 'h2h,spreads,totals' },
    nfl: { id: 'americanfootball_nfl', markets: 'h2h,spreads,totals' },
    mlb: { id: 'baseball_mlb', markets: 'h2h,spreads,totals' }
  }
  
  const sportConfig = sportConfigs[game.sport]
  if (!sportConfig) {
    console.error(`❌ Unknown sport: ${game.sport}`)
    return
  }
  
  // Fetch odds from The Odds API
  console.log(`📡 Fetching odds from The Odds API...`)
  const url = `${ODDS_API_BASE}/v4/sports/${sportConfig.id}/events/${game.oddsApiEventId}/odds?regions=us&markets=${sportConfig.markets}&apiKey=${ODDS_API_KEY}`
  
  try {
    const response = await fetch(url)
    if (!response.ok) {
      let errorText = ''
      try {
        errorText = await response.text()
      } catch (error) {
        throw sanitizeOddsApiError(error, ODDS_API_KEY)
      }
      throw sanitizeOddsApiError(
        new Error(`API returned ${response.status}: ${errorText}`),
        ODDS_API_KEY,
      )
    }
    
    const oddsData = await response.json()
    console.log(`✅ Fetched odds data\n`)
    
    // Process and save odds
    let saved = 0
    
    for (const bookmaker of oddsData.bookmakers || []) {
      for (const market of bookmaker.markets || []) {
        if (!['h2h', 'spreads', 'totals'].includes(market.key)) continue
        
        const outcomes = market.outcomes || []
        
        // Get prices
        let priceHome = null
        let priceAway = null
        let spread = null
        let total = null
        
        if (market.key === 'h2h') {
          // Moneyline
          for (const outcome of outcomes) {
            if (outcome.name === oddsData.home_team) {
              priceHome = outcome.price
            } else if (outcome.name === oddsData.away_team) {
              priceAway = outcome.price
            }
          }
        } else if (market.key === 'spreads') {
          // Spread
          for (const outcome of outcomes) {
            if (outcome.name === oddsData.home_team) {
              priceHome = outcome.price
              spread = outcome.point
            } else if (outcome.name === oddsData.away_team) {
              priceAway = outcome.price
              if (!spread) spread = -outcome.point
            }
          }
        } else if (market.key === 'totals') {
          // Total
          for (const outcome of outcomes) {
            if (outcome.name === 'Over') {
              priceHome = outcome.price
              total = outcome.point
            } else if (outcome.name === 'Under') {
              priceAway = outcome.price
              if (!total) total = outcome.point
            }
          }
        }
        
        // Generate unique ID
        const oddsId = `${gameId}_${bookmaker.title}_${market.key}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        
        const includeQuotedAt = await oddsTableHasQuotedAt(supabase)
        let oddsRow = oddsInsertPayload({
          id: oddsId,
          gameId,
          book: bookmaker.title,
          market: market.key,
          priceAway,
          priceHome,
          spread,
          total,
          ts: new Date().toISOString(),
          quoteTime: bookmakerQuoteTimeIso(bookmaker, market),
          includeQuotedAt,
        })
        let { error } = await supabase
          .from('Odds')
          .upsert(oddsRow, { onConflict: 'id' })
        if (error && includeQuotedAt && isMissingQuotedAtColumnError(error)) {
          oddsRow = omitQuotedAtFields(oddsRow)
          const retry = await supabase.from('Odds').upsert(oddsRow, { onConflict: 'id' })
          error = retry.error
        }
        
        if (error && !error.code?.includes('23505')) {
          console.error(`  ❌ Error saving ${bookmaker.title} ${market.key}: ${error.message}`)
        } else {
          saved++
        }
      }
    }
    
    console.log(`✅ Saved ${saved} odds records for ${game.away?.abbr} @ ${game.home?.abbr}`)
    
  } catch (error) {
    console.error(`❌ Error fetching odds: ${sanitizedErrorMessage(error, ODDS_API_KEY)}`)
  }
}

const gameId = process.argv[2]

if (!gameId) {
  console.error('Usage: node scripts/fetch-odds-for-game.js <gameId>')
  console.error('Example: node scripts/fetch-odds-for-game.js VAN_at_NSH_2025-11-04')
  process.exit(1)
}

fetchOddsForGame(gameId).catch(error => {
  console.error('❌ Fatal error:', sanitizedErrorMessage(error, process.env.ODDS_API_KEY))
  process.exit(1)
})

