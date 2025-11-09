#!/usr/bin/env node
// Calculate betting edges for today's games and store in EdgeSnapshot table

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { calculateGameEdges } from '../lib/edge.js' // MLB model
import { calculateNFLNHLEdges } from '../lib/edge-nfl-nhl.js' // NFL/NHL model
import crypto from 'crypto'

config({ path: '.env.local' })

// Helper to generate unique IDs
function generateId() {
  return crypto.randomBytes(12).toString('base64url')
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

console.log('\n🎲 Calculating Game Edges for Today\'s Games...\n')

async function calculateEdgesForToday() {
  try {
    // Get today's games
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    const { data: games, error: gamesError } = await supabase
      .from('Game')
      .select(`
        id,
        sport,
        date,
        status,
        homeId,
        awayId,
        home:Team!Game_homeId_fkey(*),
        away:Team!Game_awayId_fkey(*),
        probableHomePitcher:Player!Game_probableHomePitcherId_fkey(*),
        probableAwayPitcher:Player!Game_probableAwayPitcherId_fkey(*)
      `)
      .in('status', ['scheduled', 'pre-game', 'pre_game', 'warmup', 'in_progress'])
      .gte('date', today.toISOString())
      .lt('date', tomorrow.toISOString())
      .order('date')
    
    if (gamesError) {
      console.error('❌ Error fetching games:', gamesError)
      return
    }
    
    if (!games || games.length === 0) {
      console.log('⚠️  No games found for today')
      return
    }
    
    console.log(`📊 Found ${games.length} games to process\n`)
    
    let processed = 0
    let errors = 0
    
    for (const game of games) {
      try {
        console.log(`\n🎯 Processing: ${game.away?.abbr} @ ${game.home?.abbr} (${game.sport.toUpperCase()})`)
        
        // Get latest odds for this game
        const { data: odds, error: oddsError } = await supabase
          .from('Odds')
          .select('*')
          .eq('gameId', game.id)
          .order('ts', { ascending: false })
          .limit(10)
        
        if (oddsError) {
          console.error(`  ❌ Error fetching odds:`, oddsError)
          errors++
          continue
        }
        
        if (!odds || odds.length === 0) {
          console.log(`  ⚠️  No odds data available - skipping`)
          continue
        }
        
        // Calculate edges using the appropriate model for the sport
        let edges
        if (game.sport === 'mlb') {
          // Use MLB-specific model with pitchers, park factors, etc.
          edges = calculateGameEdges(game, odds)
        } else if (game.sport === 'nfl' || game.sport === 'nhl') {
          // Use NFL/NHL model based on team performance and recent form
          edges = calculateNFLNHLEdges(game, odds)
        } else {
          console.log(`  ⚠️  No model available for sport: ${game.sport}`)
          continue
        }
        
        // Store in EdgeSnapshot table (use only columns that exist)
        const edgeSnapshot = {
          id: generateId(),
          gameId: game.id,
          edgeMlHome: edges.edgeMlHome,
          edgeMlAway: edges.edgeMlAway,
          edgeTotalO: edges.edgeTotalO,
          edgeTotalU: edges.edgeTotalU,
          modelRun: edges.modelRun || 'v0.1.0'
        }
        
        const { error: insertError } = await supabase
          .from('EdgeSnapshot')
          .insert(edgeSnapshot)
        
        if (insertError) {
          console.error(`  ❌ Error saving edges:`, insertError)
          errors++
          continue
        }
        
        // Log results
        if (!edges.edgeMlHome && !edges.edgeMlAway && !edges.edgeTotalO && !edges.edgeTotalU) {
          console.log(`  ℹ️  No significant edges found (all below 2% threshold)`)
        } else {
          console.log(`  ✅ Edges calculated and saved:`)
          if (edges.edgeMlHome) {
            console.log(`     Home ML: ${(edges.edgeMlHome * 100).toFixed(1)}% edge`)
          }
          if (edges.edgeMlAway) {
            console.log(`     Away ML: ${(edges.edgeMlAway * 100).toFixed(1)}% edge`)
          }
          if (edges.edgeTotalO) {
            console.log(`     Over: ${(edges.edgeTotalO * 100).toFixed(1)}% edge`)
          }
          if (edges.edgeTotalU) {
            console.log(`     Under: ${(edges.edgeTotalU * 100).toFixed(1)}% edge`)
          }
        }
        
        processed++
        
      } catch (error) {
        console.error(`  ❌ Error processing game:`, error.message)
        errors++
      }
    }
    
    console.log(`\n📊 Summary:`)
    console.log(`   ✅ Processed: ${processed} games`)
    console.log(`   ❌ Errors: ${errors}`)
    console.log(`\n✅ Edge calculation complete!\n`)
    
  } catch (error) {
    console.error('❌ Fatal error:', error)
  }
}

// Run the calculation
calculateEdgesForToday()

