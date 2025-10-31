// Quick script to delete old game records
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🗑️ Deleting old MLB games causing 500 errors...')
  
  // Delete all games older than November 1, 2024 (before current season)
  const result = await prisma.game.deleteMany({
    where: {
      date: {
        lt: new Date('2024-11-01')
      }
    }
  })
  
  console.log(`✅ Deleted ${result.count} old games`)
  
  // Also delete any games with old seasons
  const mlbResult = await prisma.game.deleteMany({
    where: {
      sport: 'mlb',
      OR: [
        { date: { lt: new Date('2025-03-01') } }, // Before 2025 MLB season
        { 
          AND: [
            { status: 'final' }, 
            { date: { lt: new Date('2025-10-01') } }
          ]
        } // Completed games before October
      ]
    }
  })
  
  console.log(`✅ Deleted ${mlbResult.count} old MLB games`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

