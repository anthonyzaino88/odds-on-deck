#!/usr/bin/env node

/**
 * Compare how NFL vs NHL games are processed from ESPN
 */

async function compareTimes() {
  console.log('🔍 Comparing NFL vs NHL game time handling...\n')
  
  // Test NFL
  console.log('📊 NFL Games:')
  const nflUrl = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
  try {
    const nflResponse = await fetch(nflUrl, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    if (nflResponse.ok) {
      const nflData = await nflResponse.json()
      const nflEvents = nflData.events || []
      if (nflEvents.length > 0) {
        const nflEvent = nflEvents[0]
        console.log(`   Event ID: ${nflEvent.id}`)
        console.log(`   Event date: ${nflEvent.date}`)
        const nflDate = new Date(nflEvent.date)
        console.log(`   Parsed (UTC): ${nflDate.toISOString()}`)
        console.log(`   Parsed (EST): ${nflDate.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })}`)
        console.log(`   Competition date: ${nflEvent.competitions?.[0]?.date}`)
        if (nflEvent.competitions?.[0]?.startDate) {
          console.log(`   Start date: ${nflEvent.competitions?.[0]?.startDate}`)
        }
      }
    }
  } catch (error) {
    console.error('   Error:', error.message)
  }
  
  // Test NHL
  console.log('\n📊 NHL Games:')
  const nhlUrl = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=20251106'
  try {
    const nhlResponse = await fetch(nhlUrl, {
      headers: { 'User-Agent': 'OddsOnDeck/1.0' }
    })
    if (nhlResponse.ok) {
      const nhlData = await nhlResponse.json()
      const nhlEvents = nhlData.events || []
      if (nhlEvents.length > 0) {
        const nhlEvent = nhlEvents[0]
        console.log(`   Event ID: ${nhlEvent.id}`)
        console.log(`   Event date: ${nhlEvent.date}`)
        const nhlDate = new Date(nhlEvent.date)
        console.log(`   Parsed (UTC): ${nhlDate.toISOString()}`)
        console.log(`   Parsed (EST): ${nhlDate.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })}`)
        console.log(`   Competition date: ${nhlEvent.competitions?.[0]?.date}`)
        if (nhlEvent.competitions?.[0]?.startDate) {
          console.log(`   Start date: ${nhlEvent.competitions?.[0]?.startDate}`)
        }
      }
    }
  } catch (error) {
    console.error('   Error:', error.message)
  }
  
  console.log('\n💡 Key Difference:')
  console.log('   NFL: Uses event.date directly (has actual game times)')
  console.log('   NHL: Uses queried date with T00:00:00Z (sets all times to midnight UTC)')
  console.log('   → This is why NHL games all show the same time!')
}

compareTimes()

