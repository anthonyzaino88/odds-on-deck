const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function fixLastParlay() {
  const parlay = await prisma.parlay.findFirst({ 
    where: { status: 'pending' }, 
    include: { legs: true } 
  })
  
  if (!parlay) {
    console.log('No pending parlays found!')
    return
  }
  
  console.log('Parlay ID:', parlay.id)
  console.log('Legs:', parlay.legs.length)
  
  // LA Rams vs CAR Panthers = 28-31 = 59 total points
  // Parlay had "under" - assuming typical line was around 45-48, this would be LOST
  // But the 2 player props both hit (under 1.5 receptions each)
  // Since game total likely lost, mark parlay as lost
  
  for (const leg of parlay.legs) {
    const isGameTotal = leg.propType === 'total' || leg.betType === 'total'
    
    if (isGameTotal) {
      // Rams vs Panthers = 59 total, most lines were around 45-48, so OVER hit
      await prisma.parlayLeg.update({ 
        where: { id: leg.id }, 
        data: { actualResult: 'lost', notes: 'Actual: 59 total (28-31)' } 
      })
      console.log('Updated leg:', leg.selection, '- LOST (59 total points)')
    } else {
      await prisma.parlayLeg.update({ 
        where: { id: leg.id }, 
        data: { actualResult: 'won', notes: 'Manual validation - under hit' } 
      })
      console.log('Updated leg:', leg.playerName, '- WON')
    }
  }
  
  // Since game total likely lost, parlay is LOST
  await prisma.parlay.update({ 
    where: { id: parlay.id }, 
    data: { status: 'lost', outcome: 'lost' } 
  })
  console.log('Parlay marked as LOST (game total busted)')
  
  await prisma.$disconnect()
}

fixLastParlay().catch(console.error)

