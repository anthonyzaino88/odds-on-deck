/**
 * Complete migration script: Export local data and upload to Vercel
 * 
 * Usage: node scripts/migrate-to-vercel.js https://your-app.vercel.app
 */

import { PrismaClient } from '@prisma/client'
import fs from 'fs/promises'
import path from 'path'
import https from 'https'
import http from 'http'

const prisma = new PrismaClient()

async function exportData() {
  console.log('📦 Step 1: Exporting data from local database...\n')
  
  const data = {}
  
  // Export all tables
  data.teams = await prisma.team.findMany()
  console.log(`   ✅ ${data.teams.length} teams`)
  
  data.players = await prisma.player.findMany()
  console.log(`   ✅ ${data.players.length} players`)
  
  data.games = await prisma.game.findMany()
  console.log(`   ✅ ${data.games.length} games`)
  
  data.odds = await prisma.odds.findMany()
  console.log(`   ✅ ${data.odds.length} odds`)
  
  data.propValidations = await prisma.propValidation.findMany()
  console.log(`   ✅ ${data.propValidations.length} prop validations`)
  
  data.parlays = await prisma.parlay.findMany({
    include: { legs: true }
  })
  console.log(`   ✅ ${data.parlays.length} parlays`)
  
  data.splitStats = await prisma.splitStat.findMany()
  console.log(`   ✅ ${data.splitStats.length} split stats`)
  
  data.pitchMix = await prisma.pitchMix.findMany()
  console.log(`   ✅ ${data.pitchMix.length} pitch mix`)
  
  data.lineups = await prisma.lineup.findMany()
  console.log(`   ✅ ${data.lineups.length} lineups\n`)
  
  return data
}

async function uploadToVercel(data, vercelUrl) {
  console.log(`📤 Step 2: Uploading to ${vercelUrl}...\n`)
  
  const url = new URL('/api/import/all-data', vercelUrl)
  const jsonData = JSON.stringify(data)
  
  console.log(`   💾 Payload size: ${(jsonData.length / (1024 * 1024)).toFixed(2)} MB`)
  console.log(`   🔗 Uploading to: ${url.href}\n`)
  
  return new Promise((resolve, reject) => {
    const protocol = url.protocol === 'https:' ? https : http
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonData)
      }
    }
    
    const req = protocol.request(url, options, (res) => {
      let responseData = ''
      
      res.on('data', (chunk) => {
        responseData += chunk
      })
      
      res.on('end', () => {
        try {
          const result = JSON.parse(responseData)
          resolve(result)
        } catch (error) {
          reject(new Error(`Failed to parse response: ${responseData}`))
        }
      })
    })
    
    req.on('error', (error) => {
      reject(error)
    })
    
    // Set a timeout (5 minutes for large uploads)
    req.setTimeout(300000, () => {
      req.destroy()
      reject(new Error('Upload timeout (5 minutes)'))
    })
    
    req.write(jsonData)
    req.end()
  })
}

async function main() {
  const vercelUrl = process.argv[2]
  
  if (!vercelUrl) {
    console.error('❌ Error: Please provide your Vercel URL')
    console.log('\nUsage:')
    console.log('  node scripts/migrate-to-vercel.js https://your-app.vercel.app')
    process.exit(1)
  }
  
  console.log('🚀 Starting database migration to Vercel...\n')
  console.log('='.repeat(60))
  
  try {
    // Step 1: Export
    const data = await exportData()
    
    // Save backup locally
    const backupPath = path.join(process.cwd(), 'local-db-backup.json')
    await fs.writeFile(backupPath, JSON.stringify(data, null, 2))
    console.log(`   💾 Backup saved: ${backupPath}\n`)
    
    console.log('='.repeat(60))
    
    // Step 2: Upload
    const result = await uploadToVercel(data, vercelUrl)
    
    console.log('='.repeat(60))
    console.log('✅ MIGRATION COMPLETE!')
    console.log('='.repeat(60))
    
    if (result.success) {
      console.log('\n📊 Import Summary:')
      for (const [table, stats] of Object.entries(result.results)) {
        if (stats && typeof stats === 'object' && 'imported' in stats) {
          console.log(`   ${table}: ${stats.imported}/${stats.total} (${stats.skipped} skipped)`)
        }
      }
    } else {
      console.log('\n❌ Import failed:', result.error)
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()

