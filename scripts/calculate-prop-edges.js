#!/usr/bin/env node

/**
 * CALCULATE PROP EDGES - HONEST VERSION
 * 
 * Takes raw props from PlayerPropCache and calculates:
 * - Implied probability from odds (REAL - from bookmaker)
 * - Vig-adjusted probability (HONEST - accounts for bookmaker margin)
 * - Quality score based on odds value
 * 
 * IMPORTANT: This script does NOT claim fake edges.
 * Real edge requires either:
 *   1. Line shopping (comparing multiple bookmakers) - use find-real-value-props.js
 *   2. Player projections (requires stats data we don't have)
 * 
 * Without real data, we HONESTLY show 0% edge.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { calculateQualityScore } from '../lib/quality-score.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

/**
 * Convert decimal odds to implied probability
 */
function decimalToImpliedProbability(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return 0.5
  return 1 / decimalOdds
}

/**
 * Convert American odds to implied probability
 */
function americanToImpliedProbability(americanOdds) {
  if (americanOdds >= 0) {
    return 100 / (americanOdds + 100)
  } else {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)
  }
}

/**
 * Remove vig from probability to get fair probability
 * Standard sportsbook vig is ~4.5% (implied probs sum to ~104.5%)
 */
function removeVig(impliedProb) {
  // Assume ~4.5% vig, so fair prob = implied / 1.045
  return impliedProb / 1.045
}

/**
 * Get confidence level based on probability
 * HONEST: Based on actual win probability, not fake edge
 */
function getConfidence(probability) {
  if (probability >= 0.60) return 'high'      // 60%+ win chance
  if (probability >= 0.52) return 'medium'    // 52%+ (above break-even)
  if (probability >= 0.45) return 'low'       // 45%+ 
  return 'very_low'                           // Below 45%
}

async function main() {
  console.log('\n🧮 CALCULATING PROP VALUES (HONEST MODE)')
  console.log('='.repeat(80))
  console.log('⚠️  NOTE: This script does NOT claim fake edges.')
  console.log('   Edge = 0 unless we have real line shopping data.')
  console.log('   Use find-real-value-props.js to find REAL value.')
  console.log('='.repeat(80))
  
  // Fetch all props that need calculation
  console.log('\n📊 Fetching props from cache...')
  
  const { data: props, error } = await supabase
    .from('PlayerPropCache')
    .select('*')
    .eq('isStale', false)
  
  if (error) {
    console.error('❌ Error fetching props:', error)
    return
  }
  
  if (!props || props.length === 0) {
    console.log('✅ No props found in cache')
    return
  }
  
  console.log(`Found ${props.length} props to process\n`)
  
  let updated = 0
  let failed = 0
  
  for (const prop of props) {
    try {
      // Odds are stored as decimal in PlayerPropCache
      const decimalOdds = prop.odds
      
      // Calculate implied probability from odds (HONEST)
      const impliedProb = decimalToImpliedProbability(decimalOdds)
      
      // Remove vig to get fair probability
      const fairProb = removeVig(impliedProb)
      
      // HONEST: We have NO edge without real data
      // Edge would only come from:
      // 1. Line shopping (we have better odds than average)
      // 2. Our projection differs from line (we don't have projections)
      const edge = 0 // HONEST - no fake edges
      
      // Confidence based on win probability
      const confidence = getConfidence(fairProb)
      
      // Quality score based on fair probability (not fake edge)
      const qualityScore = calculateQualityScore({
        probability: fairProb,
        edge: edge,
        confidence: confidence
      })
      
      // Update prop in database
      const { error: updateError } = await supabase
        .from('PlayerPropCache')
        .update({
          probability: fairProb,
          edge: edge,
          confidence: confidence,
          qualityScore: qualityScore
        })
        .eq('id', prop.id)
      
      if (updateError) {
        failed++
      } else {
        updated++
        if (updated % 500 === 0) {
          console.log(`   Processed ${updated}/${props.length}...`)
        }
      }
      
    } catch (err) {
      console.error(`❌ Error processing prop ${prop.id}:`, err.message)
      failed++
    }
  }
  
  console.log('\n' + '='.repeat(80))
  console.log(`✅ Updated ${updated} props with HONEST values`)
  if (failed > 0) {
    console.log(`⚠️  Failed to update ${failed} props`)
  }
  
  // Show sample of props
  console.log('\n📊 Sample props (sorted by probability):')
  const { data: topProps } = await supabase
    .from('PlayerPropCache')
    .select('playerName, type, pick, threshold, odds, probability, edge, confidence, qualityScore')
    .eq('isStale', false)
    .order('probability', { ascending: false })
    .limit(5)
  
  if (topProps && topProps.length > 0) {
    topProps.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.playerName} - ${p.type} ${p.pick} ${p.threshold}`)
      console.log(`     Win Prob: ${(p.probability * 100).toFixed(1)}% | Edge: ${(p.edge * 100).toFixed(1)}% | Confidence: ${p.confidence}`)
    })
  }
  
  console.log('\n' + '='.repeat(80))
  console.log('💡 HOW TO FIND REAL EDGES:')
  console.log('   Run: node scripts/find-real-value-props.js nhl')
  console.log('   This compares odds across bookmakers to find REAL value.')
  console.log('='.repeat(80) + '\n')
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
