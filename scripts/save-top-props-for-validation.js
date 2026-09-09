#!/usr/bin/env node
// Automatically save top quality player props from cache to validation system
// Run daily before games start to track performance of our best picks

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { isJuiceTrap, attachNumBooks } from '../lib/juice-traps.js'
import { isPublishedEligibleProp } from '../lib/published-picks.js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Helper to generate unique IDs
function generateId() {
  return crypto.randomBytes(12).toString('base64url')
}

// Calculate quality score
function calculateQualityScore(metrics) {
  const prob = metrics.probability || 0.5
  const edge = metrics.edge || 0
  const conf = metrics.confidence || 'medium'
  
  const probScore = (prob - 0.5) * 100
  const edgeScore = edge * 100
  const confBonus = conf === 'high' ? 10 : conf === 'very_high' ? 20 : 0
  
  return Math.max(0, Math.min(100, probScore + edgeScore + confBonus))
}

console.log('\n📊 Saving Top Props for Validation...\n')

async function saveTopPropsForValidation() {
  try {
    const now = new Date().toISOString()
    
    // STRATEGY: Save props across multiple quality tiers for comprehensive validation
    // This gives us diverse data to improve the model
    
    console.log('🎯 Fetching props from multiple quality tiers...\n')
    
    // Tier 1: Elite props (top 50)
    // Based on actual quality scores in your system (max ~45)
    const { data: eliteProps } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .eq('isStale', false)
      .gte('expiresAt', now)
      .gte('probability', 0.60) // 60%+ win probability
      .gte('qualityScore', 40)  // Elite quality (top tier)
      .order('qualityScore', { ascending: false })
      .limit(200)
    
    // Tier 2: High-quality props (next 75)
    const { data: highProps } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .eq('isStale', false)
      .gte('expiresAt', now)
      .gte('probability', 0.55) // 55%+ win probability
      .gte('qualityScore', 35)  // High quality
      .lt('qualityScore', 40)   // But not elite
      .order('qualityScore', { ascending: false })
      .limit(200)
    
    // Tier 3: Good props (next 75)
    const { data: goodProps } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .eq('isStale', false)
      .gte('expiresAt', now)
      .gte('probability', 0.52) // 52%+ win probability
      .gte('qualityScore', 30)  // Good quality
      .lt('qualityScore', 35)   // But not high
      .order('qualityScore', { ascending: false })
      .limit(200)
    
    // Published-eligible first: QS ≥ 40 + edge > 0 can miss the elite
    // tier when probability < 0.60. Do not recalculate their QS.
    const { data: publishedProps } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .eq('isStale', false)
      .gte('expiresAt', now)
      .in('sport', ['mlb', 'nfl'])
      .gt('edge', 0)
      .gte('qualityScore', 40)
      .order('edge', { ascending: false })
      .limit(200)

    const publishedClean = (publishedProps || []).filter((prop) => isPublishedEligibleProp(prop))
    const publishedIds = new Set(publishedClean.map((prop) => prop.propId))

    // Drop juice traps first, then re-apply original per-tier caps
    const eliteClean = (eliteProps || []).filter((prop) => !isJuiceTrap(prop)).slice(0, 50)
    const eliteIds = new Set(eliteClean.map((prop) => prop.propId))
    const highClean = (highProps || []).filter((prop) => !isJuiceTrap(prop) && !eliteIds.has(prop.propId)).slice(0, 75)
    const highIds = new Set(highClean.map((prop) => prop.propId))
    const goodClean = (goodProps || []).filter((prop) => !isJuiceTrap(prop) && !eliteIds.has(prop.propId) && !highIds.has(prop.propId)).slice(0, 75)

    const allProps = [
      ...publishedClean,
      ...eliteClean.filter((prop) => !publishedIds.has(prop.propId)),
      ...highClean.filter((prop) => !publishedIds.has(prop.propId)),
      ...goodClean.filter((prop) => !publishedIds.has(prop.propId)),
    ]
    
    if (allProps.length === 0) {
      console.log('⚠️  No props found to validate')
      return
    }
    
    console.log('📊 Props by tier:')
    console.log(`   📌 Published (edge>0, Q40+, odds band): ${publishedClean.length}`)
    console.log(`   🏆 Elite (Q40+, P60+): ${eliteClean.length}`)
    console.log(`   ⭐ High (Q35-39, P55+): ${highClean.length}`)
    console.log(`   ✅ Good (Q30-34, P52+): ${goodClean.length}`)
    console.log(`   📈 Total: ${allProps.length}\n`)
    
    // Group by sport for visibility
    const bySport = allProps.reduce((acc, p) => {
      acc[p.sport] = (acc[p.sport] || 0) + 1
      return acc
    }, {})
    
    console.log('🏈 Props by sport:')
    Object.entries(bySport).forEach(([sport, count]) => {
      console.log(`   ${sport.toUpperCase()}: ${count}`)
    })
    console.log('')
    
    const props = allProps
    
    let saved = 0
    let skipped = 0
    let errors = 0
    
    for (const prop of props) {
      try {
        console.log(`📝 ${prop.playerName} - ${prop.type} ${prop.pick?.toUpperCase()} ${prop.threshold}`)
        console.log(`   Quality: ${prop.qualityScore?.toFixed(1)} | Prob: ${((prop.probability || 0) * 100).toFixed(0)}% | Edge: ${((prop.edge || 0) * 100).toFixed(1)}%`)
        
        // Check if already saved
        const { data: existing } = await supabase
          .from('PropValidation')
          .select('id')
          .eq('propId', prop.propId)
          .maybeSingle()
        
        if (existing) {
          console.log(`   ⏭️  Already saved for validation\n`)
          skipped++
          continue
        }
        
        // Verify game exists
        const { data: game, error: gameError } = await supabase
          .from('Game')
          .select('id, sport')
          .eq('id', prop.gameId)
          .maybeSingle()
        
        if (!game) {
          console.log(`   ⚠️  Game not found\n`)
          errors++
          continue
        }
        
        // Determine which tier this prop belongs to
        const isPublished = publishedIds.has(prop.propId)
        const tier = isPublished ? 'published' :
                     eliteClean.some(p => p.propId === prop.propId) ? 'elite' :
                     highClean.some(p => p.propId === prop.propId) ? 'high' : 'good'
        const cachedQuality = Number(prop.qualityScore)
        const qualityScore = Number.isFinite(cachedQuality)
          ? cachedQuality
          : calculateQualityScore({
              probability: prop.probability,
              edge: prop.edge,
              confidence: prop.confidence
            })
        
        // Save to validation system directly
        const validationData = attachNumBooks({
          id: generateId(),
          propId: prop.propId,
          gameIdRef: prop.gameId,
          playerName: prop.playerName,
          propType: prop.type,
          threshold: prop.threshold,
          prediction: prop.pick,
          projectedValue: prop.projection || 0,
          confidence: prop.confidence || 'medium',
          edge: prop.edge || 0,
          odds: prop.odds || null,
          probability: prop.probability || null,
          qualityScore,
          source: 'system_generated',
          parlayId: null,
          status: 'pending',
          sport: prop.sport,
          timestamp: new Date().toISOString(),
          notes: isPublished ? 'cohort:published' : `tier:${tier}`
        }, prop)
        
        const { data: validation, error: saveError } = await supabase
          .from('PropValidation')
          .insert(validationData)
          .select()
          .single()
        
        if (saveError) {
          console.log(`   ❌ Error: ${saveError.message}\n`)
          errors++
        } else {
          console.log(`   ✅ Saved for validation (ID: ${validation.id})\n`)
          saved++
        }
        
      } catch (error) {
        console.error(`   ❌ Error:`, error.message, '\n')
        errors++
      }
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('📊 Summary:')
    console.log(`   ✅ Saved: ${saved}`)
    console.log(`   ⏭️  Skipped (already saved): ${skipped}`)
    console.log(`   ❌ Errors: ${errors}`)
    console.log(`   📈 Total props to validate: ${saved + skipped}`)
    console.log('='.repeat(60) + '\n')
    
  } catch (error) {
    console.error('❌ Fatal error:', error)
  }
}

saveTopPropsForValidation()

