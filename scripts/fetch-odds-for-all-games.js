#!/usr/bin/env node
import { sanitizeLoggedValue } from '../lib/sanitize-error.js'

/**
 * Fetch odds for all games that are mapped to Odds API but missing odds
 * Usage: node scripts/fetch-odds-for-all-games.js [sport]
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

const SPORT_CONFIGS = {
  nhl: { id: 'icehockey_nhl', markets: 'h2h,spreads,totals' },
  nfl: { id: 'americanfootball_nfl', markets: 'h2h,spreads,totals' },
  mlb: { id: 'baseball_mlb', markets: 'h2h,spreads,totals' }
}

async function fetchOddsForGame(game, sportConfig) {
  if (!game.oddsApiEventId) {
    return { skipped: true, reason: 'Not mapped to Odds API' }
  }
  
  // Check if odds already exist
  const { count } = await supabase
    .from('Odds')
    .select('*', { count: 'exact', head: true })
    .eq('gameId', game.id)
  
  if (count > 0) {
    return { skipped: true, reason: `Already has ${count} odds records` }
  }
  
  // Fetch odds from The Odds API
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
        const oddsId = `${game.id}_${bookmaker.title}_${market.key}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        
        const includeQuotedAt = await oddsTableHasQuotedAt(supabase)
        let oddsRow = oddsInsertPayload({
          id: oddsId,
          gameId: game.id,
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
          console.error(`    ❌ Error saving ${bookmaker.title} ${market.key}: ${sanitizedErrorMessage(error)}`)
        } else {
          saved++
        }
      }
    }
    
    return { success: true, saved }
    
  } catch (error) {
    return { error: sanitizedErrorMessage(error, ODDS_API_KEY) }
  }
}

async function fetchOddsForAllGames(sportFilter = null) {
  console.log('🎯 FETCHING ODDS FOR ALL GAMES')
  console.log('='.repeat(50))
  console.log()
  
  const sports = sportFilter ? [sportFilter] : ['nhl', 'nfl', 'mlb']
  
  let totalFetched = 0
  let totalSkipped = 0
  let totalErrors = 0
  
  for (const sport of sports) {
    const sportConfig = SPORT_CONFIGS[sport]
    if (!sportConfig) {
      console.log(`⚠️  Unknown sport: ${sport}, skipping`)
      continue
    }
    
    console.log(`\n📊 Processing ${sport.toUpperCase()} games...`)
    
    // Get all games for this sport that are mapped to Odds API
    const { data: games, error: gamesError } = await supabase
      .from('Game')
      .select(`
        id,
        sport,
        oddsApiEventId,
        home:Team!Game_homeId_fkey(abbr),
        away:Team!Game_awayId_fkey(abbr)
      `)
      .eq('sport', sport)
      .not('oddsApiEventId', 'is', null)
    
    if (gamesError) {
      console.error(`❌ Error fetching ${sport} games:`, sanitizeLoggedValue(gamesError))
      continue
    }
    
    if (!games || games.length === 0) {
      console.log(`  ℹ️  No mapped ${sport.toUpperCase()} games found`)
      continue
    }
    
    console.log(`  📅 Found ${games.length} ${sport.toUpperCase()} games with Odds API mapping\n`)
    
    for (const game of games) {
      const gameLabel = `${game.away?.abbr || '?'} @ ${game.home?.abbr || '?'}`
      console.log(`  🔄 ${gameLabel} (${game.id})...`)
      
      const result = await fetchOddsForGame(game, sportConfig)
      
      if (result.skipped) {
        console.log(`    ⏭️  Skipped: ${result.reason}`)
        totalSkipped++
      } else if (result.error) {
        console.error(`    ❌ Error: ${sanitizedErrorMessage(result.error, ODDS_API_KEY)}`)
        totalErrors++
      } else if (result.success) {
        console.log(`    ✅ Fetched and saved ${result.saved} odds records`)
        totalFetched++
      }
      
      // Rate limit: small delay between games
      await new Promise(r => setTimeout(r, 500))
    }
  }
  
  console.log('\n' + '='.repeat(50))
  console.log(`✅ COMPLETE`)
  console.log(`   Fetched odds for: ${totalFetched} games`)
  console.log(`   Skipped: ${totalSkipped} games`)
  console.log(`   Errors: ${totalErrors} games`)
  console.log()
}

const sportFilter = process.argv[2]?.toLowerCase()

if (sportFilter && !SPORT_CONFIGS[sportFilter]) {
  console.error(`❌ Invalid sport: ${sportFilter}`)
  console.error(`   Valid options: ${Object.keys(SPORT_CONFIGS).join(', ')}`)
  process.exit(1)
}

fetchOddsForAllGames(sportFilter).catch(error => {
  console.error('❌ Fatal error:', sanitizedErrorMessage(error, process.env.ODDS_API_KEY))
  process.exit(1)
})

