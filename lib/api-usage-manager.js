// API Usage Manager - Responsible odds API usage
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// API Usage Configuration
const API_CONFIG = {
  // Conservative limits for 20,000 monthly calls
  MAX_CALLS_PER_HOUR: 3, // Very conservative - 3 calls/hour = 2,160/month
  MIN_INTERVAL_MINUTES: 60, // Minimum 1 hour between odds fetches
  
  // Cost per API call (based on documentation)
  COST_PER_CALL: 30, // 3 markets × 1 region × 10 = 30 credits
  
  // Sports to fetch (can be configured)
  SPORTS: ['mlb', 'nfl'],
  
  // Monthly budget management
  MONTHLY_LIMIT: 20000,
  DAILY_LIMIT: Math.floor(20000 / 30), // ~667 calls/day
  HOURLY_LIMIT: Math.floor(667 / 24) // ~28 calls/hour (but we use 3 for safety)
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
    const recentCalls = await prisma.odds.groupBy({
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
    
    const totalRecentCalls = recentCalls.reduce((sum, call) => sum + call._count.id, 0)
    
    if (totalRecentCalls >= API_CONFIG.MAX_CALLS_PER_HOUR) {
      console.log(`⏰ API limit reached: ${totalRecentCalls} calls in last hour (max: ${API_CONFIG.MAX_CALLS_PER_HOUR})`)
      return { shouldFetch: false, reason: 'hourly_limit_reached', callsThisHour: totalRecentCalls }
    }
    
    // 2. Check if we have recent odds data (within minimum interval)
    const recentOdds = await prisma.odds.findFirst({
      where: {
        ts: {
          gte: minIntervalAgo
        }
      },
      orderBy: {
        ts: 'desc'
      }
    })
    
    if (recentOdds) {
      const timeSinceLastFetch = now - new Date(recentOdds.ts)
      const minutesSinceLastFetch = Math.floor(timeSinceLastFetch / (1000 * 60))
      
      console.log(`⏭️ Skipping odds fetch - last fetch was ${minutesSinceLastFetch} minutes ago (min interval: ${API_CONFIG.MIN_INTERVAL_MINUTES} min)`)
      return { 
        shouldFetch: false, 
        reason: 'recent_data_available', 
        minutesSinceLastFetch,
        lastFetchTime: recentOdds.ts
      }
    }
    
    // 3. Smart timing: Fetch odds for games today and tomorrow (for playoffs analysis)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayAfterTomorrow = new Date(today)
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
    
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
    const usage = {
      sport,
      oddsCount,
      success,
      timestamp: new Date(),
      cost: API_CONFIG.COST_PER_CALL
    }
    
    console.log(`📊 API Usage Log: ${sport.toUpperCase()} - ${oddsCount} odds, Cost: ${usage.cost} credits, Success: ${success}`)
    
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

export { API_CONFIG }
