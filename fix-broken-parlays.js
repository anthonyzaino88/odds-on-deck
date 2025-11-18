import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import crypto from 'crypto'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function generateId() {
  return crypto.randomBytes(12).toString('base64url')
}

async function fixBrokenParlays() {
  try {
    console.log('🔧 Fixing broken parlays that lack PropValidation records...\n')

    // Get all pending parlays
    const { data: pendingParlays } = await supabase
      .from('Parlay')
      .select('id, sport, createdAt')
      .eq('status', 'pending')
      .order('createdAt', { ascending: false })

    console.log(`Found ${pendingParlays.length} pending parlays`)

    for (const parlay of pendingParlays) {
      console.log(`\nChecking parlay ${parlay.id} (${parlay.sport})`)

      // Get parlay legs
      const { data: legs } = await supabase
        .from('ParlayLeg')
        .select('*')
        .eq('parlayId', parlay.id)

      if (!legs || legs.length === 0) {
        console.log(`  ❌ No legs found - deleting orphaned parlay`)
        await supabase.from('Parlay').delete().eq('id', parlay.id)
        continue
      }

      console.log(`  Has ${legs.length} legs`)

      let missingValidations = 0
      let createdValidations = 0

      // Check each leg
      for (const leg of legs) {
        // Check if validation exists for this parlay leg
        const { data: existing } = await supabase
          .from('PropValidation')
          .select('id')
          .eq('parlayId', parlay.id)
          .eq('playerName', leg.playerName)
          .eq('propType', leg.propType)

        if (existing && existing.length > 0) {
          // Validation exists
          continue
        }

        missingValidations++

        // Find a template validation to copy from
        const { data: template } = await supabase
          .from('PropValidation')
          .select('*')
          .eq('playerName', leg.playerName)
          .eq('gameIdRef', leg.gameIdRef)
          .eq('propType', leg.propType)
          .limit(1)
          .maybeSingle()

        if (!template) {
          console.log(`  ❌ No template found for ${leg.playerName} ${leg.propType}`)
          continue
        }

        // Create new validation record
        const newValidation = {
          id: generateId(),
          propId: `${template.propId}_parlay_${parlay.id}`,
          gameIdRef: template.gameIdRef,
          playerName: template.playerName,
          propType: template.propType,
          threshold: template.threshold,
          prediction: template.prediction,
          projectedValue: template.projectedValue,
          confidence: template.confidence,
          edge: template.edge,
          odds: template.odds,
          probability: template.probability,
          qualityScore: template.qualityScore,
          source: 'parlay_leg',
          parlayId: parlay.id,
          status: template.status,
          result: template.result,
          actualValue: template.actualValue,
          completedAt: template.completedAt,
          sport: template.sport,
          timestamp: template.timestamp
        }

        const { error } = await supabase
          .from('PropValidation')
          .insert([newValidation])

        if (error) {
          console.log(`  ❌ Error creating validation: ${error.message}`)
        } else {
          createdValidations++
          console.log(`  ✅ Created validation for ${leg.playerName} ${leg.propType}`)
        }
      }

      console.log(`  Summary: ${missingValidations} missing, ${createdValidations} created`)

      // If all validations now exist, this parlay should be validatable
      if (missingValidations === 0 || createdValidations > 0) {
        console.log(`  ✅ Parlay ${parlay.id} should now be validatable`)
      }
    }

    console.log('\n🎯 Run parlay validation to clean up these fixed parlays!')

  } catch (e) {
    console.log('Error:', e.message)
  }
}

fixBrokenParlays()
