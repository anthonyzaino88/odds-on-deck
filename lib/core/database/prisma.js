/**
 * Single Prisma Client Instance
 * 
 * IMPORTANT: This is the ONLY place where PrismaClient should be instantiated.
 * All other files should import { prisma } from this file.
 * 
 * This prevents:
 * - Connection pool exhaustion
 * - Memory leaks in serverless environments
 * - "Too many connections" errors
 * - Inconsistent database state
 */

import { PrismaClient } from '@prisma/client'

// Singleton pattern for Prisma client
const globalForPrisma = globalThis

/**
 * Single Prisma instance with optimized configuration
 */
export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'],
  
  // Optimize connection pooling for Vercel serverless
  // CRITICAL: Use SUPABASE_DATABASE_URL if DATABASE_URL is SQLite (cached build issue)
  datasources: {
    db: {
      url: (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('file:'))
        ? process.env.DATABASE_URL
        : (process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL)
    }
  },
  
  // Connection pool configuration (critical for production)
  // These values prevent connection exhaustion
  __internal: {
    engine: {
      // Limit concurrent connections per serverless function
      connection_limit: process.env.NODE_ENV === 'production' ? 5 : 10,
      pool_timeout: 10, // seconds
      connect_timeout: 5, // seconds
    }
  }
})

// Ensure single instance in development (hot reload protection)
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

/**
 * Graceful shutdown helper
 * Call this when your app shuts down
 */
export async function disconnectPrisma() {
  await prisma.$disconnect()
  console.log('✅ Prisma disconnected')
}

/**
 * Health check helper
 * Use this to verify database connectivity
 */
export async function checkDatabaseConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return { connected: true }
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    return { connected: false, error: error.message }
  }
}

// Handle graceful shutdown
if (typeof process !== 'undefined') {
  process.on('beforeExit', async () => {
    await disconnectPrisma()
  })
}

export default prisma


