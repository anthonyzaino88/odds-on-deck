#!/usr/bin/env node
/**
 * CLOSE STUCK PARLAYS (one-shot)
 *
 * Grades a fixed list of pending parlays from local Game scores + PropValidation.
 * Default is dry-run (print proposed grades, write nothing).
 * Pass --live to update Parlay + ParlayLeg only.
 *
 * Usage:
 *   node scripts/close-stuck-parlays.js
 *   node scripts/close-stuck-parlays.js --live
 */

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
const { PrismaClient, Prisma } = require('@prisma/client')
const prisma = new PrismaClient()

const LIVE = process.argv.includes('--live')

const TARGET_IDS = [
  '1781738494578_vzpzs6yi1',
  '1777489478927_hc6cbprku',
  '1776294849836_d75j5z171',
  '1775585789688_f7ioiauhr',
  '1765735479426_kjzeiwfr3',
  '1765735223503_emklc5opq',
  '1765735198362_osnxgzreo',
  '1765735181377_m51duse6k',
]

const EXTRA_PV_PARLAY_IDS = [
  '1765735489455_lao5mdflf',
  '1765735240044_6qggrsoas',
]

function isNumeric(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function namesEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

function parseTotalLineFromNotes(notes) {
  if (!notes || typeof notes !== 'string') return null
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
  return bet === 'total' || bet === 'game_total' || prop === 'total' || prop === 'game_total'
}

function isPropLeg(leg) {
  return Boolean(leg.playerName && (leg.betType === 'prop' || leg.propType))
}

function pickPropValidation(leg, validations) {
  const candidates = validations.filter((row) => (
    namesEqual(row.playerName, leg.playerName) &&
    String(row.propType || '') === String(leg.propType || '') &&
    String(row.gameIdRef || '') === String(leg.gameIdRef || '')
  ))
  if (candidates.length === 0) return null

  const usable = (row) => {
    const numeric = isNumeric(row.actualValue)
    return (row.status === 'completed' || row.status === 'manual_closed') && numeric
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

function aggregateParlay(outcomes) {
  const lost = outcomes.filter((o) => o === 'lost').length
  const push = outcomes.filter((o) => o === 'push').length
  const won = outcomes.filter((o) => o === 'won').length
  const unresolved = outcomes.filter((o) => o !== 'won' && o !== 'lost' && o !== 'push').length
  if (unresolved) return 'pending'
  if (lost > 0) return 'lost'
  if (push > 0) return 'push'
  if (won === outcomes.length && outcomes.length > 0) return 'won'
  return 'pending'
}

async function loadClosingTotals(gameIds) {
  const map = new Map()
  if (!gameIds.length) return map
  try {
    const rows = await prisma.$queryRaw`
      SELECT game_id, total, book, snapshot_at
      FROM "ClosingOdds"
      WHERE game_id IN (${Prisma.join(gameIds)})
    `
    for (const row of rows || []) {
      if (!isNumeric(row.total)) continue
      const gameId = row.game_id || row.gameId
      if (!map.has(gameId)) {
        map.set(gameId, { line: Number(row.total), book: row.book })
      }
    }
  } catch (error) {
    console.log(`⚠️  ClosingOdds not available (${error.message})`)
  }
  return map
}

function resolveTotalLine(leg, closingTotals) {
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

  if (line == null) {
    const closing = closingTotals.get(leg.gameIdRef)
    if (closing) {
      line = closing.line
      lineSource = `ClosingOdds (${closing.book || 'book'})`
    }
  }

  return { line, side, lineSource }
}

function gradeLeg(leg, { games, validations, closingTotals }) {
  if (isTotalLeg(leg)) {
    const { line, side, lineSource } = resolveTotalLine(leg, closingTotals)
    const game = games.get(leg.gameIdRef)
    const label = `Game Total ${String(side || '').toUpperCase()} ${line ?? '?'}`

    if (!game) {
      return {
        outcome: null,
        actual: null,
        line,
        side,
        label,
        source: 'missing Game',
        actualResult: null,
        skipReason: `Game not found for ${leg.gameIdRef}`,
      }
    }

    if (!isNumeric(game.homeScore) || !isNumeric(game.awayScore)) {
      return {
        outcome: null,
        actual: null,
        line,
        side,
        label,
        source: 'Game (scores missing)',
        actualResult: null,
        skipReason: 'Missing home/away scores',
      }
    }

    const actual = Number(game.awayScore) + Number(game.homeScore)
    const matchup = `${game.away?.abbr || '?'} ${game.awayScore} @ ${game.home?.abbr || '?'} ${game.homeScore}`
    if (line == null) {
      return {
        outcome: null,
        actual,
        line,
        side,
        label,
        source: 'Game (no line)',
        actualResult: `Actual: ${actual} (${matchup})`,
        skipReason: 'Could not parse total line from notes/threshold/ClosingOdds',
      }
    }

    return {
      outcome: gradeOverUnder(actual, line, side),
      actual,
      line,
      side,
      label,
      source: `Game / ${lineSource}`,
      actualResult: `Actual: ${actual} (${matchup}) vs ${String(side).toUpperCase()} ${line}`,
    }
  }

  if (isPropLeg(leg)) {
    const line = isNumeric(leg.threshold) ? Number(leg.threshold) : null
    const side = String(leg.selection || 'over').toLowerCase()
    const label = `${leg.playerName} ${leg.propType} ${String(side).toUpperCase()} ${line ?? '?'}`
    const pv = pickPropValidation(leg, validations)
    const usable = pv && (pv.status === 'completed' || pv.status === 'manual_closed') && isNumeric(pv.actualValue)

    if (usable) {
      const actual = Number(pv.actualValue)
      const otherParlay = pv.parlayId && pv.parlayId !== leg.parlayId
        ? `; parlayId ${pv.parlayId}`
        : ''
      return {
        outcome: gradeOverUnder(actual, line, side),
        actual,
        line,
        side,
        label,
        source: `PropValidation ${pv.id} (${pv.status}${otherParlay})`,
        actualResult: `Actual: ${actual}`,
      }
    }

    const why = !pv
      ? 'no PropValidation row'
      : `PropValidation ${pv.id} ${pv.status} without numeric actual`
    return {
      outcome: gradeOverUnder(0, line, side),
      actual: 0,
      line,
      side,
      label,
      source: `assumed-0 (${why})`,
      actualResult: 'Actual: 0 (missing box-score / DNP)',
    }
  }

  return {
    outcome: null,
    actual: null,
    line: leg.threshold,
    side: leg.selection,
    label: `${leg.playerName || leg.selection || 'leg'} ${leg.propType || leg.betType}`,
    source: 'unknown leg type',
    actualResult: null,
    skipReason: `Unhandled betType=${leg.betType} propType=${leg.propType}`,
  }
}

async function main() {
  console.log('\n🧹 CLOSE STUCK PARLAYS')
  console.log('='.repeat(70))
  console.log(`Mode: ${LIVE ? 'LIVE (will write Parlay + ParlayLeg)' : 'DRY-RUN (no writes)'}`)
  console.log(`Targets: ${TARGET_IDS.length} parlay IDs`)
  console.log('='.repeat(70))

  const parlays = await prisma.parlay.findMany({
    where: { id: { in: TARGET_IDS } },
    include: { legs: { orderBy: { legOrder: 'asc' } } },
  })

  const foundIds = new Set(parlays.map((p) => p.id))
  for (const id of TARGET_IDS) {
    if (!foundIds.has(id)) console.log(`⚠️  Parlay not found: ${id}`)
  }

  const gameIds = [...new Set(parlays.flatMap((p) => p.legs.map((l) => l.gameIdRef).filter(Boolean)))]
  const playerNames = [...new Set(parlays.flatMap((p) => p.legs.map((l) => l.playerName).filter(Boolean)))]

  const gameRows = await prisma.game.findMany({
    where: { id: { in: gameIds } },
    include: { home: true, away: true },
  })
  const games = new Map(gameRows.map((g) => [g.id, g]))

  const validations = await prisma.propValidation.findMany({
    where: {
      OR: [
        { playerName: { in: playerNames } },
        { parlayId: { in: [...TARGET_IDS, ...EXTRA_PV_PARLAY_IDS] } },
        { gameIdRef: { in: gameIds } },
      ],
    },
  })

  const closingTotals = await loadClosingTotals(gameIds)

  const results = []

  for (const id of TARGET_IDS) {
    const parlay = parlays.find((p) => p.id === id)
    if (!parlay) {
      results.push({ id, proposed: null, skipped: true, reason: 'not found', legs: [] })
      continue
    }

    if (parlay.status === 'won' || parlay.status === 'lost' || parlay.status === 'push') {
      console.log(`\n⏭️  ${id} already ${parlay.status} — skipping (never rewrite settled parlays)`)
      results.push({
        id,
        proposed: parlay.status,
        skipped: true,
        reason: `already ${parlay.status}`,
        legs: [],
      })
      continue
    }

    console.log(`\n📝 Parlay ${id}`)
    console.log(`   sport=${parlay.sport} type=${parlay.type} status=${parlay.status} legs=${parlay.legs.length}`)

    const gradedLegs = []
    for (const leg of parlay.legs) {
      const graded = gradeLeg(leg, { games, validations, closingTotals })
      gradedLegs.push({ leg, ...graded })
      const icon = graded.outcome === 'won' ? '✅'
        : graded.outcome === 'lost' ? '❌'
        : graded.outcome === 'push' ? '➖'
        : '⏳'
      console.log(`   ${icon} ${graded.label}`)
      console.log(`      line=${graded.line} actual=${graded.actual} result=${graded.outcome || 'unresolved'} source=${graded.source}`)
      if (graded.skipReason) console.log(`      ⚠️  ${graded.skipReason}`)
    }

    const proposed = aggregateParlay(gradedLegs.map((row) => row.outcome))
    console.log(`   → proposed status: ${String(proposed).toUpperCase()}`)
    results.push({ id, parlay, proposed, skipped: false, legs: gradedLegs })
  }

  console.log('\n' + '='.repeat(70))
  console.log('📋 DRY-RUN TABLE')
  console.log('='.repeat(70))
  for (const row of results) {
    console.log(`\n${row.id}  →  ${String(row.proposed || row.reason || '?').toUpperCase()}`)
    for (const graded of row.legs) {
      console.log(`  - ${graded.label} | line ${graded.line} | actual ${graded.actual} | ${graded.outcome} | ${graded.source}`)
    }
  }

  if (!LIVE) {
    console.log('\n💡 Dry-run only. Re-run with --live to write these grades.')
    return
  }

  console.log('\n✍️  LIVE writes (only these 8 IDs)...')
  let written = 0

  for (const row of results) {
    if (row.skipped || !row.parlay) continue
    if (!['won', 'lost', 'push'].includes(row.proposed)) {
      console.log(`  ⏭️  ${row.id} unresolved (${row.proposed}) — not writing`)
      continue
    }

    await prisma.$transaction(async (tx) => {
      for (const graded of row.legs) {
        if (!graded.outcome) continue
        await tx.parlayLeg.update({
          where: { id: graded.leg.id },
          data: {
            outcome: graded.outcome,
            actualResult: graded.actualResult || `Actual: ${graded.actual}`,
          },
        })
      }

      const lostLabels = row.legs
        .filter((graded) => graded.outcome === 'lost')
        .map((graded) => graded.leg.playerName || graded.label)
      const actualResult = row.proposed === 'won'
        ? `All ${row.legs.length} legs won`
        : row.proposed === 'push'
          ? 'Push — no losses, at least one push'
          : `Lost on: ${lostLabels.join(', ')}`

      await tx.parlay.update({
        where: { id: row.id },
        data: {
          status: row.proposed,
          outcome: row.proposed,
          actualResult,
        },
      })
    })

    written += 1
    console.log(`  ✅ wrote ${row.id} → ${row.proposed}`)
  }

  const after = await prisma.parlay.findMany({
    where: { id: { in: TARGET_IDS } },
    select: { id: true, status: true, outcome: true, actualResult: true },
  })
  console.log('\n📊 Status after live write:')
  for (const parlay of after) {
    console.log(`  ${parlay.id}  status=${parlay.status}  outcome=${parlay.outcome}  ${parlay.actualResult || ''}`)
  }
  const pending = after.filter((p) => p.status === 'pending').length
  console.log(`\nPending among 8: ${pending}`)
  console.log(`Wrote ${written} parlays`)
}

main()
  .catch((error) => {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })