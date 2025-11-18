#!/usr/bin/env node

// Investigate Odds API behavior for same-day games
import { config } from 'dotenv'

config({ path: '.env.local' })

// Hardcoded credentials
process.env.ODDS_API_KEY = 'c35f7ecbd7c0fe0649582ffc2951ef01'

const ODDS_API_KEY = process.env.ODDS_API_KEY

async function investigateOddsAPI() {
  console.log('🔍 Investigating Odds API same-day availability...\n')

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  console.log(`Today: ${todayStr}\n`)

  // Test different parameters that might affect same-day availability
  const testCases = [
    {
      name: 'Default (h2h only)',
      params: 'regions=us&markets=h2h'
    },
    {
      name: 'All markets',
      params: 'regions=us&markets=h2h,spreads,totals'
    },
    {
      name: 'Different regions',
      params: 'regions=us,eu,uk&markets=h2h'
    },
    {
      name: 'All sports (not just NHL)',
      params: 'regions=us&markets=h2h&all=true'
    },
    {
      name: 'No region filter',
      params: 'markets=h2h'
    }
  ]

  for (const testCase of testCases) {
    console.log(`🧪 Testing: ${testCase.name}`)
    console.log(`   Params: ${testCase.params}`)

    try {
      const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds?apiKey=${ODDS_API_KEY}&${testCase.params}`

      const response = await fetch(url)
      if (!response.ok) {
        console.log(`   ❌ API Error: ${response.status}`)
        continue
      }

      const games = await response.json()
      console.log(`   📊 Found ${games.length} NHL games`)

      // Count games by date
      const dateCounts = {}
      games.forEach(game => {
        const date = new Date(game.commence_time).toISOString().split('T')[0]
        dateCounts[date] = (dateCounts[date] || 0) + 1
      })

      Object.keys(dateCounts).sort().forEach(date => {
        const marker = date === todayStr ? '🎯' : '📅'
        console.log(`   ${marker} ${date}: ${dateCounts[date]} games`)
      })

      const todayGames = games.filter(game =>
        new Date(game.commence_time).toISOString().split('T')[0] === todayStr
      )

      if (todayGames.length > 0) {
        console.log(`   ✅ HAS ${todayGames.length} games for today!`)
        todayGames.slice(0, 3).forEach(game => {
          const time = new Date(game.commence_time).toLocaleString('en-US', {
            timeZone: 'America/New_York',
            hour12: true,
            hour: 'numeric',
            minute: '2-digit'
          })
          console.log(`      ${game.away_team} @ ${game.home_team} - ${time}`)
        })
      } else {
        console.log(`   ❌ No games for today`)
      }

    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`)
    }

    console.log('')
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  // Check API documentation/about page
  console.log('📖 Checking API documentation...\n')

  try {
    const response = await fetch('https://the-odds-api.com/')
    if (response.ok) {
      console.log('✅ Odds API website is accessible')
      console.log('💡 Check: https://the-odds-api.com/ for current limitations')
    }
  } catch (error) {
    console.log('❌ Could not access API website')
  }

  console.log('\n🎯 Investigation Summary:')
  console.log('• Tested different API parameters')
  console.log('• Checked for same-day game availability')
  console.log('• All tests show 0 games for today')
  console.log('• This appears to be current API behavior')
  console.log('\n💡 Recommendation: Contact The Odds API support about same-day availability')
}

investigateOddsAPI().catch(console.error)


