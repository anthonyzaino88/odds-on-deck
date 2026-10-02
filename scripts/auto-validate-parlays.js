#!/usr/bin/env node
/**
 * AUTO-VALIDATE PARLAYS
 *
 * Automatically validates parlay legs after games finish:
 * 1. Moneyline bets - Game scores first, ESPN fallback by GAME date (ET)
 * 2. Game totals - Game homeScore+awayScore, no moneyline sibling required
 * 3. Player props - PropValidation by player+type+game (any parlayId)
 *
 * Featured cards use the same fail-closed helpers as /api/parlays/validate.
 * Pending / missing numeric PropValidation actuals stay pending — never
 * assume actual=0.
 *
 * Run AFTER player props are graded (`validate` / `validate:all` does
 * props first). Regrade already-written Featured cards locally:
 *   node scripts/auto-validate-parlays.js --regrade
 *   node scripts/auto-validate-parlays.js --regrade --id ed1be445a5284504
 */

import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import {
  FEATURED_COHORT_TAG,
  featuredLegGradePatch,
  featuredLegPendingResetPatch,
  applyFeaturedHoldTimeout,
  featuredParlayGradePatch,
  featuredRegradeParlayPatch,
  gradeFeaturedParlayFromValidations,
  gradePropLegFromValidation,
  isFeaturedCohortRow,
  isNumericFeaturedActual,
} from '../lib/featured-parlays.js'
import {
  aggregateParlayOutcomes,
  attachSettledParlayOdds,
  classifyGameForGrading,
  describeVoidNotes,
  etDateKey,
  HOLD_TIMEOUT_DAYS,
  isEspnCompetitionGradeable,
  shouldVoidFromGame,
} from '../lib/game-grade-eligibility.js'
import { planGameLineSettlement } from '../lib/game-lines.js'
import {
  gradeMoneylineFromGame,
  gradeTotalFromGame,
  teamMatches,
} from '../lib/parlay-game-grade.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })
const prisma = new PrismaClient()

function parseArgs(argv) {
  const regrade = argv.includes('--regrade')
  const ids = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--id' && argv[i + 1]) {
      ids.push(argv[i + 1])
      i += 1
    } else if (arg.startsWith('--id=')) {
      ids.push(arg.slice(5))
    }
  }
  return { regrade, ids: ids.filter(Boolean) }
}

const { regrade: REGRADE, ids: TARGET_IDS } = parseArgs(process.argv.slice(2))

const TEAM_VARIATIONS = {
  'JAX': 'JAC', 'JAC': 'JAX',
  'WSH': 'WAS', 'WAS': 'WSH',
  'LV': 'OAK', 'OAK': 'LV',
  'LA': 'LAR', 'LAR': 'LA',
  'TB': 'TBL', 'TBL': 'TB',
  'AZ': 'ARI', 'ARI': 'AZ',
}

function isNumeric(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function namesEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

function etDateEspn(date) {
  const key = etDateKey(date)
  return key ? key.replace(/-/g, '') : null
}

function parseTotalLineFromNotes(notes) {
  if (!notes || typeof notes !== 'string') return null
  // CLE @ MIL OVER 7.5, ARI @ NYM OVER 7, LAA @ NYY UNDER 10.5
  const match = notes.match(/\b(OVER|UNDER)\s+(\d+(?:\.\d+)?)\b/i)
  if (!match) return null
  return { side: match[1].toLowerCase(), line: parseFloat(match[2]) }
}

function gradeOverUnder(actual, line, side) {
  const actualNum = Number(actual)
  const lineNum = Number(line)
  if (!Number.isFinite(actualNum) || !Number.isFinite(lineNum)) return null
  if (actualNum === lineNum) return 'push'
  const isOver = String(side || '').toLowerCase() === 'over'
  if (isOver) return actualNum > lineNum ? 'won' : 'lost'
  return actualNum < lineNum ? 'won' : 'lost'
}

function isTotalLeg(leg) {
  const bet = String(leg.betType || '').toLowerCase()
  const prop = String(leg.propType || '').toLowerCase()
  const selection = String(leg.selection || '').toLowerCase()
  if (bet === 'total' || bet === 'game_total' || prop === 'total' || prop === 'game_total') return true
  if (!leg.playerName && (selection === 'over' || selection === 'under')) return true
  return false
}

function isMoneylineLeg(leg) {
  const bet = String(leg.betType || '').toLowerCase()
  const prop = String(leg.propType || '').toLowerCase()
  return bet === 'moneyline' || bet === 'ml' || prop === 'moneyline' || prop === 'ml'
}

function isPropLeg(leg) {
  return Boolean(leg.playerName && (leg.betType === 'prop' || leg.propType) && !isTotalLeg(leg) && !isMoneylineLeg(leg))
}

function shouldSkipEspnFallback(game) {
  if (shouldVoidFromGame(game)) return true
  const reason = classifyGameForGrading(game).reason
  return ['postponed', 'suspended', 'delayed', 'in_progress', 'live', 'halftime', 'mlb_unplayed_0_0'].includes(reason)
}

function holdTimeoutFromGame(game) {
  const plan = planGameLineSettlement(game)
  if (plan.action !== 'needs_review') return null
  return {
    outcome: 'needs_review',
    notes: `Hold timeout — game still ${game?.status || 'postponed'} after ${HOLD_TIMEOUT_DAYS} days`,
  }
}

function aggregateParlay(outcomes) {
  return aggregateParlayOutcomes(outcomes)
}

function pickPropValidation(leg, validations) {
  const candidates = validations.filter((row) => (
    namesEqual(row.playerName, leg.playerName) &&
    String(row.propType || '') === String(leg.propType || '') &&
    String(row.gameIdRef || '') === String(leg.gameIdRef || '')
  ))
  if (candidates.length === 0) return null

  const usable = (row) => {
    if (row.status !== 'completed' && row.status !== 'manual_closed') return false
    if (String(row.result || '').toLowerCase() === 'void') return true
    return isNumeric(row.actualValue)
  }

  return [...candidates].sort((a, b) => {
    const usableDiff = Number(usable(b)) - Number(usable(a))
    if (usableDiff) return usableDiff
    const parlayDiff = Number(b.parlayId === leg.parlayId) - Number(a.parlayId === leg.parlayId)
    if (parlayDiff) return parlayDiff
    const aThresh = isNumeric(leg.threshold) && Number(a.threshold) === Number(leg.threshold)
    const bThresh = isNumeric(leg.threshold) && Number(b.threshold) === Number(leg.threshold)
    return Number(bThresh) - Number(aThresh)
  })[0]
}

function resolveTotalLine(leg) {
  let line = isNumeric(leg.threshold) ? Number(leg.threshold) : null
  let side = String(leg.selection || '').toLowerCase()
  let lineSource = line != null ? 'ParlayLeg.threshold' : null

  const parsed = parseTotalLineFromNotes(leg.notes)
  if (parsed) {
    if (line == null) {
      line = parsed.line
      lineSource = 'notes'
    }
    if (side !== 'over' && side !== 'under') {
      side = parsed.side
    }
  }

  return { line, side, lineSource }
}

async function fetchGameResults(sport, gameDate) {
  const sportEndpoint = {
    'nfl': 'football/nfl',
    'nhl': 'hockey/nhl',
    'mlb': 'baseball/mlb',
    'nba': 'basketball/nba'
  }[sport] || 'football/nfl'

  const dateStr = etDateEspn(gameDate)
  if (!dateStr) return {}

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportEndpoint}/scoreboard?dates=${dateStr}`
  console.log(`📡 Fetching ${String(sport).toUpperCase()} games from ESPN: ${url}`)

  try {
    const response = await fetch(url)
    const data = await response.json()
    const results = {}

    for (const event of data.events || []) {
      const competition = event.competitions?.[0]
      if (!competition) continue

      const homeTeam = competition.competitors?.find(c => c.homeAway === 'home')
      const awayTeam = competition.competitors?.find(c => c.homeAway === 'away')
      if (!homeTeam || !awayTeam) continue

      const homeScore = parseInt(homeTeam.score) || 0
      const awayScore = parseInt(awayTeam.score) || 0
      const totalScore = homeScore + awayScore
      const homeAbbrev = homeTeam.team?.abbreviation?.toUpperCase()
      const awayAbbrev = awayTeam.team?.abbreviation?.toUpperCase()

      // ESPN state=post includes postponed/cancelled. Only true finals.
      if (!isEspnCompetitionGradeable(competition)) continue

      const payload = {
        won: null,
        score: null,
        opponentScore: null,
        totalScore,
        homeScore,
        awayScore,
        homeAbbrev,
        awayAbbrev,
        complete: true,
      }

      if (homeAbbrev) {
        results[homeAbbrev] = {
          ...payload,
          won: homeScore > awayScore,
          score: homeScore,
          opponentScore: awayScore,
        }
      }
      if (awayAbbrev) {
        results[awayAbbrev] = {
          ...payload,
          won: awayScore > homeScore,
          score: awayScore,
          opponentScore: homeScore,
        }
      }

      if (awayAbbrev && homeAbbrev) {
        results[`${awayAbbrev}@${homeAbbrev}`] = {
          ...payload,
          won: null,
          score: null,
          opponentScore: null,
        }
      }

      for (const [from, to] of Object.entries(TEAM_VARIATIONS)) {
        if (results[from] && !results[to]) results[to] = results[from]
      }

      console.log(`  ✅ ${awayAbbrev} ${awayScore} @ ${homeAbbrev} ${homeScore} (Total: ${totalScore})`)
    }

    return results
  } catch (error) {
    console.error(`❌ Error fetching game results:`, error.message)
    return {}
  }
}

function lookupEspnGame(game, espnResults) {
  if (!espnResults) return null
  const home = game?.home?.abbr?.toUpperCase()
  const away = game?.away?.abbr?.toUpperCase()
  if (away && home && espnResults[`${away}@${home}`]) return espnResults[`${away}@${home}`]
  if (home && espnResults[home]) return espnResults[home]
  if (away && espnResults[away]) return espnResults[away]
  return null
}

function isSettledStatus(status) {
  return ['won', 'lost', 'push'].includes(String(status || '').toLowerCase())
}

async function loadParlays() {
  if (TARGET_IDS.length) {
    return prisma.parlay.findMany({
      where: { id: { in: TARGET_IDS } },
      include: { legs: { orderBy: { legOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  const pendingParlays = await prisma.parlay.findMany({
    where: { status: 'pending' },
    include: { legs: { orderBy: { legOrder: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })

  if (!REGRADE) return pendingParlays

  const settledFeatured = await prisma.parlay.findMany({
    where: {
      status: { in: ['won', 'lost', 'push'] },
      notes: { contains: FEATURED_COHORT_TAG },
    },
    include: { legs: { orderBy: { legOrder: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })

  const seen = new Set(pendingParlays.map((parlay) => parlay.id))
  return [...pendingParlays, ...settledFeatured.filter((parlay) => !seen.has(parlay.id))]
}

async function applyFeaturedGrade(parlay, validations, gamesById = new Map()) {
  const now = new Date()
  const grade = applyFeaturedHoldTimeout(
    gradeFeaturedParlayFromValidations(parlay.legs, validations),
    gamesById,
    now,
  )

  for (const legOutcome of grade.legOutcomes) {
    const leg = legOutcome.leg
    if (!leg?.id) continue
    const patch = featuredLegGradePatch(legOutcome, now)
    if (patch) {
      await prisma.parlayLeg.update({ where: { id: leg.id }, data: patch })
      const actual = isNumericFeaturedActual(legOutcome.actualValue)
        ? ` (Actual: ${legOutcome.actualValue})`
        : ''
      console.log(`    ✅ ${leg.playerName} ${leg.propType}: ${legOutcome.outcome}${actual}`)
      continue
    }

    const stale = isSettledStatus(leg.outcome)
    if (REGRADE || stale) {
      await prisma.parlayLeg.update({
        where: { id: leg.id },
        data: featuredLegPendingResetPatch(now),
      })
    }
    console.log(`    ⏳ ${leg.playerName} ${leg.propType}: Pending prop validation (no numeric actual)`)
  }

  const settleOpts = { postedOdds: parlay.totalOdds }
  const parlayPatch = REGRADE
    ? featuredRegradeParlayPatch(grade, parlay.status, now, settleOpts)
    : featuredParlayGradePatch(grade, now, settleOpts)

  if (parlayPatch) {
    await prisma.parlay.update({ where: { id: parlay.id }, data: parlayPatch })
    console.log(`    → Parlay marked as: ${String(parlayPatch.status).toUpperCase()}`)
  } else {
    console.log('    → Parlay still pending (some legs unresolved)')
  }
}

async function autoValidateParlays() {
  console.log('\n🤖 AUTO-VALIDATE PARLAYS')
  console.log('='.repeat(60))
  if (REGRADE) console.log('Mode: --regrade (Featured settled cards included; fail-closed on missing actuals)')
  if (TARGET_IDS.length) console.log(`Targets: ${TARGET_IDS.join(', ')}`)

  const pendingParlays = await loadParlays()

  console.log(`📋 Found ${pendingParlays.length} parlays to grade\n`)

  if (pendingParlays.length === 0) {
    console.log('✨ No parlays to validate!')
    await prisma.$disconnect()
    return
  }

  const gameIds = [...new Set(pendingParlays.flatMap((p) => p.legs.map((l) => l.gameIdRef).filter(Boolean)))]
  const playerNames = [...new Set(pendingParlays.flatMap((p) => p.legs.map((l) => l.playerName).filter(Boolean)))]

  const gameRows = gameIds.length
    ? await prisma.game.findMany({
        where: { id: { in: gameIds } },
        include: { home: true, away: true },
      })
    : []
  const games = new Map(gameRows.map((g) => [g.id, g]))

  const orFilters = []
  if (playerNames.length) orFilters.push({ playerName: { in: playerNames } })
  orFilters.push({ parlayId: { in: pendingParlays.map((p) => p.id) } })
  if (gameIds.length) orFilters.push({ gameIdRef: { in: gameIds } })

  const validations = await prisma.propValidation.findMany({
    where: { OR: orFilters },
  })

  const espnCache = new Map()
  async function getEspnResults(sport, date) {
    const espnDate = etDateEspn(date)
    if (!sport || !espnDate) return {}
    const key = `${sport}-${espnDate}`
    if (!espnCache.has(key)) {
      espnCache.set(key, await fetchGameResults(sport, date))
    }
    return espnCache.get(key)
  }

  for (const parlay of pendingParlays) {
    if (isSettledStatus(parlay.status) && (!REGRADE || !isFeaturedCohortRow(parlay))) {
      console.log(`\n⏭️  Parlay ${parlay.id} already ${parlay.status} — skipping`)
      continue
    }

    console.log(`\n📝 Parlay ${parlay.id}`)
    console.log(`   sport=${parlay.sport} type=${parlay.type} status=${parlay.status} legs=${parlay.legs.length}`)

    if (isFeaturedCohortRow(parlay)) {
      await applyFeaturedGrade(parlay, validations, games)
      continue
    }

    const gradedLegs = []

    for (const leg of parlay.legs) {
      const game = games.get(leg.gameIdRef)
      let outcome = null
      let actualValue = null
      let notes = ''
      let skipReason = null

      if (isMoneylineLeg(leg)) {
        const teamAbbrev = String(leg.selection || '').toUpperCase()
        const homeAbbr = game?.home?.abbr
        const awayAbbr = game?.away?.abbr

        const fromGame = gradeMoneylineFromGame(leg, game)
        outcome = fromGame.outcome
        actualValue = fromGame.actualValue
        notes = fromGame.notes || ''
        if (fromGame.skipReason) skipReason = fromGame.skipReason

        if (!outcome && !shouldSkipEspnFallback(game)) {
          const espnDate = game?.date || null
          if (espnDate) {
            const espnResults = await getEspnResults(game.sport || parlay.sport || 'mlb', espnDate)
            const teamResult = espnResults[teamAbbrev] || (game ? lookupEspnGame(game, espnResults) : null)
            if (teamResult && teamResult.complete) {
              if (teamResult.homeScore === teamResult.awayScore) {
                outcome = 'push'
                actualValue = 0
                notes = `${teamAbbrev} tied ${teamResult.awayAbbrev} ${teamResult.awayScore} @ ${teamResult.homeAbbrev} ${teamResult.homeScore}`
              } else if (espnResults[teamAbbrev]) {
                outcome = teamResult.won ? 'won' : 'lost'
                actualValue = teamResult.won ? 1 : 0
                notes = `${teamAbbrev} ${teamResult.score}-${teamResult.opponentScore}`
              } else if (game) {
                const homeWon = teamResult.homeScore > teamResult.awayScore
                if (teamMatches(teamAbbrev, homeAbbr) || teamAbbrev === 'HOME') {
                  outcome = homeWon ? 'won' : 'lost'
                } else if (teamMatches(teamAbbrev, awayAbbr) || teamAbbrev === 'AWAY') {
                  outcome = homeWon ? 'lost' : 'won'
                }
                if (outcome) {
                  actualValue = outcome === 'won' ? 1 : 0
                  notes = `${teamAbbrev} ${teamResult.awayAbbrev} ${teamResult.awayScore} @ ${teamResult.homeAbbrev} ${teamResult.homeScore}`
                }
              }
            }
          }
        }

        if (!outcome) {
          const timeout = holdTimeoutFromGame(game)
          if (timeout) {
            outcome = timeout.outcome
            notes = timeout.notes
          }
        }
        if (outcome === 'void') {
          console.log(`    ⚪ ${teamAbbrev} ML: void (${notes})`)
        } else if (outcome === 'needs_review') {
          console.log(`    🔍 ${teamAbbrev} ML: needs_review (${notes})`)
        } else if (outcome) {
          console.log(`    ✅ ${teamAbbrev} ML: ${outcome} (${notes})`)
        } else {
          skipReason = skipReason || `${teamAbbrev} ML: game not final / not found`
          console.log(`    ⏳ ${skipReason}`)
        }
      } else if (isTotalLeg(leg)) {
        const { line, side, lineSource } = resolveTotalLine(leg)
        let totalScore = null
        let source = null

        const fromGame = gradeTotalFromGame(leg, game, { line, side })
        if (fromGame.outcome === 'void') {
          outcome = 'void'
          notes = fromGame.notes
        } else if (fromGame.outcome) {
          totalScore = fromGame.totalScore
          source = 'Game'
        } else if (game?.date && !shouldSkipEspnFallback(game)) {
          const espnResults = await getEspnResults(game.sport || parlay.sport || 'mlb', game.date)
          const espnGame = lookupEspnGame(game, espnResults)
          if (espnGame && espnGame.complete && isNumeric(espnGame.totalScore)) {
            totalScore = Number(espnGame.totalScore)
            source = 'ESPN (game date ET)'
          }
        }

        if (outcome === 'void') {
          console.log(`    ⚪ Game total: void (${notes})`)
        } else if (totalScore !== null && line != null) {
          outcome = gradeOverUnder(totalScore, line, side)
          actualValue = totalScore
          const matchup = game
            ? `${game.away?.abbr || '?'} ${game.awayScore ?? '?'} @ ${game.home?.abbr || '?'} ${game.homeScore ?? '?'}`
            : ''
          notes = `Total: ${totalScore} vs ${String(side).toUpperCase()} ${line} (${source}${lineSource ? ` / line ${lineSource}` : ''}${matchup ? `; ${matchup}` : ''})`
          console.log(`    ✅ Game ${String(side).toUpperCase()} ${line}: ${outcome} (${notes})`)
        } else {
          const timeout = holdTimeoutFromGame(game)
          if (timeout) {
            outcome = timeout.outcome
            notes = timeout.notes
            console.log(`    🔍 Game total: needs_review (${notes})`)
          } else {
            skipReason = `Game total: Missing data (total: ${totalScore}, threshold: ${line})`
            console.log(`    ⏳ ${skipReason}`)
          }
        }
      } else if (isPropLeg(leg)) {
        if (shouldVoidFromGame(game)) {
          outcome = 'void'
          notes = describeVoidNotes(game, 'prop')
          console.log(`    ⚪ ${leg.playerName} ${leg.propType}: void (${notes})`)
        } else {
          const pv = pickPropValidation(leg, validations)
          outcome = gradePropLegFromValidation(leg, pv)
          if (outcome) {
            actualValue = isNumeric(pv?.actualValue) ? Number(pv.actualValue) : null
            const otherParlay = pv?.parlayId && pv.parlayId !== parlay.id ? `; copied from parlay ${pv.parlayId}` : ''
            notes = actualValue != null
              ? `From PropValidation: ${actualValue} (${pv.status}${otherParlay})`
              : `From PropValidation result: ${pv?.result} (${pv?.status}${otherParlay})`
            console.log(`    ✅ ${leg.playerName} ${leg.propType}: ${outcome}${actualValue != null ? ` (Actual: ${actualValue})` : ''}`)
          } else {
            const timeout = holdTimeoutFromGame(game)
            if (timeout) {
              outcome = timeout.outcome
              notes = timeout.notes
              console.log(`    🔍 ${leg.playerName} ${leg.propType}: needs_review (${notes})`)
            } else {
              skipReason = `${leg.playerName} ${leg.propType}: Pending prop validation (no numeric actual)`
              console.log(`    ⏳ ${skipReason}`)
            }
          }
        }
      } else {
        skipReason = `Unhandled betType=${leg.betType} propType=${leg.propType}`
        console.log(`    ⏳ ${skipReason}`)
      }

      gradedLegs.push({
        leg,
        outcome,
        actualValue,
        notes: notes || (outcome ? `Validated: ${outcome}` : null),
      })
    }

    let parlayOutcome = aggregateParlay(gradedLegs.map((row) => row.outcome))
    const unresolved = gradedLegs.filter((row) => !row.outcome || row.outcome === 'needs_review')
    if (parlayOutcome === 'pending' && unresolved.length > 0 && unresolved.every((row) => row.outcome === 'needs_review')) {
      parlayOutcome = 'needs_review'
    }

    for (const graded of gradedLegs) {
      if (graded.outcome) {
        await prisma.parlayLeg.update({
          where: { id: graded.leg.id },
          data: {
            outcome: graded.outcome,
            actualResult: graded.notes || `Actual: ${graded.actualValue}`,
          },
        })
        continue
      }

      if (isPropLeg(graded.leg) && isSettledStatus(graded.leg.outcome)) {
        await prisma.parlayLeg.update({
          where: { id: graded.leg.id },
          data: { outcome: 'pending', actualResult: null },
        })
      }
    }

    if (parlayOutcome !== 'pending') {
      const lostLabels = gradedLegs
        .filter((row) => row.outcome === 'lost')
        .map((row) => row.leg.playerName || row.leg.selection || row.leg.propType || 'leg')
      const voided = gradedLegs.filter((row) => row.outcome === 'void').length
      const actualResult = parlayOutcome === 'won'
        ? (voided ? `${gradedLegs.length - voided} remaining legs won (${voided} voided)` : `All ${gradedLegs.length} legs won`)
        : parlayOutcome === 'push'
          ? (voided === gradedLegs.length
            ? 'All legs voided (cancelled games) — refunded'
            : 'Push — no losses, at least one push')
          : parlayOutcome === 'needs_review'
            ? `Hold timeout — ${unresolved.length} leg(s) still postponed/suspended after ${HOLD_TIMEOUT_DAYS} days`
            : `Lost on: ${lostLabels.join(', ')}`

      const parlayData = attachSettledParlayOdds({
        status: parlayOutcome,
        outcome: parlayOutcome,
        actualResult,
      }, gradedLegs.map((row) => row.leg), gradedLegs.map((row) => row.outcome), {
        postedOdds: parlay.totalOdds,
      })
      if (parlayData.status === 'needs_review' && /remaining-leg odds missing/.test(parlayData.actualResult || '')) {
        console.warn(`    ⚠️ Parlay ${parlay.id}: remaining-leg odds missing after void — needs_review (postedOdds: ${parlay.totalOdds})`)
      }

      await prisma.parlay.update({
        where: { id: parlay.id },
        data: parlayData,
      })
      console.log(`    → Parlay marked as: ${parlayOutcome.toUpperCase()}`)
    } else {
      console.log(`    → Parlay still pending (some legs unresolved)`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('✅ Auto-validation complete!')
  console.log('='.repeat(60))

  await prisma.$disconnect()
}

autoValidateParlays().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
