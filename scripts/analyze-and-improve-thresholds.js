#!/usr/bin/env node
/**
 * Auto-Learning Script: Analyze validation results and recommend threshold improvements
 * 
 * This script:
 * 1. Analyzes prop performance by type, sport, tier, and quality score range
 * 2. Identifies which thresholds are working and which aren't
 * 3. Outputs recommended adjustments for the prop selection system
 * 
 * Run: node scripts/analyze-and-improve-thresholds.js
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const BREAK_EVEN_RATE = 0.524 // 52.4% needed to break even at -110 odds

async function analyzeAndImprove() {
  console.log('\n🧠 AUTO-LEARNING ANALYSIS')
  console.log('='.repeat(70))
  console.log('Analyzing validation results to improve prop selection...\n')
  
  // Fetch all completed validations
  let allValidations = []
  let page = 0
  const pageSize = 1000
  
  while (true) {
    const { data, error } = await supabase
      .from('PropValidation')
      .select('*')
      .eq('status', 'completed')
      .range(page * pageSize, (page + 1) * pageSize - 1)
    
    if (error) throw error
    if (!data || data.length === 0) break
    
    allValidations = allValidations.concat(data)
    if (data.length < pageSize) break
    page++
  }
  
  console.log(`📊 Analyzing ${allValidations.length} completed validations...\n`)
  
  // =============================================
  // 1. ANALYZE BY QUALITY SCORE RANGES
  // =============================================
  console.log('📈 PERFORMANCE BY QUALITY SCORE RANGE')
  console.log('-'.repeat(70))
  
  const qualityRanges = [
    { name: '40+ (Elite)', min: 40, max: 100 },
    { name: '35-39 (High)', min: 35, max: 40 },
    { name: '30-34 (Good)', min: 30, max: 35 },
    { name: '25-29', min: 25, max: 30 },
    { name: '20-24', min: 20, max: 25 },
    { name: '<20', min: 0, max: 20 }
  ]
  
  const qualityAnalysis = []
  
  for (const range of qualityRanges) {
    const props = allValidations.filter(v => 
      (v.qualityScore || 0) >= range.min && 
      (v.qualityScore || 0) < range.max
    )
    
    const correct = props.filter(p => p.result === 'correct').length
    const incorrect = props.filter(p => p.result === 'incorrect').length
    const total = correct + incorrect
    const accuracy = total > 0 ? correct / total : 0
    const roi = total > 0 ? ((correct * 0.91) - incorrect) / total : 0
    
    qualityAnalysis.push({
      range: range.name,
      total,
      correct,
      incorrect,
      accuracy,
      roi,
      profitable: accuracy >= BREAK_EVEN_RATE
    })
    
    const status = accuracy >= BREAK_EVEN_RATE ? '✅' : '❌'
    console.log(`${status} ${range.name}: ${(accuracy * 100).toFixed(1)}% (${correct}-${incorrect}) ROI: ${(roi * 100).toFixed(1)}%`)
  }
  
  // =============================================
  // 2. ANALYZE BY SPORT
  // =============================================
  console.log('\n🏈 PERFORMANCE BY SPORT')
  console.log('-'.repeat(70))
  
  const sports = ['nfl', 'nhl', 'mlb']
  const sportAnalysis = {}
  
  for (const sport of sports) {
    const props = allValidations.filter(v => v.sport === sport)
    const correct = props.filter(p => p.result === 'correct').length
    const incorrect = props.filter(p => p.result === 'incorrect').length
    const total = correct + incorrect
    const accuracy = total > 0 ? correct / total : 0
    
    sportAnalysis[sport] = { total, correct, incorrect, accuracy }
    
    if (total > 0) {
      const status = accuracy >= BREAK_EVEN_RATE ? '✅' : '❌'
      console.log(`${status} ${sport.toUpperCase()}: ${(accuracy * 100).toFixed(1)}% (${correct}-${incorrect})`)
    }
  }
  
  // =============================================
  // 3. ANALYZE BY PROP TYPE
  // =============================================
  console.log('\n📋 TOP PERFORMING PROP TYPES')
  console.log('-'.repeat(70))
  
  const propTypeAnalysis = {}
  
  allValidations.forEach(v => {
    const key = `${v.sport?.toUpperCase() || 'UNK'} - ${v.propType}`
    if (!propTypeAnalysis[key]) {
      propTypeAnalysis[key] = { correct: 0, incorrect: 0, total: 0, sport: v.sport }
    }
    propTypeAnalysis[key].total++
    if (v.result === 'correct') propTypeAnalysis[key].correct++
    else if (v.result === 'incorrect') propTypeAnalysis[key].incorrect++
  })
  
  // Calculate accuracy and sort
  const propTypeArray = Object.entries(propTypeAnalysis)
    .map(([type, stats]) => ({
      type,
      ...stats,
      accuracy: stats.correct + stats.incorrect > 0 
        ? stats.correct / (stats.correct + stats.incorrect) 
        : 0
    }))
    .filter(p => p.correct + p.incorrect >= 10) // Minimum 10 samples
    .sort((a, b) => b.accuracy - a.accuracy)
  
  // Top 5 performing
  console.log('\n🏆 Best Performing (prioritize these):')
  propTypeArray.slice(0, 5).forEach(p => {
    const status = p.accuracy >= BREAK_EVEN_RATE ? '✅' : '⚠️'
    console.log(`   ${status} ${p.type}: ${(p.accuracy * 100).toFixed(1)}% (${p.correct}-${p.incorrect})`)
  })
  
  // Bottom 5 performing
  console.log('\n⚠️ Worst Performing (avoid or fix):')
  propTypeArray.slice(-5).reverse().forEach(p => {
    const status = p.accuracy >= BREAK_EVEN_RATE ? '✅' : '❌'
    console.log(`   ${status} ${p.type}: ${(p.accuracy * 100).toFixed(1)}% (${p.correct}-${p.incorrect})`)
  })
  
  // =============================================
  // 4. ANALYZE BY TIER (from notes field)
  // =============================================
  console.log('\n🎯 PERFORMANCE BY TIER')
  console.log('-'.repeat(70))
  
  const tierAnalysis = { elite: { c: 0, i: 0 }, high: { c: 0, i: 0 }, good: { c: 0, i: 0 }, unknown: { c: 0, i: 0 } }
  
  allValidations.forEach(v => {
    let tier = 'unknown'
    if (v.notes?.includes('tier:elite')) tier = 'elite'
    else if (v.notes?.includes('tier:high')) tier = 'high'
    else if (v.notes?.includes('tier:good')) tier = 'good'
    
    if (v.result === 'correct') tierAnalysis[tier].c++
    else if (v.result === 'incorrect') tierAnalysis[tier].i++
  })
  
  for (const [tier, stats] of Object.entries(tierAnalysis)) {
    const total = stats.c + stats.i
    if (total > 0) {
      const accuracy = stats.c / total
      const status = accuracy >= BREAK_EVEN_RATE ? '✅' : '❌'
      console.log(`${status} ${tier.toUpperCase()}: ${(accuracy * 100).toFixed(1)}% (${stats.c}-${stats.i})`)
    }
  }
  
  // =============================================
  // 5. GENERATE RECOMMENDATIONS
  // =============================================
  console.log('\n💡 RECOMMENDED IMPROVEMENTS')
  console.log('='.repeat(70))
  
  const recommendations = []
  
  // Analyze quality score effectiveness
  const profitableRanges = qualityAnalysis.filter(q => q.profitable && q.total >= 20)
  const unprofitableRanges = qualityAnalysis.filter(q => !q.profitable && q.total >= 20)
  
  if (profitableRanges.length > 0) {
    const bestRange = profitableRanges[0]
    recommendations.push({
      priority: 'HIGH',
      action: `INCREASE minimum quality score threshold`,
      reason: `Quality scores ${bestRange.range} are profitable at ${(bestRange.accuracy * 100).toFixed(1)}%`,
      suggestion: `Consider only including props with quality score ≥ ${bestRange.range.match(/\d+/)?.[0] || 40}`
    })
  }
  
  // Analyze sport performance
  for (const [sport, stats] of Object.entries(sportAnalysis)) {
    if (stats.total >= 50 && stats.accuracy < BREAK_EVEN_RATE - 0.03) {
      recommendations.push({
        priority: 'MEDIUM',
        action: `Increase ${sport.toUpperCase()} quality thresholds`,
        reason: `${sport.toUpperCase()} is underperforming at ${(stats.accuracy * 100).toFixed(1)}%`,
        suggestion: `Require higher quality scores for ${sport.toUpperCase()} props`
      })
    }
  }
  
  // Analyze prop types to avoid
  const badPropTypes = propTypeArray.filter(p => p.accuracy < 0.45 && p.total >= 15)
  badPropTypes.forEach(p => {
    recommendations.push({
      priority: 'HIGH',
      action: `AVOID or heavily filter "${p.type}" props`,
      reason: `Only ${(p.accuracy * 100).toFixed(1)}% accuracy over ${p.total} props`,
      suggestion: `Either exclude this prop type or require much higher confidence`
    })
  })
  
  // Print recommendations
  recommendations.forEach((rec, idx) => {
    console.log(`\n${idx + 1}. [${rec.priority}] ${rec.action}`)
    console.log(`   Reason: ${rec.reason}`)
    console.log(`   Suggestion: ${rec.suggestion}`)
  })
  
  // =============================================
  // 6. EXPORT ADJUSTMENTS FILE
  // =============================================
  console.log('\n📁 EXPORTING ADJUSTMENTS')
  console.log('-'.repeat(70))
  
  const adjustments = {
    generatedAt: new Date().toISOString(),
    sampleSize: allValidations.length,
    overallAccuracy: (() => {
      const c = allValidations.filter(v => v.result === 'correct').length
      const i = allValidations.filter(v => v.result === 'incorrect').length
      return c / (c + i)
    })(),
    
    // Quality score thresholds
    qualityThresholds: {
      elite: { minScore: 40, minProbability: 0.60, recommended: profitableRanges.some(r => r.range.includes('40')) },
      high: { minScore: 35, minProbability: 0.55, recommended: profitableRanges.some(r => r.range.includes('35')) },
      good: { minScore: 30, minProbability: 0.52, recommended: profitableRanges.some(r => r.range.includes('30')) }
    },
    
    // Prop type adjustments
    propTypeBoosts: Object.fromEntries(
      propTypeArray
        .filter(p => p.accuracy >= BREAK_EVEN_RATE && p.total >= 15)
        .map(p => [p.type, { boost: 1.2, accuracy: p.accuracy }])
    ),
    
    propTypePenalties: Object.fromEntries(
      propTypeArray
        .filter(p => p.accuracy < 0.45 && p.total >= 15)
        .map(p => [p.type, { penalty: 0.7, accuracy: p.accuracy }])
    ),
    
    // Sport adjustments
    sportAdjustments: Object.fromEntries(
      Object.entries(sportAnalysis)
        .filter(([_, stats]) => stats.total >= 50)
        .map(([sport, stats]) => [
          sport, 
          { 
            accuracy: stats.accuracy,
            multiplier: stats.accuracy >= BREAK_EVEN_RATE ? 1.0 : 0.9
          }
        ])
    )
  }
  
  // Save to file
  const fs = await import('fs')
  fs.writeFileSync(
    'config/learned-adjustments.json',
    JSON.stringify(adjustments, null, 2)
  )
  
  console.log('✅ Saved adjustments to config/learned-adjustments.json')
  
  // =============================================
  // SUMMARY
  // =============================================
  console.log('\n' + '='.repeat(70))
  console.log('📊 SUMMARY')
  console.log('='.repeat(70))
  console.log(`Total validations analyzed: ${allValidations.length}`)
  console.log(`Overall accuracy: ${(adjustments.overallAccuracy * 100).toFixed(1)}%`)
  console.log(`Break-even needed: 52.4%`)
  console.log(`Status: ${adjustments.overallAccuracy >= BREAK_EVEN_RATE ? '✅ PROFITABLE' : '❌ NEEDS IMPROVEMENT'}`)
  console.log(`Recommendations generated: ${recommendations.length}`)
  console.log(`Prop types to boost: ${Object.keys(adjustments.propTypeBoosts).length}`)
  console.log(`Prop types to penalize: ${Object.keys(adjustments.propTypePenalties).length}`)
  console.log('='.repeat(70) + '\n')
}

// Make sure config directory exists
import { mkdirSync, existsSync } from 'fs'
if (!existsSync('config')) {
  mkdirSync('config')
}

analyzeAndImprove().catch(console.error)

