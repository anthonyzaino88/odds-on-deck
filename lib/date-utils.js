// Centralized date utilities for consistent timezone handling across the app
// Ensures we always get the correct "today" regardless of server timezone

/**
 * Get the current date in a specific timezone
 * @param {string} timezone - IANA timezone (e.g., 'America/New_York')
 * @returns {Date} Date object representing "now" in that timezone
 */
export function getDateInTimezone(timezone = 'America/New_York') {
  // Create date string in the target timezone
  const dateString = new Date().toLocaleString('en-US', { 
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  
  return new Date(dateString)
}

/**
 * Get start and end of "today" in Eastern Time (where most US sports are scheduled)
 * This is the definitive "today" for our app
 */
export function getTodayRange() {
  const now = getDateInTimezone('America/New_York')
  
  // Start of today (midnight ET)
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  
  // End of today (11:59:59 PM ET)
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  
  return { startOfToday, endOfToday }
}

/**
 * Get a wider date range for "today's games"
 * Includes yesterday and tomorrow to catch:
 * - Late night games that started yesterday
 * - Early morning games (west coast games ending after midnight ET)
 * - Games listed for tomorrow that start late tonight
 */
export function getTodaysGamesRange() {
  const now = getDateInTimezone('America/New_York')
  
  // 12 hours before today (6 PM yesterday in ET)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setHours(start.getHours() - 12)
  
  // 12 hours after today (12 PM tomorrow in ET)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  end.setHours(end.getHours() + 12)
  
  return { start, end }
}

/**
 * Check if a game date is "today" in Eastern Time
 */
export function isToday(gameDate) {
  const { startOfToday, endOfToday } = getTodayRange()
  const date = new Date(gameDate)
  
  return date >= startOfToday && date <= endOfToday
}

/**
 * Check if a game should be shown on "today's slate"
 * More permissive - includes games from late yesterday through early tomorrow
 */
export function isOnTodaysSlate(gameDate) {
  const { start, end } = getTodaysGamesRange()
  const date = new Date(gameDate)
  
  return date >= start && date <= end
}

/**
 * Get the current date in Eastern Time (for display/logging)
 */
export function getCurrentDateET() {
  return getDateInTimezone('America/New_York')
}

/**
 * Format current time for logging
 */
export function logCurrentTime() {
  const et = getCurrentDateET()
  console.log(`🕐 Current time (ET): ${et.toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    dateStyle: 'full',
    timeStyle: 'long'
  })}`)
  
  const { startOfToday, endOfToday } = getTodayRange()
  console.log(`📅 Today's range: ${startOfToday.toISOString()} to ${endOfToday.toISOString()}`)
}

/**
 * Get date ranges for active games query
 * Returns UTC timestamps suitable for Prisma queries
 */
export function getActiveGamesDateRange() {
  const now = getDateInTimezone('America/New_York')
  
  // Games from 6 hours ago through 24 hours from now
  // This catches:
  // - Games currently in progress
  // - Games that just finished (for final scores)
  // - Games starting soon/today
  const start = new Date(now)
  start.setHours(start.getHours() - 6)
  
  const end = new Date(now)
  end.setHours(end.getHours() + 24)
  
  return { 
    gte: start.toISOString(), 
    lt: end.toISOString() 
  }
}

