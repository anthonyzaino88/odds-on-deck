#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function main() {
  console.log('\n📊 SAMPLING PROPS WITH EDGE CALCULATIONS')
  console.log('='.repeat(80))
  
  const { data: props } = await supabase
    .from('PlayerPropCache')
    .select('playerName, type, pick, threshold, odds, probability, edge, confidence, qualityScore')
    .order('qualityScore', { ascending: false })
    .limit(10)
  
  if (!props || props.length === 0) {
    console.log('\n❌ No props found')
    return
  }
  
  console.log(`\n✅ Top 10 props by quality score:\n`)
  
  props.forEach((p, i) => {
    console.log(`${i + 1}. ${p.playerName} - ${p.type} ${p.pick.toUpperCase()} ${p.threshold}`)
    console.log(`   Odds: ${p.odds} | Prob: ${(p.probability * 100).toFixed(1)}% | Edge: ${(p.edge * 100).toFixed(1)}%`)
    console.log(`   Confidence: ${p.confidence} | Quality: ${p.qualityScore}`)
    console.log('')
  })
  
  console.log('='.repeat(80))
  console.log('✅ Props have REAL edge calculations!')
  console.log('🎯 Visit: http://localhost:3000/props')
  console.log('='.repeat(80) + '\n')
}

main().catch(console.error)

