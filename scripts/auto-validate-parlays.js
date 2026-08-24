#!/usr/bin/env node
/**
 * AUTO-VALIDATE PARLAYS
 *
 * Automatically validates parlay legs after games finish:
 * 1. Moneyline bets - Game scores first, ESPN fallback by GAME date (ET)
 * 2. Game totals - Game homeScore+awayScore, no moneyline sibling required
 * 3. Player props - PropValidation by player+type+game (any parlayId)
 *
 * Run this a few hours after games finish:
 *   node scripts/auto-validate-parlays.js
 */

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

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

function etDateKey(date) {
  if (!date) return null
  return new Date(date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
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

function isGameFinal(game) {
  const status = String(game?.status || '').toLowerCase()
  return ['final', 'completed', 'f', 'closed', 'post', 'status_final'].includes(status)
}

function gameHasScores(game) {
  return isNumeric(game?.homeScore) && isNumeric(game?.awayScore)
}

function isLiveOrUpcoming(game) {
  const status = String(game?.status || '').toLowerCase()
  return ['scheduled', 'pre-game', 'pre_game', 'warmup', 'in_progress', 'in progress', 'live'].includes(status)
}

function todayEt() {
  return etDateKey(new Date())
}

function gameDateIsPast(game) {
  const gameDay = etDateKey(game?.date)
  const today = todayEt()
  return Boolean(gameDay && today && gameDay < today)
}

function canGradeFromGame(game) {
  if (!game || !gameHasScores(game)) return false
  if (isGameFinal(game)) return true
  if (isLiveOrUpcoming(game)) return false
  return gameDateIsPast(game)
}

function canAssumeFinished(game) {
  if (!game) return false
  if (isGameFinal(game)) return true
  if (isLiveOrUpcoming(game)) return false
  return gameDateIsPast(game)
}

function teamMatches(selection, abbr) {
  if (!selection || !abbr) return false
  const a = String(selection).toUpperCase()
  const b = String(abbr).toUpperCase()
  if (a === b) return true
  if (TEAM_VARIATIONS[a] === b || TEAM_VARIATIONS[b] === a) return true
  return false
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

      const isComplete = competition.status?.type?.completed ||
                         competition.status?.type?.state === 'post' ||
                         competition.status?.type?.name === 'STATUS_FINAL'

      if (!isComplete) continue

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

async function autoValidateParlays() {
  console.log('\n🤖 AUTO-VALIDATE PARLAYS')
  console.log('='.repeat(60))

  const pendingParlays = await prisma.parlay.findMany({
    where: { status: 'pending' },
    include: { legs: { orderBy: { legOrder: 'asc' } } },
    orderBy: { createdAt: 'desc' }
  })

  console.log(`📋 Found ${pendingParlays.length} pending parlays\n`)

  if (pendingParlays.length === 0) {
    console.log('✨ No pending parlays to validate!')
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
    if (['won', 'lost', 'push'].includes(parlay.status)) {
      console.log(`\n⏭️  Parlay ${parlay.id} already ${parlay.status} — skipping`)
      continue
    }

    console.log(`\n📝 Parlay ${parlay.id}`)
    console.log(`   sport=${parlay.sport} type=${parlay.type} status=${parlay.status} legs=${parlay.legs.length}`)

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

        if (canGradeFromGame(game)) {
          const homeScore = Number(game.homeScore)
          const awayScore = Number(game.awayScore)
          const matchup = `${awayAbbr || '?'} ${awayScore} @ ${homeAbbr || '?'} ${homeScore}`
          let won = null
          if (teamMatches(teamAbbrev, homeAbbr) || teamAbbrev === 'HOME') {
            won = homeScore === awayScore ? null : homeScore > awayScore
            if (homeScore === awayScore) outcome = 'push'
          } else if (teamMatches(teamAbbrev, awayAbbr) || teamAbbrev === 'AWAY') {
            won = homeScore === awayScore ? null : awayScore > homeScore
            if (homeScore === awayScore) outcome = 'push'
          }

          if (outcome === 'push') {
            actualValue = 0
            notes = `${teamAbbrev} tied ${matchup}`
          } else if (won === true || won === false) {
            outcome = won ? 'won' : 'lost'
            actualValue = won ? 1 : 0
            notes = `${teamAbbrev} ${matchup}`
          } else {
            skipReason = `Team ${teamAbbrev} not in game ${leg.gameIdRef}`
          }
        }

        if (!outcome) {
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

        if (outcome) {
          console.log(`    ✅ ${teamAbbrev} ML: ${outcome} (${notes})`)
        } else {
          skipReason = skipReason || `${teamAbbrev} ML: game not final / not found`
          console.log(`    ⏳ ${skipReason}`)
        }
      } else if (isTotalLeg(leg)) {
        const { line, side, lineSource } = resolveTotalLine(leg)
        let totalScore = null
        let source = null

        if (canGradeFromGame(game)) {
          totalScore = Number(game.awayScore) + Number(game.homeScore)
          source = 'Game'
        } else if (game?.date) {
          const espnResults = await getEspnResults(game.sport || parlay.sport || 'mlb', game.date)
          const espnGame = lookupEspnGame(game, espnResults)
          if (espnGame && espnGame.complete && isNumeric(espnGame.totalScore)) {
            totalScore = Number(espnGame.totalScore)
            source = 'ESPN (game date ET)'
          }
        }

        if (totalScore !== null && line != null) {
          outcome = gradeOverUnder(totalScore, line, side)
          actualValue = totalScore
          const matchup = game
            ? `${game.away?.abbr || '?'} ${game.awayScore ?? '?'} @ ${game.home?.abbr || '?'} ${game.homeScore ?? '?'}`
            : ''
          notes = `Total: ${totalScore} vs ${String(side).toUpperCase()} ${line} (${source}${lineSource ? ` / line ${lineSource}` : ''}${matchup ? `; ${matchup}` : ''})`
          console.log(`    ✅ Game ${String(side).toUpperCase()} ${line}: ${outcome} (${notes})`)
        } else {
          skipReason = `Game total: Missing data (total: ${totalScore}, threshold: ${line})`
          console.log(`    ⏳ ${skipReason}`)
        }
      } else if (isPropLeg(leg)) {
        const line = isNumeric(leg.threshold) ? Number(leg.threshold) : null
        const side = String(leg.selection || 'over').toLowerCase()
        const pv = pickPropValidation(leg, validations)
        const usable = pv && (pv.status === 'completed' || pv.status === 'manual_closed') && isNumeric(pv.actualValue)

        if (usable) {
          actualValue = Number(pv.actualValue)
          outcome = gradeOverUnder(actualValue, line, side)
          const otherParlay = pv.parlayId && pv.parlayId !== parlay.id ? `; copied from parlay ${pv.parlayId}` : ''
          notes = `From PropValidation: ${actualValue} (${pv.status}${otherParlay})`
          console.log(`    ✅ ${leg.playerName} ${leg.propType}: ${outcome} (Actual: ${actualValue})`)
        } else if (canAssumeFinished(game) || (pv && pv.status === 'manual_closed' && !isNumeric(pv.actualValue))) {
          actualValue = 0
          outcome = gradeOverUnder(0, line, side)
          const why = !pv
            ? 'missing box-score / DNP'
            : `PropValidation ${pv.status} without numeric actual`
          notes = `Actual: 0 (${why})`
          console.log(`    ✅ ${leg.playerName} ${leg.propType}: ${outcome} (assumed 0 — ${why})`)
        } else {
          skipReason = `${leg.playerName} ${leg.propType}: Pending prop validation`
          console.log(`    ⏳ ${skipReason}`)
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

    const parlayOutcome = aggregateParlay(gradedLegs.map((row) => row.outcome))

    for (const graded of gradedLegs) {
      if (!graded.outcome) continue
      await prisma.parlayLeg.update({
        where: { id: graded.leg.id },
        data: {
          outcome: graded.outcome,
          actualResult: graded.notes || `Actual: ${graded.actualValue}`,
        },
      })
    }

    if (parlayOutcome !== 'pending') {
      const lostLabels = gradedLegs
        .filter((row) => row.outcome === 'lost')
        .map((row) => row.leg.playerName || row.leg.selection || row.leg.propType || 'leg')
      const actualResult = parlayOutcome === 'won'
        ? `All ${gradedLegs.length} legs won`
        : parlayOutcome === 'push'
          ? 'Push — no losses, at least one push'
          : `Lost on: ${lostLabels.join(', ')}`

      await prisma.parlay.update({
        where: { id: parlay.id },
        data: {
          status: parlayOutcome,
          outcome: parlayOutcome,
          actualResult,
        },
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
