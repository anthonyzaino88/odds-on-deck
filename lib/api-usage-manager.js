// API Usage Manager - Responsible odds API usage
// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

// API Usage Configuration
const API_CONFIG = {
  // Much more conservative limits to avoid excessive API usage
  MAX_CALLS_PER_HOUR: 5, // Reduced from 20 to 5 calls/hour = 3,600/month (well under 20k limit)
  MIN_INTERVAL_MINUTES: 60, // Increased from 5 to 60 minutes between odds fetches
  
  // Cost per API call (based on documentation)
  COST_PER_CALL: 30, // 3 markets × 1 region × 10 = 30 credits
  
  // Sports to fetch (can be configured)
  SPORTS: ['mlb', 'nfl', 'nhl'],
  
  // Monthly budget management
  MONTHLY_LIMIT: 20000,
  DAILY_LIMIT: Math.floor(20000 / 30), // ~667 calls/day
  HOURLY_LIMIT: Math.floor(667 / 24), // ~28 calls/hour (but we use 5 for safety)
  
  // Cooldown configuration
  REFRESH_COOLDOWN_MINUTES: 60, // 1 hour cooldown between manual refreshes
  LAST_REFRESH_TIME: null // Will be updated when refresh occurs
}

/**
 * Check if we should fetch odds based on usage limits and smart timing
 */
export async function shouldFetchOdds(sport = 'mlb') {
  try {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const minIntervalAgo = new Date(now.getTime() - API_CONFIG.MIN_INTERVAL_MINUTES * 60 * 1000)
    
    // 1. Check recent API calls in the last hour
    // Count unique timestamps (each timestamp represents one API call that returned multiple odds)
    const recentCalls = await prisma.odds.findMany({
      where: {
        ts: {
          gte: oneHourAgo
        }
      },
      select: {
        ts: true
      },
      distinct: ['ts']
    })
    
    const totalRecentCalls = recentCalls.length
    
    if (totalRecentCalls >= API_CONFIG.MAX_CALLS_PER_HOUR) {
      console.log(`⏰ API limit reached: ${totalRecentCalls} calls in last hour (max: ${API_CONFIG.MAX_CALLS_PER_HOUR})`)
      return { shouldFetch: false, reason: 'hourly_limit_reached', callsThisHour: totalRecentCalls }
    }
    
    // 2. Check if we already have odds for today's games (more permissive)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayAfterTomorrow = new Date(today)
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)

    // First check if we have ANY odds for today's games
    const todaysOddsCount = await prisma.odds.count({
      where: {
        game: {
          date: {
            gte: today,
            lt: dayAfterTomorrow
          }
        }
      }
    })

    // If we have odds for today's games, check if they're recent enough
    if (todaysOddsCount > 0) {
      const mostRecentOdds = await prisma.odds.findFirst({
        where: {
          game: {
            date: {
              gte: today,
              lt: dayAfterTomorrow
            }
          }
        },
        orderBy: {
          ts: 'desc'
        }
      })

      if (mostRecentOdds) {
        const timeSinceLastFetch = now - new Date(mostRecentOdds.ts)
        const minutesSinceLastFetch = Math.floor(timeSinceLastFetch / (1000 * 60))

        // For sports betting, we want to be conservative with API usage
        // Increased from 15 minutes to match MIN_INTERVAL_MINUTES (60 minutes)
        const maxAgeMinutes = API_CONFIG.MIN_INTERVAL_MINUTES

        if (minutesSinceLastFetch < maxAgeMinutes) {
          console.log(`⏭️ Skipping ${sport.toUpperCase()} odds fetch - have ${todaysOddsCount} odds from ${minutesSinceLastFetch} minutes ago (max age: ${maxAgeMinutes} min)`)
          return {
            shouldFetch: false,
            reason: 'recent_data_available',
            minutesSinceLastFetch,
            lastFetchTime: mostRecentOdds.ts,
            oddsCount: todaysOddsCount
          }
        } else {
          console.log(`📊 Odds are ${minutesSinceLastFetch} minutes old - allowing refresh if within rate limits`)
          
          // Check if we're within the cooldown period for manual refreshes
          if (API_CONFIG.LAST_REFRESH_TIME) {
            const timeSinceLastRefresh = now - new Date(API_CONFIG.LAST_REFRESH_TIME)
            const minutesSinceLastRefresh = Math.floor(timeSinceLastRefresh / (1000 * 60))
            
            if (minutesSinceLastRefresh < API_CONFIG.REFRESH_COOLDOWN_MINUTES) {
              console.log(`⏭️ Skipping ${sport.toUpperCase()} odds fetch - manual refresh cooldown (${minutesSinceLastRefresh}/${API_CONFIG.REFRESH_COOLDOWN_MINUTES} minutes)`)
              return {
                shouldFetch: false,
                reason: 'refresh_cooldown',
                minutesSinceLastRefresh,
                cooldownMinutes: API_CONFIG.REFRESH_COOLDOWN_MINUTES,
                remainingCooldown: API_CONFIG.REFRESH_COOLDOWN_MINUTES - minutesSinceLastRefresh
              }
            }
          }
        }
      }
    }
    
    // 3. Smart timing: Fetch odds for games today and tomorrow (for playoffs analysis)
    
    // Check for games today and tomorrow (including playoffs)
    const recentGames = await prisma.game.findMany({
      where: {
        sport: sport,
        date: {
          gte: today,
          lt: dayAfterTomorrow
        },
        status: {
          in: ['scheduled', 'pre_game', 'in_progress', 'final']
        }
      },
      take: 1
    })
    
    if (recentGames.length === 0) {
      console.log(`⏭️ No ${sport.toUpperCase()} games today or tomorrow - skipping odds fetch`)
      return { shouldFetch: false, reason: 'no_recent_games' }
    }
    
    // 4. Check if we have any odds data for today's games
    const todaysOdds = await prisma.odds.findFirst({
      where: {
        ts: {
          gte: today,
          lt: dayAfterTomorrow
        }
      }
    })
    
    if (!todaysOdds) {
      console.log(`📊 No odds data for today's ${sport.toUpperCase()} games - allowing fetch`)
      return { shouldFetch: true, reason: 'no_todays_data' }
    }
    
    // 5. Allow fetch if we're within limits and have recent games
    console.log(`✅ Allowing ${sport.toUpperCase()} odds fetch - ${totalRecentCalls}/${API_CONFIG.MAX_CALLS_PER_HOUR} calls used this hour`)
    return { 
      shouldFetch: true, 
      reason: 'recent_games', 
      callsThisHour: totalRecentCalls,
      remainingCalls: API_CONFIG.MAX_CALLS_PER_HOUR - totalRecentCalls,
      recentGames: recentGames.length
    }
    
  } catch (error) {
    console.error('Error checking API usage:', error)
    // Default to NOT fetching if there's an error (conservative approach)
    return { shouldFetch: false, reason: 'error_default_deny' }
  }
}

/**
 * Log API usage for monitoring
 */
export async function logApiUsage(sport, oddsCount, success = true) {
  try {
    const now = new Date();
    const usage = {
      sport,
      oddsCount,
      success,
      timestamp: now,
      cost: API_CONFIG.COST_PER_CALL
    }
    
    console.log(`📊 API Usage Log: ${sport.toUpperCase()} - ${oddsCount} odds, Cost: ${usage.cost} credits, Success: ${success}`)
    
    // Update last refresh time
    if (success) {
      API_CONFIG.LAST_REFRESH_TIME = now;
      console.log(`⏱️ Updated last refresh time: ${now.toLocaleTimeString()}, next refresh available at ${new Date(now.getTime() + API_CONFIG.REFRESH_COOLDOWN_MINUTES * 60 * 1000).toLocaleTimeString()}`)
    }
    
    // Could store in database for detailed tracking
    // await prisma.apiUsageLog.create({ data: usage })
    
  } catch (error) {
    console.error('Error logging API usage:', error)
  }
}

/**
 * Get API usage statistics
 */
export async function getApiUsageStats() {
  try {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    
    // Hourly usage
    const hourlyUsage = await prisma.odds.groupBy({
      by: ['ts'],
      where: {
        ts: {
          gte: oneHourAgo
        }
      },
      _count: {
        id: true
      }
    })
    
    const callsThisHour = hourlyUsage.reduce((sum, call) => sum + call._count.id, 0)
    
    // Daily usage
    const dailyUsage = await prisma.odds.groupBy({
      by: ['ts'],
      where: {
        ts: {
          gte: oneDayAgo
        }
      },
      _count: {
        id: true
      }
    })
    
    const callsToday = dailyUsage.reduce((sum, call) => sum + call._count.id, 0)
    
    return {
      callsThisHour,
      callsToday,
      maxCallsPerHour: API_CONFIG.MAX_CALLS_PER_HOUR,
      remainingCallsThisHour: Math.max(0, API_CONFIG.MAX_CALLS_PER_HOUR - callsThisHour),
      estimatedCostToday: callsToday * API_CONFIG.COST_PER_CALL,
      lastFetch: hourlyUsage.length > 0 ? hourlyUsage[0].ts : null
    }
    
  } catch (error) {
    console.error('Error getting API usage stats:', error)
    return null
  }
}

/**
 * Check if a manual refresh is allowed based on cooldown
 */
export function canRefresh() {
  if (!API_CONFIG.LAST_REFRESH_TIME) {
    return { 
      canRefresh: true, 
      reason: 'no_previous_refresh'
    };
  }
  
  const now = new Date();
  const timeSinceLastRefresh = now - new Date(API_CONFIG.LAST_REFRESH_TIME);
  const minutesSinceLastRefresh = Math.floor(timeSinceLastRefresh / (1000 * 60));
  
  if (minutesSinceLastRefresh < API_CONFIG.REFRESH_COOLDOWN_MINUTES) {
    return {
      canRefresh: false,
      reason: 'cooldown_active',
      minutesSinceLastRefresh,
      cooldownMinutes: API_CONFIG.REFRESH_COOLDOWN_MINUTES,
      remainingMinutes: API_CONFIG.REFRESH_COOLDOWN_MINUTES - minutesSinceLastRefresh,
      nextRefreshTime: new Date(new Date(API_CONFIG.LAST_REFRESH_TIME).getTime() + API_CONFIG.REFRESH_COOLDOWN_MINUTES * 60 * 1000)
    };
  }
  
  return {
    canRefresh: true,
    reason: 'cooldown_expired',
    lastRefreshTime: API_CONFIG.LAST_REFRESH_TIME
  };
}

export { API_CONFIG }
