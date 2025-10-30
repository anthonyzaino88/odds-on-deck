// Demo/Portfolio Mode Configuration
// Optimizes API usage for The Odds API free tier (500 requests/month)

export const DEMO_CONFIG = {
  // Demo mode detection
  ENABLED: process.env.DEMO_MODE === 'true',
  
  // API Configuration for FREE tier
  API_LIMITS: {
    MONTHLY: 500,                    // Free tier limit
    DAILY: 16,                       // ~500/30 days
    HOURLY: 2,                       // Conservative limit
    MIN_INTERVAL_MINUTES: 120        // 2 hours between fetches
  },
  
  // Cache Configuration (Extended for demo)
  CACHE: {
    DURATION_MINUTES: 120,           // 2 hours (4x normal)
    AGGRESSIVE_MODE: true,           // Use stale cache aggressively
    EXPIRE_BEFORE_GAME: 60          // 1 hour before game
  },
  
  // Feature Flags
  FEATURES: {
    AUTO_REFRESH: false,             // Disable auto-refresh to save calls
    LIVE_SCORING: true,              // Keep live scores (uses free ESPN API)
    VALIDATION: true,                // Show validation system working
    PROP_GENERATION: true            // Enable prop generation
  },
  
  // Sports Configuration
  SPORTS: {
    ENABLED: ['mlb', 'nfl', 'nhl'],  // All sports available
    PRIMARY_FOCUS: 'mlb',            // Can focus on one to conserve API
    ROTATE_SEASONAL: true            // Auto-switch based on season
  },
  
  // UI Configuration
  UI: {
    SHOW_DEMO_BANNER: true,          // "Portfolio Demo" banner
    SHOW_API_USAGE: true,            // Display remaining API calls
    SHOW_TECH_STACK: true,           // Highlight technologies used
    GITHUB_LINK: 'https://github.com/yourusername/odds-on-deck'
  },
  
  // Rate Limiting
  RATE_LIMITS: {
    MAX_PARLAYS_PER_SESSION: 20,    // Prevent excessive generation
    MAX_PROPS_PER_SPORT: 100,       // Limit prop count
    COOLDOWN_BETWEEN_REQUESTS: 5000 // 5 seconds between user requests
  },
  
  // Fallback Configuration
  FALLBACK: {
    USE_MODEL_PROPS: true,           // Use estimated props when API exhausted
    CACHE_MISS_BEHAVIOR: 'model',   // 'model' or 'empty'
    SHOW_FALLBACK_NOTICE: true      // Notify user when using estimates
  }
}

// Helper: Check if demo mode is active
export function isDemoMode() {
  return DEMO_CONFIG.ENABLED
}

// Helper: Get current sport (seasonal rotation)
export function getDemoSport() {
  if (!DEMO_CONFIG.SPORTS.ROTATE_SEASONAL) {
    return DEMO_CONFIG.SPORTS.PRIMARY_FOCUS
  }
  
  const month = new Date().getMonth() + 1 // 1-12
  
  // MLB: April-October (4-10)
  if (month >= 4 && month <= 10) return 'mlb'
  
  // NFL: September-February (9-12, 1-2)
  if (month >= 9 || month <= 2) return 'nfl'
  
  // NHL: October-June (10-12, 1-6)
  if (month >= 10 || month <= 6) return 'nhl'
  
  // Default
  return 'mlb'
}

// Helper: Should fetch from API?
export function shouldFetchInDemo(lastFetchTime) {
  if (!isDemoMode()) return true
  
  if (!lastFetchTime) return true
  
  const minutesSinceLastFetch = (Date.now() - lastFetchTime) / 1000 / 60
  return minutesSinceLastFetch >= DEMO_CONFIG.API_LIMITS.MIN_INTERVAL_MINUTES
}

// Helper: Get cache duration
export function getCacheDuration() {
  return isDemoMode() 
    ? DEMO_CONFIG.CACHE.DURATION_MINUTES 
    : 30 // Normal mode: 30 minutes
}

export default DEMO_CONFIG

