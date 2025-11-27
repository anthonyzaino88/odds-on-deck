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
 * Get date range for "today's games"
 * Shows games scheduled for today (midnight to 11:59 PM ET)
 * Plus games that started late yesterday and are still in progress
 */
export function getTodaysGamesRange() {
  const now = getDateInTimezone('America/New_York')
  
  // Start: 6 hours before midnight today (catches late games from yesterday still in progress)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setHours(start.getHours() - 6)
  
  // End: 6 hours after midnight tomorrow (catches games starting late tonight)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  tomorrow.setHours(tomorrow.getHours() + 6)
  
  return { start, end: tomorrow }
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

/**
 * Parse a date from Supabase ensuring UTC interpretation
 * Supabase returns timestamps without 'Z' suffix, causing local time interpretation
 * This function ensures consistent UTC parsing
 * 
 * @param {string} dateString - Date string from Supabase (e.g., "2025-11-27T00:00:00")
 * @returns {Date} Date object correctly parsed as UTC
 */
export function parseSupabaseDate(dateString) {
  if (!dateString) return null
  
  // If it already ends with Z, parse directly
  if (dateString.endsWith('Z')) {
    return new Date(dateString)
  }
  
  // Add Z suffix to force UTC interpretation
  return new Date(dateString + 'Z')
}

/**
 * Format a Supabase date for proper UTC handling
 * Ensures the date string has Z suffix for consistent parsing
 * 
 * @param {string} dateString - Date string from Supabase
 * @returns {string} Date string with Z suffix
 */
export function ensureUTCFormat(dateString) {
  if (!dateString) return null
  return dateString.endsWith('Z') ? dateString : dateString + 'Z'
}

