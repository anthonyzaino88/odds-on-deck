// Bulk update prop results manually
// Use this if you have a CSV or list of prop results
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function bulkUpdatePropResults() {
  console.log('\n📝 Bulk Update Prop Results\n')
  
  // Example: Add your prop results here
  // Format: { playerName, propType, actualValue, date }
  const propResults = [
    // Example entries (replace with your actual data):
    // { playerName: 'David Pastrnak', propType: 'assists', actualValue: 1, date: '2025-10-17' },
    // { playerName: 'Tage Thompson', propType: 'goals', actualValue: 2, date: '2025-10-17' },
    // Add more here...
  ]
  
  console.log(`Processing ${propResults.length} prop results...\n`)
  
  let updated = 0
  let notFound = 0
  
  for (const result of propResults) {
    console.log(`\n📊 ${result.playerName} - ${result.propType}`)
    console.log(`   Actual Value: ${result.actualValue}`)
    
    // Find matching validation record
    const validations = await prisma.propValidation.findMany({
      where: {
        playerName: result.playerName,
        propType: result.propType,
        status: { in: ['pending', 'needs_review', 'invalid'] }
      }
    })
    
    if (validations.length === 0) {
      console.log(`   ⚠️ No matching validation found`)
      notFound++
      continue
    }
    
    for (const validation of validations) {
      // Determine result
      let resultStr = 'incorrect'
      if (result.actualValue === validation.threshold) {
        resultStr = 'push'
      } else if (
        (validation.prediction === 'over' && result.actualValue > validation.threshold) ||
        (validation.prediction === 'under' && result.actualValue < validation.threshold)
      ) {
        resultStr = 'correct'
      }
      
      const resultEmoji = resultStr === 'correct' ? '✅' : resultStr === 'push' ? '🟰' : '❌'
      console.log(`   ${resultEmoji} ${validation.prediction.toUpperCase()} ${validation.threshold} → ${resultStr.toUpperCase()}`)
      
      // Update the record
      await prisma.propValidation.update({
        where: { id: validation.id },
        data: {
          actualValue: result.actualValue,
          result: resultStr,
          status: 'completed',
          completedAt: new Date(),
          notes: `Manually updated with actual result: ${result.actualValue}`
        }
      })
      
      updated++
    }
  }
  
  console.log(`\n\n📊 Summary:`)
  console.log(`   ✅ Updated: ${updated} validations`)
  console.log(`   ⚠️ Not Found: ${notFound} props`)
  
  await prisma.$disconnect()
}

bulkUpdatePropResults().catch(console.error)




