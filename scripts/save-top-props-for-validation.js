#!/usr/bin/env node
// Automatically save top quality player props from cache to validation system
// Run daily before games start to track performance of our best picks

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

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
    
    // Tier 1: Elite props (top 100) - by quality score only
    const { data: eliteProps } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .eq('isStale', false)
      .gte('expiresAt', now)
      .gte('qualityScore', 35)  // Top quality props
      .order('qualityScore', { ascending: false })
      .order('probability', { ascending: false })
      .limit(100)
    
    // Tier 2: High-quality props (next 100) - by probability
    const { data: highProps } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .eq('isStale', false)
      .gte('expiresAt', now)
      .gte('probability', 0.50) // 50%+ win probability
      .gte('qualityScore', 30)  // Decent quality
      .lt('qualityScore', 35)   // But not top tier
      .order('probability', { ascending: false })
      .order('qualityScore', { ascending: false })
      .limit(100)
    
    // Tier 3: Good props (next 100) - balanced approach
    const { data: goodProps } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .eq('isStale', false)
      .gte('expiresAt', now)
      .gte('probability', 0.48) // 48%+ win probability
      .gte('qualityScore', 25)  // Reasonable quality
      .lt('qualityScore', 30)
      .order('qualityScore', { ascending: false })
      .limit(100)
    
    // Tier 4: Additional props for broader coverage (next 50)
    const { data: additionalProps } = await supabase
      .from('PlayerPropCache')
      .select('*')
      .eq('isStale', false)
      .gte('expiresAt', now)
      .gte('probability', 0.45) // 45%+ win probability
      .gte('qualityScore', 20)  // Minimum quality
      .lt('qualityScore', 25)
      .order('qualityScore', { ascending: false })
      .limit(50)
    
    // Combine all tiers and deduplicate by propId
    const allPropsMap = new Map()
    
    ;[...(eliteProps || []), ...(highProps || []), ...(goodProps || []), ...(additionalProps || [])].forEach(prop => {
      if (!allPropsMap.has(prop.propId)) {
        allPropsMap.set(prop.propId, prop)
      }
    })
    
    const allProps = Array.from(allPropsMap.values())
    
    if (allProps.length === 0) {
      console.log('⚠️  No props found to validate')
      return
    }
    
    console.log('📊 Props by tier:')
    console.log(`   🏆 Elite (Q35+): ${eliteProps?.length || 0}`)
    console.log(`   ⭐ High (Q30-34, P50+): ${highProps?.length || 0}`)
    console.log(`   ✅ Good (Q25-29, P48+): ${goodProps?.length || 0}`)
    console.log(`   📋 Additional (Q20-24, P45+): ${additionalProps?.length || 0}`)
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
        
        // Save to validation system directly
        const validationData = {
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
          qualityScore: calculateQualityScore({
            probability: prop.probability,
            edge: prop.edge,
            confidence: prop.confidence
          }),
          source: 'system_generated',
          parlayId: null,
          status: 'pending',
          sport: prop.sport,
          timestamp: new Date().toISOString()
        }
        
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

