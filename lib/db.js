// Database utilities - NOW USING SUPABASE
// This file re-exports everything from db-supabase.js for backward compatibility

// Export all functions from the Supabase version
export {
  supabase,
  upsertTeam,
  upsertPlayer,
  upsertGame,
  createOdds,
  createEdgeSnapshot,
  getTodaysGames,
  getGameDetail,
  getPlayersForDFS,
  cleanupOldOdds,
  cleanupOldEdgeSnapshots,
  checkDatabaseConnection,
  disconnectDatabase
} from './db-supabase.js'

// For backward compatibility, export disconnectPrisma alias
export { 
  disconnectDatabase as disconnectPrisma 
} from './db-supabase.js'

// Legacy Prisma export (will be removed after full migration)
// This is here temporarily for files that directly use `prisma`
import { PrismaClient } from '@prisma/client'
export const prisma = new PrismaClient()
