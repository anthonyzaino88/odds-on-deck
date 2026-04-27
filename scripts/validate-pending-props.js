#!/usr/bin/env node
/**
 * VALIDATE PENDING PROPS (Standalone - no dev server required)
 * 
 * Checks all pending validations against actual game stats.
 * Works for MLB, NHL, and NFL.
 * 
 * Optimized: pre-loads all game data, processes all pending in one run,
 * retries failed stat lookups before marking needs_review.
 * 
 * Usage:
 *   node scripts/validate-pending-props.js          # validate all sports
 *   node scripts/validate-pending-props.js mlb      # validate MLB only
 *   node scripts/validate-pending-props.js --limit 500
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { getPlayerGameStat as getMLBStat, fetchMLBGameStats } from '../lib/vendors/mlb-game-stats.js'
import { getPlayerGameStat as getNFLStat } from '../lib/vendors/nfl-game-stats.js'
import { getPlayerGameStat as getNHLStat } from '../lib/vendors/nhl-game-stats.js'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function main() {
  const args = process.argv.slice(2)
  const sportFilter = args.find(a => ['mlb', 'nhl', 'nfl'].includes(a.toLowerCase()))
  const limitArg = args.indexOf('--limit')
  const limit = limitArg >= 0 ? parseInt(args[limitArg + 1]) || 1000 : 1000

  console.log('\n🔍 VALIDATE PENDING PROPS')
  console.log('='.repeat(70))
  console.log(`Sport filter: ${sportFilter || 'all'}`)
  console.log(`Batch limit: ${limit}`)
  console.log('='.repeat(70))

  // Step 1: Fetch all pending validations
  let query = supabase
    .from('PropValidation')
    .select('*')
    .eq('status', 'pending')
    .order('timestamp', { ascending: true })
    .limit(limit)

  if (sportFilter) query = query.eq('sport', sportFilter)

  const { data: pending, error } = await query
  if (error) { console.error('❌ Query error:', error.message); process.exit(1) }

  if (!pending || pending.length === 0) {
    console.log('\n✅ No pending validations!')
    process.exit(0)
  }

  // Step 2: Pre-load all referenced games in one batch query
  const gameIds = [...new Set(pending.map(v => v.gameIdRef).filter(Boolean))]
  console.log(`\n📦 Pre-loading ${gameIds.length} referenced games...`)

  const gameMap = new Map()
  
  // Batch fetch games by ID (Supabase .in() max is ~300, so chunk it)
  for (let i = 0; i < gameIds.length; i += 200) {
    const chunk = gameIds.slice(i, i + 200)
    const { data: games } = await supabase
      .from('Game')
      .select('*')
      .in('id', chunk)
    
    if (games) games.forEach(g => gameMap.set(g.id, g))
  }

  // Also try to match by mlbGameId and espnGameId for any not found by primary ID
  const missingIds = gameIds.filter(id => !gameMap.has(id))
  if (missingIds.length > 0) {
    for (let i = 0; i < missingIds.length; i += 200) {
      const chunk = missingIds.slice(i, i + 200)
      
      const { data: mlbMatches } = await supabase
        .from('Game')
        .select('*')
        .in('mlbGameId', chunk)
      if (mlbMatches) mlbMatches.forEach(g => gameMap.set(g.mlbGameId, g))

      const { data: espnMatches } = await supabase
        .from('Game')
        .select('*')
        .in('espnGameId', chunk)
      if (espnMatches) espnMatches.forEach(g => gameMap.set(g.espnGameId, g))
    }
  }

  console.log(`✅ Loaded ${gameMap.size} games`)

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(23, 59, 59, 999)

  // Step 3: Separate into processable vs skippable
  const toProcess = []
  let skippedNotFinal = 0
  let noGameFound = 0

  for (const v of pending) {
    const game = gameMap.get(v.gameIdRef)
    if (!game) {
      noGameFound++
      toProcess.push({ validation: v, game: null })
      continue
    }

    const gameDate = new Date(game.date)
    const isFinal =
      ['final', 'completed', 'f', 'closed'].includes(game.status?.toLowerCase()) ||
      (gameDate < yesterday)

    if (!isFinal) {
      skippedNotFinal++
      continue
    }

    toProcess.push({ validation: v, game })
  }

  console.log(`\n📊 ${pending.length} total pending:`)
  console.log(`   ${toProcess.length} ready to process (${noGameFound} missing games)`)
  console.log(`   ${skippedNotFinal} skipped (games not yet final)\n`)

  // Step 4: Process validations
  let correct = 0, incorrect = 0, pushes = 0, errors = 0, needsReview = 0

  for (let i = 0; i < toProcess.length; i++) {
    const { validation: v, game } = toProcess[i]
    const prefix = `[${i + 1}/${toProcess.length}]`

    try {
      if (!game) {
        await supabase.from('PropValidation').update({
          status: 'needs_review',
          notes: 'Game not found in database',
          completedAt: new Date().toISOString()
        }).eq('id', v.id)
        needsReview++
        console.log(`${prefix} ⚠️  ${v.playerName} - game not found (${v.gameIdRef})`)
        continue
      }

      const sport = v.sport || game.sport
      let actualValue = null

      // Attempt to fetch the stat, with one retry on failure
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (sport === 'mlb') {
            if (!game.mlbGameId) break
            actualValue = await getMLBStat(game.mlbGameId, v.playerName, v.propType)
          } else if (sport === 'nhl') {
            if (!game.espnGameId) break
            actualValue = await getNHLStat(game.espnGameId, v.playerName, v.propType, v.gameIdRef)
          } else if (sport === 'nfl') {
            if (!game.espnGameId) break
            actualValue = await getNFLStat(game.espnGameId, v.playerName, v.propType)
          }
        } catch (fetchErr) {
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 500))
            continue
          }
        }
        if (actualValue !== null && actualValue !== undefined) break
        if (attempt === 0) await new Promise(r => setTimeout(r, 500))
      }

      if (actualValue === null || actualValue === undefined) {
        const missingField = sport === 'mlb' ? !game.mlbGameId : !game.espnGameId
        const reason = missingField ? `No ${sport === 'mlb' ? 'mlbGameId' : 'espnGameId'}` : 'Stat not found in API'
        await supabase.from('PropValidation').update({
          status: 'needs_review',
          notes: reason,
          completedAt: new Date().toISOString()
        }).eq('id', v.id)
        needsReview++
        console.log(`${prefix} ⚠️  ${v.playerName} ${v.propType} - ${reason}`)
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

      // Smaller delay between API calls to avoid rate limiting
      await new Promise(r => setTimeout(r, 150))
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
  console.log(`⏭️  Not Final Yet: ${skippedNotFinal}`)
  console.log(`💥 Errors:        ${errors}`)
  console.log(`📈 Accuracy:      ${accuracy}% (${correct}/${total})`)

  // ── Archive box scores for completed games ───────────────────────────
  const completedGameIds = [...new Set(
    toProcess
      .filter(({ game }) => game)
      .map(({ game }) => game.id)
  )]

  if (completedGameIds.length > 0) {
    console.log(`\n📦 Archiving box scores for ${completedGameIds.length} games...`)
    let archivedGames = 0

    for (const gid of completedGameIds) {
      const game = gameMap.get(gid)
      if (!game) continue

      // Skip if already archived
      const { count } = await supabase
        .from('GameBoxScore')
        .select('*', { count: 'exact', head: true })
        .eq('game_id', gid)
      if (count && count > 0) continue

      const sport = game.sport || 'mlb'
      try {
        if (sport === 'mlb' && game.mlbGameId) {
          const allStats = await fetchMLBGameStats(game.mlbGameId)
          if (allStats) {
            const rows = Object.entries(allStats).map(([name, stats]) => ({
              game_id: gid,
              sport: 'mlb',
              player_name: name,
              team: null,
              stats,
            }))
            if (rows.length > 0) {
              const { error: bsErr } = await supabase.from('GameBoxScore').insert(rows)
              if (!bsErr) { archivedGames++; console.log(`  ✅ Archived ${rows.length} player stats for ${gid}`) }
              else console.log(`  ⚠️  ${gid}: ${bsErr.message}`)
            }
          }
        }
        // NHL and NFL box score archival can be added when vendor functions support full-game fetch
      } catch (bsError) {
        console.log(`  ⚠️  Box score fetch failed for ${gid}: ${bsError.message}`)
      }
      await new Promise(r => setTimeout(r, 200))
    }
    console.log(`  📦 Archived box scores for ${archivedGames} games`)
  }

  const { count: remainingPending } = await supabase
    .from('PropValidation')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
  console.log(`\n⏳ Remaining pending: ${remainingPending}`)
  console.log('='.repeat(70) + '\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
