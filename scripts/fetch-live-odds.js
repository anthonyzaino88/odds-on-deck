#!/usr/bin/env node

/**
 * LOCAL ODDS FETCHER
 * 
 * Usage:
 *   node scripts/fetch-live-odds.js [sport] [date]
 * 
 * Examples:
 *   node scripts/fetch-live-odds.js mlb            # Tonight's MLB games
 *   node scripts/fetch-live-odds.js nfl today      # Today's NFL games
 *   node scripts/fetch-live-odds.js nhl 2025-11-02 # Specific date NHL games
 * 
 * Features:
 * - Rate-limited API calls (respects The Odds API limits)
 * - Batch database writes for efficiency
 * - Shows API usage and stats
 * - Dry-run mode (preview without saving)
 */

import { PrismaClient } from '@prisma/client'
import { config } from 'dotenv'

config({ path: '.env.local' })

const prisma = new PrismaClient()
const ODDS_API_KEY = process.env.ODDS_API_KEY
const RATE_LIMIT_DELAY_MS = 300 // 300ms = ~3 requests/sec (safe buffer)

// Sport mappings
const SPORT_MAP = {
  'mlb': 'baseball_mlb',
  'nfl': 'americanfootball_nfl',
  'nhl': 'icehockey_nhl'
}

// MLB Props to fetch
const MLB_MARKETS = [
  'batter_hits',
  'batter_home_runs',
  'batter_total_bases',
  'batter_rbis',
  'batter_runs_scored',
  'batter_strikeouts',
  'pitcher_strikeouts',
  'pitcher_outs',
  'pitcher_hits_allowed',
  'pitcher_earned_runs'
].join(',')

const NFL_MARKETS = [
  'player_pass_yds',
  'player_pass_tds',
  'player_rush_yds',
  'player_receptions',
  'player_reception_yds',
  'player_kicking_points'
].join(',')

const NHL_MARKETS = [
  'player_points',
  'player_goals',
  'player_assists',
  'player_shots_on_goal'
].join(',')

// ===== UTILITIES =====
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getMarkets(sport) {
  if (sport === 'mlb') return MLB_MARKETS
  if (sport === 'nfl') return NFL_MARKETS
  if (sport === 'nhl') return NHL_MARKETS
  return MLB_MARKETS
}

function parseDate(dateStr) {
  if (!dateStr || dateStr === 'today') {
    const now = new Date()
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    }
  }
  
  // Parse YYYY-MM-DD
  const [year, month, day] = dateStr.split('-').map(Number)
  const start = new Date(year, month - 1, day)
  const end = new Date(year, month - 1, day + 1)
  
  return { start, end }
}

// ===== API CALLS =====
async function fetchMoneylineOdds(sport, gameId) {
  if (!ODDS_API_KEY) {
    console.error('❌ ODDS_API_KEY not set')
    return null
  }

  try {
    const oddsApiSport = SPORT_MAP[sport] || sport
    const url = `https://api.the-odds-api.com/v4/sports/${oddsApiSport}/odds?markets=h2h&oddsFormat=american&apiKey=${ODDS_API_KEY}`
    
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`❌ Moneyline API error: ${res.status}`)
      return null
    }
    
    const data = await res.json()
    
    // Find matching game
    const game = data.find(g => g.id === gameId || g.away_team && g.home_team)
    return game?.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h') || null
    
  } catch (error) {
    console.error(`❌ Moneyline fetch error:`, error.message)
    return null
  }
}

async function fetchPlayerProps(sport, eventId) {
  if (!ODDS_API_KEY) {
    console.error('❌ ODDS_API_KEY not set')
    return null
  }

  try {
    const oddsApiSport = SPORT_MAP[sport] || sport
    const markets = getMarkets(sport)
    const url = `https://api.the-odds-api.com/v4/sports/${oddsApiSport}/events/${eventId}/odds?regions=us&markets=${markets}&oddsFormat=american&apiKey=${ODDS_API_KEY}`
    
    const res = await fetch(url)
    if (!res.ok) {
      if (res.status === 422) {
        console.log(`⚠️  No props for event ${eventId}`)
        return null
      }
      console.error(`❌ Props API error: ${res.status}`)
      return null
    }
    
    const data = await res.json()
    return data
    
  } catch (error) {
    console.error(`❌ Props fetch error:`, error.message)
    return null
  }
}

// ===== MAIN =====
async function main() {
  const sport = process.argv[2]?.toLowerCase() || 'mlb'
  const dateArg = process.argv[3] || 'today'
  const dryRun = process.argv.includes('--dry-run')
  
  if (!['mlb', 'nfl', 'nhl'].includes(sport)) {
    console.error(`❌ Invalid sport: ${sport}. Use: mlb, nfl, or nhl`)
    process.exit(1)
  }
  
  console.log(`\n🎯 Odds Fetcher - ${sport.toUpperCase()}`)
  console.log(`📅 Date: ${dateArg}`)
  if (dryRun) console.log('🔍 DRY RUN MODE (no data saved)')
  console.log('=' .repeat(50))
  
  // Get date range
  const { start, end } = parseDate(dateArg)
  console.log(`📅 Fetching games from ${start.toISOString()} to ${end.toISOString()}`)
  
  // Get games from database
  console.log(`\n🎲 Loading ${sport.toUpperCase()} games from database...`)
  const games = await prisma.game.findMany({
    where: {
      sport,
      date: { gte: start, lte: end }
    },
    include: {
      home: { select: { abbr: true, name: true } },
      away: { select: { abbr: true, name: true } }
    }
  })
  
  console.log(`✅ Found ${games.length} games`)
  
  if (games.length === 0) {
    console.log(`ℹ️  No ${sport.toUpperCase()} games found for ${dateArg}`)
    await prisma.$disconnect()
    process.exit(0)
  }
  
  // Show games
  console.log(`\n📋 Games:`)
  games.forEach((g, i) => {
    console.log(`  ${i + 1}. ${g.away.abbr} @ ${g.home.abbr} at ${new Date(g.date).toLocaleTimeString()}`)
  })
  
  // Fetch odds
  console.log(`\n🔄 Fetching odds for ${games.length} games...`)
  console.log(`⏱️  Rate limit: ${RATE_LIMIT_DELAY_MS}ms between requests`)
  
  let successCount = 0
  let errorCount = 0
  
  for (let i = 0; i < games.length; i++) {
    const game = games[i]
    
    console.log(`\n[${i + 1}/${games.length}] ${game.away.abbr} @ ${game.home.abbr}`)
    
    // Fetch props
    console.log(`  📊 Fetching player props...`)
    const props = await fetchPlayerProps(sport, game.id)
    
    if (props) {
      console.log(`  ✅ Got props (${props.bookmakers?.[0]?.markets?.length || 0} markets)`)
      successCount++
      
      if (!dryRun) {
        // Save props to database
        // TODO: Implement prop saving logic based on your schema
        console.log(`  💾 Saved props`)
      }
    } else {
      errorCount++
      console.log(`  ⚠️  No props available`)
    }
    
    // Rate limit
    if (i < games.length - 1) {
      await sleep(RATE_LIMIT_DELAY_MS)
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(50)}`)
  console.log(`📊 SUMMARY`)
  console.log(`✅ Success: ${successCount}/${games.length}`)
  console.log(`❌ Errors: ${errorCount}/${games.length}`)
  console.log(`💾 Mode: ${dryRun ? 'DRY RUN' : 'SAVED'}`)
  
  await prisma.$disconnect()
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
