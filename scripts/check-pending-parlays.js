const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function checkPendingParlays() {
  // Get all parlays with their legs
  const parlays = await prisma.parlay.findMany({
    where: { status: 'pending' },
    include: { legs: true },
    orderBy: { createdAt: 'desc' }
  })
  
  console.log('=== PENDING PARLAYS ===')
  console.log('Total pending:', parlays.length)
  
  for (const parlay of parlays) {
    console.log('\n--- Parlay:', parlay.id.slice(0, 8), '---')
    console.log('Sport:', parlay.sport)
    console.log('Created:', parlay.createdAt.toISOString().split('T')[0])
    console.log('Legs:')
    
    for (const leg of parlay.legs) {
      const propType = leg.propType || leg.betType || 'unknown'
      const player = leg.playerName || leg.selection || 'N/A'
      console.log('  -', player, '|', propType, '| threshold:', leg.threshold, '| selection:', leg.selection, '| outcome:', leg.outcome || 'pending')
    }
  }
  
  await prisma.$disconnect()
}

checkPendingParlays().catch(console.error)

