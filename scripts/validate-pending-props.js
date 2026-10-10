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

import { createScriptSupabaseClient } from '../lib/supabase-script-client.js'
import { config } from 'dotenv'
import { lookupPlayerGameStat as lookupMLBStat, fetchMLBGameStats } from '../lib/vendors/mlb-game-stats.js'
import { getPlayerGameStat as getNFLStat } from '../lib/vendors/nfl-game-stats.js'
import { lookupPlayerGameStat as getNHLStat } from '../lib/vendors/nhl-game-stats.js'
import { isGradeableNhlStatResult, nhlGradeSourceFromResult } from '../lib/nhl-stat-grade.js'
import { appendJsonl, boxScoreArchiveRows, loadJsonlFieldSet, resolveBoxScoresDir, shouldArchiveBoxScore } from '../lib/local-archive.js'
import { propValidationGradeAudit, updateWithOptionalAudit } from '../lib/grade-audit.js'
import { planPlayerStatValidation } from '../lib/pending-props.js'
import { voidPropValidationPatch } from '../lib/game-grade-eligibility.js'
import { planPlayerAppearanceGrade, gradePropFromActual } from '../lib/player-stat-grade.js'

config({ path: '.env.local' })

const supabase = createScriptSupabaseClient()

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

  // Step 3: Separate into processable vs skippable.
  // Date-before-yesterday is not a final — postponed/cancelled 0-0
  // games used to slip through that shortcut and grade as actual=0.
  const toProcess = []
  const toVoid = []
  const toTimeout = []
  let skippedNotFinal = 0
  let skippedGameLine = 0
  let noGameFound = 0

  for (const v of pending) {
    // Sides & totals wait for Game.status final and gradePendingGameLines.
    const game = gameMap.get(v.gameIdRef)
    const plan = planPlayerStatValidation(v, game)

    if (plan.action === 'skip_game_line') {
      skippedGameLine++
      continue
    }
    if (plan.action === 'needs_review' && plan.reason === 'hold_timeout') {
      toTimeout.push({ validation: v, game })
      continue
    }
    if (plan.action === 'needs_review') {
      noGameFound++
      toProcess.push({ validation: v, game: null })
      continue
    }
    if (plan.action === 'void') {
      toVoid.push({ validation: v, game })
      continue
    }
    if (plan.action === 'hold') {
      skippedNotFinal++
      continue
    }

    toProcess.push({ validation: v, game })
  }

  console.log(`\n📊 ${pending.length} total pending:`)
  console.log(`   ${toProcess.length} ready to process (${noGameFound} missing games)`)
  console.log(`   ${toVoid.length} cancelled games to void`)
  console.log(`   ${toTimeout.length} postponed/suspended past hold timeout → needs_review`)
  console.log(`   ${skippedNotFinal} skipped (games not yet final / postponed / unplayed)`)
  console.log(`   ${skippedGameLine} skipped (source=game_line → gradePendingGameLines)\n`)

  // Step 4: Void cancelled games, then process real finals
  let correct = 0, incorrect = 0, pushes = 0, voids = 0, errors = 0, needsReview = 0

  async function writeVoid(v, game, extraNotes = '') {
    const reviewedAt = new Date()
    return updateWithOptionalAudit(
      (payload) => supabase.from('PropValidation').update(payload).eq('id', v.id),
      {
        ...voidPropValidationPatch(reviewedAt, game, extraNotes),
        ...propValidationGradeAudit(reviewedAt, {
          gradedBy: 'system',
          gradeSource: 'validate_pending_props',
        }),
      },
    )
  }

  for (const { validation: v, game } of toVoid) {
    const write = await writeVoid(v, game)
    if (write?.error) {
      errors++
      console.error(`❌ Void write failed for ${v.playerName}: ${write.error.message}`)
      continue
    }
    voids++
    console.log(`⚪  ${v.playerName.padEnd(20)} ${v.propType.padEnd(22)} void (game ${game?.status || 'cancelled'})`)
  }

  for (const { validation: v, game } of toTimeout) {
    const reviewedAt = new Date()
    const write = await updateWithOptionalAudit(
      (payload) => supabase.from('PropValidation').update(payload).eq('id', v.id),
      {
        status: 'needs_review',
        notes: `Hold timeout — game still ${game?.status || 'postponed'} after 7 days`,
        completedAt: reviewedAt.toISOString(),
        ...propValidationGradeAudit(reviewedAt, {
          gradedBy: 'system',
          gradeSource: 'validate_pending_props',
        }),
      },
    )
    if (write?.error) {
      errors++
      console.error(`❌ Timeout write failed for ${v.playerName}: ${write.error.message}`)
      continue
    }
    needsReview++
    console.log(`⚠️  ${v.playerName} ${v.propType} - hold timeout (${game?.status})`)
  }

  for (let i = 0; i < toProcess.length; i++) {
    const { validation: v, game } = toProcess[i]
    const prefix = `[${i + 1}/${toProcess.length}]`

    try {
      if (!game) {
        const reviewedAt = new Date()
        await updateWithOptionalAudit(
          (payload) => supabase.from('PropValidation').update(payload).eq('id', v.id),
          {
            status: 'needs_review',
            notes: 'Game not found in database',
            completedAt: reviewedAt.toISOString(),
            ...propValidationGradeAudit(reviewedAt, {
              gradedBy: 'system',
              gradeSource: 'validate_pending_props',
            }),
          },
        )
        needsReview++
        console.log(`${prefix} ⚠️  ${v.playerName} - game not found (${v.gameIdRef})`)
        continue
      }

      const sport = v.sport || game.sport
      let actualValue = null
      let nhlLookup = null
      let mlbLookup = null
      let dnpReason = null

      // Attempt to fetch the stat, with one retry on failure.
      // MLB: empty batting/pitching {} is DNP (void), not actual 0.
      // NHL: a fallback 0 is final only when the player matched, TOI > 0,
      // and the stat column exists in a final boxscore. 0 TOI → void.
      // NFL: missing from the box score stays needs_review (not inferred DNP).
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (sport === 'mlb') {
            if (!game.mlbGameId) break
            mlbLookup = await lookupMLBStat(game.mlbGameId, v.playerName, v.propType)
            const mlbPlan = planPlayerAppearanceGrade(mlbLookup)
            if (mlbPlan.action === 'void') {
              dnpReason = mlbPlan.reason
              break
            }
            actualValue = mlbPlan.action === 'grade' ? mlbPlan.actualValue : null
          } else if (sport === 'nhl') {
            if (!game.espnGameId) break
            // PropValidation has no playerId or team column, so these are
            // always undefined. Matching is name-only for now; the NHL team
            // alias table is inert until those columns exist.
            nhlLookup = await getNHLStat(
              game.espnGameId,
              v.playerName,
              v.propType,
              v.gameIdRef,
              { playerId: v.playerId, team: v.team },
            )
            const nhlPlan = planPlayerAppearanceGrade(nhlLookup)
            if (nhlPlan.action === 'void') {
              dnpReason = nhlPlan.reason
              break
            }
            actualValue = isGradeableNhlStatResult(nhlLookup) ? nhlLookup.value : null
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
        if (dnpReason || (actualValue !== null && actualValue !== undefined)) break
        if (attempt === 0) await new Promise(r => setTimeout(r, 500))
      }

      if (dnpReason) {
        const write = await writeVoid(v, game, `DNP: ${dnpReason}`)
        if (write?.error) {
          errors++
          console.error(`${prefix} ❌ Void write failed for ${v.playerName}: ${write.error.message}`)
          continue
        }
        voids++
        console.log(`${prefix} ⚪ ${v.playerName.padEnd(20)} ${v.propType.padEnd(22)} void (DNP ${dnpReason})`)
        continue
      }

      if (actualValue === null || actualValue === undefined) {
        const missingField = sport === 'mlb' ? !game.mlbGameId : !game.espnGameId
        const reason = missingField ? `No ${sport === 'mlb' ? 'mlbGameId' : 'espnGameId'}` : 'Stat not found in API'
        const reviewedAt = new Date()
        await updateWithOptionalAudit(
          (payload) => supabase.from('PropValidation').update(payload).eq('id', v.id),
          {
            status: 'needs_review',
            notes: reason,
            completedAt: reviewedAt.toISOString(),
            ...propValidationGradeAudit(reviewedAt, {
              gradedBy: 'system',
              gradeSource: 'validate_pending_props',
            }),
          },
        )
        needsReview++
        console.log(`${prefix} ⚠️  ${v.playerName} ${v.propType} - ${reason}`)
        continue
      }

      const result = gradePropFromActual(v.prediction, v.threshold, actualValue)

      const completedAt = new Date()
      const write = await updateWithOptionalAudit(
        (payload) => supabase.from('PropValidation').update(payload).eq('id', v.id),
        {
          actualValue,
          result,
          status: 'completed',
          completedAt: completedAt.toISOString(),
          notes: `Validated: ${v.prediction.toUpperCase()} ${v.threshold} → Actual: ${actualValue}`,
          ...propValidationGradeAudit(completedAt, {
            gradedBy: 'system',
            gradeSource: sport === 'nhl'
              ? nhlGradeSourceFromResult(nhlLookup)
              : 'validate_pending_props',
          }),
        },
      )

      if (write?.error) {
        errors++
        console.error(`${prefix} ❌ Write failed for ${v.playerName}: ${write.error.message}`)
        continue
      }

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
  console.log(`⚪ Void:          ${voids}`)
  console.log(`⚠️  Needs Review:  ${needsReview}`)
  console.log(`⏭️  Not Final Yet: ${skippedNotFinal}`)
  console.log(`🧾 Game lines:    ${skippedGameLine}`)
  console.log(`💥 Errors:        ${errors}`)
  console.log(`📈 Accuracy:      ${accuracy}% (${correct}/${total})`)

  // ── Archive box scores for completed games ───────────────────────────
  const completedGameIds = [...new Set(
    toProcess
      .filter(({ game }) => shouldArchiveBoxScore(game))
      .map(({ game }) => game.id)
  )]

  if (completedGameIds.length > 0) {
    const boxDir = resolveBoxScoresDir()
    const archivedGameIds = loadJsonlFieldSet(boxDir, 'game_id')
    console.log(`\n📦 Archiving box scores for ${completedGameIds.length} games → ${boxDir}`)
    let archivedGames = 0

    for (const gid of completedGameIds) {
      const game = gameMap.get(gid)
      if (!game) continue

      // Skip if this game_id is already in a local box-score JSONL
      if (archivedGameIds.has(gid)) continue

      const sport = game.sport || 'mlb'
      try {
        if (sport === 'mlb' && game.mlbGameId) {
          const allStats = await fetchMLBGameStats(game.mlbGameId)
          if (allStats) {
            const rows = boxScoreArchiveRows(game, allStats, {
              source: 'mlb-statsapi',
              now: new Date(),
            })
            if (rows.length > 0) {
              try {
                appendJsonl(boxDir, 'box-scores', rows)
                archivedGameIds.add(gid)
                archivedGames++
                console.log(`  ✅ Archived ${rows.length} player stats for ${gid}`)
              } catch (bsErr) {
                console.log(`  ⚠️  ${gid}: ${bsErr.message}`)
              }
            }
          }
        }
        // NFL box scores are archived independently of PropValidation:
        //   node scripts/archive-nfl-box-scores.js
        // NHL archival is a documented follow-up (not in this job).
      } catch (bsError) {
        console.log(`  ⚠️  Box score fetch failed for ${gid}: ${bsError.message}`)
      }
      await new Promise(r => setTimeout(r, 200))
    }
    console.log(`  📦 Archived MLB box scores for ${archivedGames} games`)
    console.log('  ℹ️  NFL outcomes: node scripts/archive-nfl-box-scores.js (independent of pending props)')
  }

  try {
    const { gradePendingGameLines } = await import('../lib/validation.js')
    const gradedLines = await gradePendingGameLines()
    console.log(`\n📊 Sides & totals: graded ${gradedLines?.length || 0} game-line row(s)`)
  } catch (error) {
    console.error(`⚠️ gradePendingGameLines failed: ${error.message}`)
  }

  const { count: remainingPending } = await supabase
    .from('PropValidation')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
  console.log(`\n⏳ Remaining pending: ${remainingPending}`)
  console.log('='.repeat(70) + '\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
