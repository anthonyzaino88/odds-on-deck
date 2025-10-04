// Setup script for automatic data refresh
// This can be run as a cron job or scheduled task

const https = require('https')
const http = require('http')

const REFRESH_URL = 'http://localhost:3000/api/cron/auto-refresh'
const REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutes

function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    
    const req = client.get(url, (res) => {
      let data = ''
      
      res.on('data', (chunk) => {
        data += chunk
      })
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          resolve(result)
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`))
        }
      })
    })
    
    req.on('error', (error) => {
      reject(error)
    })
    
    req.setTimeout(30000, () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
  })
}

async function performRefresh() {
  try {
    console.log(`[${new Date().toISOString()}] Starting automatic refresh...`)
    
    const result = await makeRequest(REFRESH_URL)
    
    if (result.success) {
      console.log(`[${new Date().toISOString()}] ✅ Refresh successful:`)
      console.log(`   Teams: ${result.stats.teamsUpdated}`)
      console.log(`   Games: ${result.stats.gamesUpdated}`)
      console.log(`   Odds: ${result.stats.oddsUpdated}`)
      console.log(`   Edges: ${result.stats.edgesCalculated}`)
      console.log(`   Live Scores: ${result.stats.liveScoresUpdated}`)
      console.log(`   NFL Games: ${result.stats.nflGamesUpdated}`)
    } else {
      console.error(`[${new Date().toISOString()}] ❌ Refresh failed:`, result.error)
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Refresh error:`, error.message)
  }
}

// Run immediately
performRefresh()

// Then run every 5 minutes
setInterval(performRefresh, REFRESH_INTERVAL)

console.log(`🔄 Auto-refresh cron job started. Refreshing every ${REFRESH_INTERVAL / 1000 / 60} minutes.`)
console.log(`📡 Server URL: ${REFRESH_URL}`)
console.log('Press Ctrl+C to stop.')
