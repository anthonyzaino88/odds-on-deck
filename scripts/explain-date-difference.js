#!/usr/bin/env node

/**
 * Explain why Odds API dates differ from ESPN dates
 */

const ODDS_API_KEY = process.env.ODDS_API_KEY

async function explain() {
  console.log('📅 Understanding Date Differences Between ESPN and Odds API\n')
  console.log('='.repeat(60))
  
  // Example: CHI @ VAN game
  console.log('\n📊 Example: Chicago @ Vancouver (Nov 5, 2025)')
  console.log('')
  console.log('ESPN Perspective:')
  console.log('  - Game is scheduled for Nov 5, 2025')
  console.log('  - When we query ESPN for Nov 5: dates=20251105')
  console.log('  - ESPN returns the game (correctly)')
  console.log('  - But ESPN\'s event.date field shows: 2025-11-06T00:00:00Z (UTC)')
  console.log('  - Why? Game starts late evening EST (Nov 5) = early morning UTC (Nov 6)')
  console.log('')
  console.log('Odds API Perspective:')
  console.log('  - Odds API uses commence_time (actual game start time)')
  console.log('  - Game starts: Nov 5, 2025 10:00 PM EST')
  console.log('  - In UTC: Nov 6, 2025 3:00 AM UTC')
  console.log('  - So Odds API correctly dates it as: Nov 6, 2025')
  console.log('')
  console.log('='.repeat(60))
  console.log('\n💡 Key Insight:')
  console.log('  - ESPN: Uses "display date" (what day fans see)')
  console.log('  - Odds API: Uses "actual start time" (commence_time in UTC)')
  console.log('  - Both are correct, just different reference points!')
  console.log('')
  console.log('🔧 Our Solution:')
  console.log('  - Store games using the queried date (Nov 5) for display')
  console.log('  - Map Odds API games (Nov 6) to our games (Nov 5) by team names')
  console.log('  - Use ±3-4 day date range when matching to catch timezone differences')
  console.log('')
  
  // Fetch actual example
  console.log('📡 Fetching real example from Odds API...\n')
  const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds?regions=us&markets=h2h&dateFormat=iso&apiKey=${ODDS_API_KEY}`
  
  try {
    const response = await fetch(url)
    const games = await response.json()
    
    // Find CHI @ VAN game
    const chiVanGame = games.find(g => 
      (g.away_team.includes('Chicago') && g.home_team.includes('Vancouver')) ||
      (g.away_team.includes('Vancouver') && g.home_team.includes('Chicago'))
    )
    
    if (chiVanGame) {
      const commenceTime = new Date(chiVanGame.commence_time)
      const gameDate = commenceTime.toISOString().split('T')[0]
      const localTime = commenceTime.toLocaleString('en-US', { timeZone: 'America/New_York' })
      
      console.log(`Found: ${chiVanGame.away_team} @ ${chiVanGame.home_team}`)
      console.log(`  Odds API commence_time: ${chiVanGame.commence_time}`)
      console.log(`  Date in UTC: ${gameDate}`)
      console.log(`  Local time (EST): ${localTime}`)
      console.log(`  So Odds API correctly dates it as: ${gameDate}`)
      console.log(`  But fans see it as: ${new Date(commenceTime.getTime() - 5 * 60 * 60 * 1000).toISOString().split('T')[0]}`)
      console.log('')
    }
  } catch (error) {
    console.log('  (Could not fetch example - API key might be needed)')
  }
  
  console.log('='.repeat(60))
  console.log('\n✅ Summary:')
  console.log('  Odds API dates are NOT wrong - they\'re using actual start times in UTC.')
  console.log('  This is why we need to match by team names across date ranges!')
}

explain().catch(console.error)

