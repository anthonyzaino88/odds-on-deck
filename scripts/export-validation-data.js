// Export validation data from local database to SQL insert statements
// This can be run on Vercel to populate the production database

import { PrismaClient } from '@prisma/client'
import fs from 'fs'

const prisma = new PrismaClient()

async function exportValidationData() {
  console.log('📦 Exporting validation data from local database...')
  
  try {
    // Get all prop validations
    const props = await prisma.propValidation.findMany({
      orderBy: { timestamp: 'desc' }
    })
    
    console.log(`✅ Found ${props.length} prop validations`)
    
    // Convert to SQL INSERT statements
    const sqlStatements = props.map(prop => {
      const values = [
        `'${prop.id}'`,
        `'${prop.propId}'`,
        `'${prop.gameIdRef}'`,
        `'${prop.playerName.replace(/'/g, "''")}'`, // Escape single quotes
        `'${prop.propType}'`,
        prop.threshold,
        `'${prop.prediction}'`,
        prop.projectedValue,
        `'${prop.confidence}'`,
        prop.edge,
        prop.odds || 'NULL',
        prop.probability || 'NULL',
        prop.qualityScore || 'NULL',
        `'${prop.source || 'system_generated'}'`,
        prop.parlayId ? `'${prop.parlayId}'` : 'NULL',
        prop.actualValue !== null ? prop.actualValue : 'NULL',
        prop.result ? `'${prop.result}'` : 'NULL',
        `'${prop.status}'`,
        prop.sport ? `'${prop.sport}'` : 'NULL',
        `'${prop.timestamp.toISOString()}'`,
        prop.completedAt ? `'${prop.completedAt.toISOString()}'` : 'NULL',
        prop.notes ? `'${prop.notes.replace(/'/g, "''")}'` : 'NULL'
      ]
      
      return `INSERT INTO "PropValidation" ("id", "propId", "gameIdRef", "playerName", "propType", "threshold", "prediction", "projectedValue", "confidence", "edge", "odds", "probability", "qualityScore", "source", "parlayId", "actualValue", "result", "status", "sport", "timestamp", "completedAt", "notes") VALUES (${values.join(', ')}) ON CONFLICT ("propId") DO NOTHING;`
    })
    
    // Write to file
    const sqlFile = `-- Validation Data Export
-- Generated: ${new Date().toISOString()}
-- Total Props: ${props.length}

${sqlStatements.join('\n')}
`
    
    fs.writeFileSync('validation-data.sql', sqlFile)
    console.log('✅ Exported to validation-data.sql')
    
    // Also export as JSON for backup
    fs.writeFileSync('validation-data.json', JSON.stringify(props, null, 2))
    console.log('✅ Exported to validation-data.json')
    
    // Stats
    const stats = {
      total: props.length,
      completed: props.filter(p => p.status === 'completed').length,
      pending: props.filter(p => p.status === 'pending').length,
      correct: props.filter(p => p.result === 'correct').length,
      incorrect: props.filter(p => p.result === 'incorrect').length,
      push: props.filter(p => p.result === 'push').length,
      byPropType: {}
    }
    
    props.forEach(p => {
      if (!stats.byPropType[p.propType]) {
        stats.byPropType[p.propType] = 0
      }
      stats.byPropType[p.propType]++
    })
    
    console.log('\n📊 Export Summary:')
    console.log(`   Total: ${stats.total}`)
    console.log(`   Completed: ${stats.completed}`)
    console.log(`   Correct: ${stats.correct}`)
    console.log(`   Incorrect: ${stats.incorrect}`)
    console.log(`   Push: ${stats.push}`)
    console.log(`   Win Rate: ${((stats.correct / (stats.correct + stats.incorrect)) * 100).toFixed(1)}%`)
    
  } catch (error) {
    console.error('❌ Error exporting data:', error)
  } finally {
    await prisma.$disconnect()
  }
}

exportValidationData()

