#!/usr/bin/env node
/**
 * VALIDATE PENDING PROPS (Standalone - no dev server required)
 * 
 * Checks all pending validations against actual game stats.
 * Works for MLB, NHL, and NFL.
 * 
 * Usage:
 *   node scripts/validate-pending-props.js          # validate all sports
 *   node scripts/validate-pending-props.js mlb      # validate MLB only
 *   node scripts/validate-pending-props.js --limit 20
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { getPlayerGameStat as getMLBStat } from '../lib/vendors/mlb-game-stats.js'
import { getPlayerGameStat as getNFLStat } from '../lib/vendors/nfl-game-stats.js'
import { getPlayerGameStat as getNHLStat } from '../lib/vendors/nhl-game-stats.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function findGame(validation) {
  const ref = validation.gameIdRef
  if (!ref) return null

  // Try by primary id first
  const { data: g1 } = await supabase.from('Game').select('*').eq('id', ref).maybeSingle()
  if (g1) return g1

  // Try by mlbGameId
  const { data: g2 } = await supabase.from('Game').select('*').eq('mlbGameId', ref).maybeSingle()
  if (g2) return g2

  // Try by espnGameId
  const { data: g3 } = await supabase.from('Game').select('*').eq('espnGameId', ref).maybeSingle()
  if (g3) return g3

  // Try by oddsApiEventId
  const { data: g4 } = await supabase.from('Game').select('*').eq('oddsApiEventId', ref).maybeSingle()
  if (g4) return g4

  return null
}

async function main() {
  const args = process.argv.slice(2)
  const sportFilter = args.find(a => ['mlb', 'nhl', 'nfl'].includes(a.toLowerCase()))
  const limitArg = args.indexOf('--limit')
  const limit = limitArg >= 0 ? parseInt(args[limitArg + 1]) || 100 : 200

  console.log('\n🔍 VALIDATE PENDING PROPS (Standalone)')
  console.log('='.repeat(70))
  console.log(`Sport filter: ${sportFilter || 'all'}`)
  console.log(`Batch limit: ${limit}`)
  console.log('='.repeat(70))

  let query = supabase
    .from('PropValidation')
    .select('*')
    .eq('status', 'pending')
    .order('timestamp', { ascending: true })
    .limit(limit)

  if (sportFilter) query = query.eq('sport', sportFilter)

  const { data: pending, error } = await query
  if (error) { console.error('❌ Query error:', error.message); process.exit(1) }

  const { count: totalPending } = await supabase
    .from('PropValidation')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  console.log(`\n📊 Processing ${pending?.length || 0} of ${totalPending} pending validations\n`)

  if (!pending || pending.length === 0) {
    console.log('✅ No pending validations!')
    process.exit(0)
  }

  let correct = 0, incorrect = 0, pushes = 0, skipped = 0, errors = 0, needsReview = 0

  for (let i = 0; i < pending.length; i++) {
    const v = pending[i]
    const prefix = `[${i + 1}/${pending.length}]`

    try {
      const game = await findGame(v)

      if (!game) {
        console.log(`${prefix} ⚠️  ${v.playerName} - game not found (${v.gameIdRef})`)
        await supabase.from('PropValidation').update({
          status: 'needs_review',
          notes: 'Game not found in database',
          completedAt: new Date().toISOString()
        }).eq('id', v.id)
        needsReview++
        continue
      }

      const gameDate = new Date(game.date)
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      yesterday.setHours(23, 59, 59, 999)

      const isFinal =
        ['final', 'completed', 'f', 'closed'].includes(game.status?.toLowerCase()) ||
        (gameDate < yesterday)

      if (!isFinal) {
        skipped++
        continue
      }

      const sport = v.sport || game.sport
      let actualValue = null

      if (sport === 'mlb') {
        if (!game.mlbGameId) {
          await supabase.from('PropValidation').update({
            status: 'needs_review', notes: 'No mlbGameId', completedAt: new Date().toISOString()
          }).eq('id', v.id)
          needsReview++
          continue
        }
        actualValue = await getMLBStat(game.mlbGameId, v.playerName, v.propType)
      } else if (sport === 'nhl') {
        if (!game.espnGameId) { needsReview++; continue }
        actualValue = await getNHLStat(game.espnGameId, v.playerName, v.propType, v.gameIdRef)
      } else if (sport === 'nfl') {
        if (!game.espnGameId) { needsReview++; continue }
        actualValue = await getNFLStat(game.espnGameId, v.playerName, v.propType)
      }

      if (actualValue === null || actualValue === undefined) {
        await supabase.from('PropValidation').update({
          status: 'needs_review', notes: 'Stat not found in API', completedAt: new Date().toISOString()
        }).eq('id', v.id)
        needsReview++
        continue
      }

      let result = 'incorrect'
      if (actualValue === v.threshold) result = 'push'
      else if (
        (v.prediction === 'over' && actualValue > v.threshold) ||
        (v.prediction === 'under' && actualValue < v.threshold)
      ) result = 'correct'

      await supabase.from('PropValidation').update({
        actualValue, result, status: 'completed', completedAt: new Date().toISOString(),
        notes: `Validated: ${v.prediction.toUpperCase()} ${v.threshold} → Actual: ${actualValue}`
      }).eq('id', v.id)

      if (result === 'correct') correct++
      else if (result === 'push') pushes++
      else incorrect++

      const emoji = result === 'correct' ? '✅' : result === 'push' ? '🟰' : '❌'
      console.log(`${prefix} ${emoji} ${v.playerName.padEnd(20)} ${v.propType.padEnd(22)} ${v.prediction} ${v.threshold} → actual: ${actualValue} (${result})`)

      await new Promise(r => setTimeout(r, 250))
    } catch (err) {
      console.error(`${prefix} ❌ Error: ${err.message}`)
      errors++
    }
  }

  const total = correct + incorrect + pushes
  const accuracy = total > 0 ? ((correct / total) * 100).toFixed(1) : 'N/A'

  console.log('\n' + '='.repeat(70))
  console.log('📊 VALIDATION RESULTS')
  console.log('='.repeat(70))
  console.log(`✅ Correct:       ${correct}`)
  console.log(`❌ Incorrect:     ${incorrect}`)
  console.log(`🟰 Push:          ${pushes}`)
  console.log(`⚠️  Needs Review:  ${needsReview}`)
  console.log(`⏭️  Skipped:       ${skipped} (games not yet final)`)
  console.log(`💥 Errors:        ${errors}`)
  console.log(`📈 Accuracy:      ${accuracy}% (${correct}/${total})`)

  const { count: remainingPending } = await supabase
    .from('PropValidation')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
  console.log(`\n⏳ Remaining pending: ${remainingPending}`)
  console.log('='.repeat(70) + '\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
