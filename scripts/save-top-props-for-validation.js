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
      .limit(50)
    
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
      .limit(75)
    
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
      .limit(75)
    
    // Combine all tiers
    const allProps = [
      ...(eliteProps || []),
      ...(highProps || []),
      ...(goodProps || [])
    ]
    
    if (allProps.length === 0) {
      console.log('⚠️  No props found to validate')
      return
    }
    
    console.log('📊 Props by tier:')
    console.log(`   🏆 Elite (Q40+, P60+): ${eliteProps?.length || 0}`)
    console.log(`   ⭐ High (Q35-39, P55+): ${highProps?.length || 0}`)
    console.log(`   ✅ Good (Q30-34, P52+): ${goodProps?.length || 0}`)
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

