#!/usr/bin/env node

/**
 * ODDS FETCHER - Efficient local script to fetch odds data from The Odds API
 * 
 * PURPOSE: Fetch odds/props once daily and cache in database
 * FREQUENCY: Run 1-2x per day (morning before games)
 * API BUDGET: ~500 requests/month (free tier) = 16/day available
 * 
 * USAGE:
 *   node scripts/fetch-live-odds.js nfl --date 2025-11-02 --dry-run
 *   node scripts/fetch-live-odds.js mlb
 *   node scripts/fetch-live-odds.js all
 * 
 * FLAGS:
 *   --dry-run      Don't save to DB, just show what would happen
 *   --date         Specific date to fetch (YYYY-MM-DD)
 *   --cache-fresh  Ignore cache, force fresh fetch from API
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import fs from 'fs'
import path from 'path'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// ============================================================================
// CONFIGURATION
// ============================================================================

const ODDS_API_KEY = process.env.ODDS_API_KEY
const RATE_LIMIT_DELAY = 1000  // 1 second between API calls
const CACHE_DURATION = {
  MONEYLINE: 60 * 60 * 1000,      // 1 hour
  SPREADS: 60 * 60 * 1000,        // 1 hour
  PROPS: 24 * 60 * 60 * 1000      // 24 hours
}

const SPORTS = {
  nfl: { id: 'americanfootball_nfl', type: 'football' },
  mlb: { id: 'baseball_mlb', type: 'baseball' },
  nhl: { id: 'icehockey_nhl', type: 'hockey' }
}

const NFL_PROP_MARKETS = [
  'player_pass_yds', 'player_pass_tds',
  'player_rush_yds', 'player_receptions', 'player_reception_yds'
]

const MLB_PROP_MARKETS = [
  'batter_hits', 'batter_home_runs', 'pitcher_strikeouts',
  'pitcher_walks', 'batter_rbi', 'batter_singles', 'batter_doubles'
]

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

function parseArguments() {
  const args = process.argv.slice(2)
  
  let sport = 'all'
  let date = new Date().toISOString().split('T')[0]
  let dryRun = false
  let cacheFresh = false
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--cache-fresh') {
      cacheFresh = true
    } else if (arg === '--date' && args[i + 1]) {
      date = args[++i]
    } else if (!arg.startsWith('--') && !sport) {
      sport = arg.toLowerCase()
    }
  }
  
  return { sport, date, dryRun, cacheFresh }
}

// ============================================================================
// API UTILITIES
// ============================================================================

let apiCallsToday = 0

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function callOddsAPI(endpoint) {
  apiCallsToday++
  console.log(`  📡 API Call #${apiCallsToday}: ${endpoint}`)
  
  // Check rate limit
  if (apiCallsToday > 500) {
    throw new Error('⚠️  API QUOTA EXCEEDED! (500 calls/month)')
  }
  
  // Rate limiting
  if (apiCallsToday > 1) {
    await sleep(RATE_LIMIT_DELAY)
  }
  
  const url = `https://api.the-odds-api.com${endpoint}&apiKey=${ODDS_API_KEY}`
  
  try {
    const response = await fetch(url)
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`API Error ${response.status}: ${text}`)
    }
    
    const data = await response.json()
    return data
  } catch (error) {
    console.error(`  ❌ API Error: ${error.message}`)
    throw error
  }
}

// ============================================================================
// CACHE CHECKING
// ============================================================================

async function checkCache(table, where, maxAgeMs) {
  try {
    const { data } = await supabase
      .from(table)
      .select('ts')
      .match(where)
      .order('ts', { ascending: false })
      .limit(1)
    
    if (data?.[0]) {
      const age = Date.now() - new Date(data[0].ts).getTime()
      if (age < maxAgeMs) {
        return true  // Cache is fresh
      }
    }
  } catch (error) {
    console.error(`  ⚠️  Cache check error: ${error.message}`)
  }
  
  return false  // Cache is stale or doesn't exist
}

// ============================================================================
// ODDS DATA FETCHING
// ============================================================================

async function fetchGameOdds(sport, date) {
  const sportConfig = SPORTS[sport]
  if (!sportConfig) {
    console.error(`❌ Unknown sport: ${sport}`)
    return []
  }
  
  console.log(`\n🎮 Fetching ${sport.toUpperCase()} odds for ${date}...`)
  
  try {
    // Check cache first
    const isCached = await checkCache('Odds', 
      { market: 'h2h' }, 
      CACHE_DURATION.MONEYLINE
    )
    
    if (isCached) {
      console.log(`  ✅ Cache hit for moneyline odds`)
      return []
    }
    
    // Fetch from API
    const endpoint = `/v4/sports/${sportConfig.id}/odds`
    const params = `?regions=us&markets=h2h,spreads,totals&dateFormat=iso`
    
    const oddsData = await callOddsAPI(endpoint + params)
    const games = oddsData.data || []
    
    console.log(`  ✅ Fetched ${games.length} games with odds`)
    
    return games
    
  } catch (error) {
    console.error(`  ❌ Error fetching game odds: ${error.message}`)
    return []
  }
}

async function saveGameOdds(games, sport) {
  if (games.length === 0) return
  
  console.log(`  💾 Saving odds to database...`)
  
  let saved = 0
  for (const game of games) {
    try {
      for (const bookmaker of game.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          const outcomes = market.outcomes || []
          
          // Determine away and home prices
          let priceAway = null, priceHome = null, spread = null, total = null
          
          if (market.key === 'h2h' && outcomes.length >= 2) {
            priceAway = outcomes[0].price
            priceHome = outcomes[1].price
          } else if (market.key === 'spreads' && outcomes.length >= 2) {
            const away = outcomes.find(o => o.name === 'Away' || o.name.includes('Away'))
            const home = outcomes.find(o => o.name === 'Home' || o.name.includes('Home'))
            spread = market.description ? parseFloat(market.description) : null
            priceAway = away?.price
            priceHome = home?.price
          } else if (market.key === 'totals' && outcomes.length >= 2) {
            total = market.description ? parseFloat(market.description) : null
            priceAway = outcomes[0].price
            priceHome = outcomes[1].price
          }
          
          if (!priceAway || !priceHome) continue
          
          // Save to Odds table
          const { error } = await supabase
            .from('Odds')
            .upsert({
              gameId: game.id,
              book: bookmaker.title,
              market: market.key,
              priceAway,
              priceHome,
              spread,
              total,
              ts: new Date().toISOString()
            }, {
              onConflict: 'gameId,book,market'
            })
          
          if (error) {
            console.error(`    ❌ Save error: ${error.message}`)
          } else {
            saved++
          }
        }
      }
    } catch (error) {
      console.error(`    ❌ Processing error: ${error.message}`)
    }
  }
  
  console.log(`  ✅ Saved ${saved} odds records`)
}

// ============================================================================
// PLAYER PROPS FETCHING
// ============================================================================

async function fetchPlayerProps(sport, date, oddsGames) {
  const sportConfig = SPORTS[sport]
  if (!sportConfig) return []
  
  console.log(`\n👤 Fetching ${sport.toUpperCase()} player props for ${date}...`)
  
  try {
    // Use event IDs from the odds API response (not our database IDs)
    if (!oddsGames || oddsGames.length === 0) {
      console.log(`  ℹ️  No games available for props`)
      return []
    }
    
    console.log(`  📅 Found ${oddsGames.length} games from Odds API`)
    
    let allProps = []
    
    for (const game of oddsGames) {
      // Use The Odds API's event ID (hash format)
      const eventId = game.id
      
      // Check cache using the Odds API event ID
      const isCached = await checkCache('PlayerPropCache',
        { gameId: eventId },
        CACHE_DURATION.PROPS
      )
      
      if (isCached) {
        console.log(`    ✅ Cache hit for ${game.home_team} vs ${game.away_team}`)
        continue
      }
      
      try {
        const markets = sport === 'nfl' ? NFL_PROP_MARKETS : MLB_PROP_MARKETS
        const marketsParam = markets.join(',')
        
        // Use The Odds API event ID in the endpoint
        const endpoint = `/v4/sports/${sportConfig.id}/events/${eventId}/odds`
        const params = `?regions=us&markets=${marketsParam}&dateFormat=iso`
        
        const propsData = await callOddsAPI(endpoint + params)
        
        allProps.push({ 
          gameId: eventId, 
          homeTeam: game.home_team,
          awayTeam: game.away_team,
          props: propsData
        })
        console.log(`    ✅ Fetched props for ${game.home_team} vs ${game.away_team}`)
        
      } catch (error) {
        console.error(`    ⚠️  Error fetching props for ${game.home_team} vs ${game.away_team}: ${error.message}`)
      }
    }
    
    return allProps
    
  } catch (error) {
    console.error(`  ❌ Error fetching player props: ${error.message}`)
    return []
  }
}

async function savePlayerProps(gameProps, sport) {
  if (gameProps.length === 0) return
  
  console.log(`  💾 Saving player props to database...`)
  
  let saved = 0
  
  for (const { gameId, props } of gameProps) {
    try {
      for (const bookmaker of props.bookmakers || []) {
        for (const market of bookmaker.markets || []) {
          for (const outcome of market.outcomes || []) {
            const playerName = outcome.name
            const line = market.description ? parseFloat(market.description) : null
            const price = outcome.price
            
            if (!playerName || !line || !price) continue
            
            // Determine over/under
            let pick = 'over'
            if (outcome.point !== undefined && outcome.point < 0) {
              pick = 'under'
            }
            
            const propId = `${gameId}-${playerName}-${market.key}-${line}`
            
            // Save to PlayerPropCache
            const { error } = await supabase
              .from('PlayerPropCache')
              .upsert({
                propId,
                gameId,
                playerName,
                type: market.key,
                pick,
                threshold: line,
                odds: price,
                probability: 0.5,  // Default, will be calculated later
                edge: 0,           // Default, will be calculated later
                confidence: 'low',  // Default, will be calculated later
                qualityScore: 0,
                sport,
                bookmaker: bookmaker.title,
                gameTime: new Date().toISOString(),
                fetchedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + CACHE_DURATION.PROPS).toISOString(),
                isStale: false
              }, {
                onConflict: 'propId'
              })
            
            if (error) {
              console.error(`    ❌ Save error: ${error.message}`)
            } else {
              saved++
            }
          }
        }
      }
    } catch (error) {
      console.error(`    ❌ Processing error: ${error.message}`)
    }
  }
  
  console.log(`  ✅ Saved ${saved} prop records`)
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const { sport, date, dryRun, cacheFresh } = parseArguments()
  
  console.log('\n' + '='.repeat(60))
  console.log('⚡ ODDS FETCHER - LOCAL SCRIPT')
  console.log('='.repeat(60))
  console.log(`📅 Date: ${date}`)
  console.log(`🎮 Sport: ${sport}`)
  console.log(`🏗️  Mode: ${dryRun ? 'DRY RUN (no DB saves)' : 'PRODUCTION'}`)
  console.log(`🔄 Cache: ${cacheFresh ? 'IGNORE (force fresh)' : 'CHECK (use if fresh)'}`)
  console.log('='.repeat(60))
  
  if (!ODDS_API_KEY) {
    console.error('❌ ODDS_API_KEY not found in .env.local')
    console.error('   Get one at https://the-odds-api.com/clients/dashboard')
    process.exit(1)
  }
  
  try {
    const sports = sport === 'all' ? Object.keys(SPORTS) : [sport]
    
    for (const s of sports) {
      // 1. Fetch and save game odds
      const games = await fetchGameOdds(s, date)
      if (!dryRun && games.length > 0) {
        await saveGameOdds(games, s)
      }
      
      // 2. Fetch and save player props (using The Odds API event IDs from games)
      const gameProps = await fetchPlayerProps(s, date, games)
      if (!dryRun && gameProps.length > 0) {
        await savePlayerProps(gameProps, s)
      }
    }
    
    console.log('\n' + '='.repeat(60))
    console.log(`✅ Complete! API calls used: ${apiCallsToday}`)
    console.log(`📊 Remaining quota: ~${500 - apiCallsToday} calls this month`)
    console.log('='.repeat(60))
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message)
    process.exit(1)
  }
}

main()
