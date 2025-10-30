// Mark NHL props that are assigned to wrong games as "invalid"
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function markInvalidProps() {
  console.log('\n🔧 Marking invalid NHL props...\n')
  
  // Get all "needs_review" NHL props
  const props = await prisma.propValidation.findMany({
    where: { 
      status: 'needs_review',
      sport: 'nhl'
    }
  })
  
  console.log(`Found ${props.length} NHL props marked as "needs_review"`)
  
  if (props.length === 0) {
    console.log('✅ No props to update!')
    await prisma.$disconnect()
    return
  }
  
  // Mark them as invalid
  const result = await prisma.propValidation.updateMany({
    where: {
      status: 'needs_review',
      sport: 'nhl'
    },
    data: {
      status: 'invalid',
      result: 'invalid',
      notes: 'INVALID: Prop assigned to wrong game - player was not in this game. Bug in NHL prop generation.'
    }
  })
  
  console.log(`\n✅ Updated ${result.count} props to "invalid" status`)
  console.log(`\nReason: Props were assigned to wrong games (game assignment bug in NHL prop generator)`)
  console.log(`\nThese props cannot be validated because the players weren't actually in those games.`)
  console.log(`\nNext step: Fix NHL prop generator to correctly assign props to player's actual games.`)
  
  await prisma.$disconnect()
}

markInvalidProps().catch(console.error)




