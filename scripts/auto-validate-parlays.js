#!/usr/bin/env node
/**
 * AUTO-VALIDATE PARLAYS
 * 
 * Automatically validates parlay legs after games finish:
 * 1. Moneyline bets - checks if team won
 * 2. Game totals - checks over/under
 * 3. Player props - fetches actual stats from ESPN
 * 
 * Run this a few hours after games finish:
 *   node scripts/auto-validate-parlays.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// ESPN API for game results
async function fetchGameResults(sport, gameDate) {
  const sportEndpoint = {
    'nfl': 'football/nfl',
    'nhl': 'hockey/nhl',
    'mlb': 'baseball/mlb',
    'nba': 'basketball/nba'
  }[sport] || 'football/nfl'
  
  const dateStr = gameDate.toISOString().split('T')[0].replace(/-/g, '')
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportEndpoint}/scoreboard?dates=${dateStr}`
  
  console.log(`📡 Fetching ${sport.toUpperCase()} games from ESPN: ${url}`)
  
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
      
      if (isComplete) {
        // Store results by team abbreviation
        if (homeAbbrev) {
          results[homeAbbrev] = {
            won: homeScore > awayScore,
            score: homeScore,
            opponentScore: awayScore,
            totalScore
          }
        }
        if (awayAbbrev) {
          results[awayAbbrev] = {
            won: awayScore > homeScore,
            score: awayScore,
            opponentScore: homeScore,
            totalScore
          }
        }
        
        // Also store by common variations
        const variations = {
          'JAX': 'JAC', 'JAC': 'JAX',
          'WSH': 'WAS', 'WAS': 'WSH',
          'LV': 'OAK', 'OAK': 'LV',
          'LA': 'LAR', 'LAR': 'LA'
        }
        
        if (homeAbbrev && variations[homeAbbrev]) {
          results[variations[homeAbbrev]] = results[homeAbbrev]
        }
        if (awayAbbrev && variations[awayAbbrev]) {
          results[variations[awayAbbrev]] = results[awayAbbrev]
        }
        
        console.log(`  ✅ ${awayAbbrev} ${awayScore} @ ${homeAbbrev} ${homeScore} (Total: ${totalScore})`)
      }
    }
    
    return results
  } catch (error) {
    console.error(`❌ Error fetching game results:`, error.message)
    return {}
  }
}

// Fetch player stats from ESPN
async function fetchPlayerStats(sport, gameDate) {
  // This would require scraping or a different API
  // For now, return empty - player props need the existing validation endpoint
  return {}
}

async function autoValidateParlays() {
  console.log('\n🤖 AUTO-VALIDATE PARLAYS')
  console.log('='.repeat(60))
  
  // Get all pending parlays
  const pendingParlays = await prisma.parlay.findMany({
    where: { status: 'pending' },
    include: { legs: true },
    orderBy: { createdAt: 'desc' }
  })
  
  console.log(`📋 Found ${pendingParlays.length} pending parlays\n`)
  
  if (pendingParlays.length === 0) {
    console.log('✨ No pending parlays to validate!')
    await prisma.$disconnect()
    return
  }
  
  // Group parlays by sport and date
  const parlaysBySportDate = {}
  
  for (const parlay of pendingParlays) {
    const sport = parlay.sport || 'nfl'
    const date = new Date(parlay.createdAt).toISOString().split('T')[0]
    const key = `${sport}-${date}`
    
    if (!parlaysBySportDate[key]) {
      parlaysBySportDate[key] = {
        sport,
        date: new Date(date),
        parlays: []
      }
    }
    parlaysBySportDate[key].parlays.push(parlay)
  }
  
  // Process each sport/date combo
  for (const [key, { sport, date, parlays }] of Object.entries(parlaysBySportDate)) {
    console.log(`\n🎮 Processing ${sport.toUpperCase()} parlays from ${date.toDateString()}`)
    console.log('-'.repeat(60))
    
    // Fetch game results for this sport/date
    const gameResults = await fetchGameResults(sport, date)
    
    if (Object.keys(gameResults).length === 0) {
      console.log(`  ⚠️ No completed games found for ${sport} on ${date.toDateString()}`)
      continue
    }
    
    // Validate each parlay
    for (const parlay of parlays) {
      console.log(`\n  📝 Parlay ${parlay.id.slice(0, 8)}...`)
      
      let allLegsResolved = true
      let anyLegLost = false
      
      for (const leg of parlay.legs) {
        const betType = leg.propType || leg.betType
        const selection = leg.playerName || leg.selection
        
        let outcome = null
        let actualValue = null
        let notes = ''
        
        // MONEYLINE VALIDATION
        if (betType === 'moneyline' || betType === 'ml') {
          const teamAbbrev = selection?.toUpperCase()
          const teamResult = gameResults[teamAbbrev]
          
          if (teamResult) {
            outcome = teamResult.won ? 'won' : 'lost'
            actualValue = teamResult.won ? 1 : 0
            notes = `${teamAbbrev} ${teamResult.score}-${teamResult.opponentScore}`
            console.log(`    ✅ ${teamAbbrev} ML: ${outcome} (${notes})`)
          } else {
            console.log(`    ⏳ ${teamAbbrev} ML: Game not found`)
            allLegsResolved = false
          }
        }
        // GAME TOTAL VALIDATION
        else if (betType === 'total' || betType === 'game_total') {
          // For game totals, we need to find the game by any team in the parlay
          // or by the gameIdRef
          let totalScore = null
          
          // Try to find game by other legs' teams
          for (const otherLeg of parlay.legs) {
            if (otherLeg.betType === 'moneyline') {
              const team = otherLeg.selection?.toUpperCase()
              if (gameResults[team]) {
                totalScore = gameResults[team].totalScore
                break
              }
            }
          }
          
          if (totalScore !== null && leg.threshold) {
            const threshold = parseFloat(leg.threshold)
            const isOver = selection?.toLowerCase() === 'over'
            
            if (isOver) {
              outcome = totalScore > threshold ? 'won' : 'lost'
            } else {
              outcome = totalScore < threshold ? 'won' : 'lost'
            }
            actualValue = totalScore
            notes = `Total: ${totalScore} vs ${threshold}`
            console.log(`    ✅ Game ${selection} ${threshold}: ${outcome} (${notes})`)
          } else {
            console.log(`    ⏳ Game total: Missing data (total: ${totalScore}, threshold: ${leg.threshold})`)
            allLegsResolved = false
          }
        }
        // PLAYER PROP - Skip for now (handled by existing validation system)
        else if (selection && betType) {
          // Check if there's a PropValidation record for this leg
          const propValidation = await prisma.propValidation.findFirst({
            where: {
              playerName: selection,
              propType: betType,
              parlayId: parlay.id,
              status: 'completed'
            }
          })
          
          if (propValidation) {
            outcome = propValidation.result === 'correct' ? 'won' : 'lost'
            actualValue = propValidation.actualValue
            notes = `From PropValidation: ${actualValue}`
            console.log(`    ✅ ${selection} ${betType}: ${outcome} (Actual: ${actualValue})`)
          } else {
            console.log(`    ⏳ ${selection} ${betType}: Pending prop validation`)
            allLegsResolved = false
          }
        }
        
        if (outcome === 'lost') anyLegLost = true
        
        // Update leg if we have outcome
        if (outcome) {
          await prisma.parlayLeg.update({
            where: { id: leg.id },
            data: {
              actualResult: outcome,
              notes: notes || `Validated: ${outcome}`
            }
          })
        }
      }
      
      // Update parlay status if all legs resolved
      if (allLegsResolved) {
        const parlayOutcome = anyLegLost ? 'lost' : 'won'
        await prisma.parlay.update({
          where: { id: parlay.id },
          data: {
            status: parlayOutcome,
            outcome: parlayOutcome
          }
        })
        console.log(`    → Parlay marked as: ${parlayOutcome.toUpperCase()}`)
      } else {
        console.log(`    → Parlay still pending (some legs unresolved)`)
      }
    }
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('✅ Auto-validation complete!')
  console.log('='.repeat(60))
  
  await prisma.$disconnect()
}

// Run
autoValidateParlays().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

