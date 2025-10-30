// Automated backup script - Export parlay data to CSV/JSON
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function backupData() {
  try {
    const date = new Date().toISOString().split('T')[0]
    const backupDir = path.join(__dirname, '..', 'backups', date)
    
    // Create backups directory
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true })
    }
    
    console.log(`📦 Starting backup for ${date}...`)
    
    const baseUrl = process.env.BACKUP_URL || 'http://localhost:3000'
    
    try {
      // Backup 1: Full CSV export (Excel-ready)
      console.log('📄 Exporting CSV data...')
      const csvResponse = await fetch(`${baseUrl}/api/export/parlays?format=csv`)
      if (csvResponse.ok) {
        const csvData = await csvResponse.text()
        const csvPath = path.join(backupDir, `parlays_${date}.csv`)
        fs.writeFileSync(csvPath, csvData)
        console.log(`✅ Saved: ${csvPath}`)
      } else {
        console.error('❌ Failed to fetch CSV data:', csvResponse.statusText)
      }
    } catch (error) {
      console.error('❌ Error exporting CSV:', error.message)
    }
    
    try {
      // Backup 2: Stats export (Chart-ready)
      console.log('📊 Exporting stats data...')
      const statsResponse = await fetch(`${baseUrl}/api/export/stats`)
      if (statsResponse.ok) {
        const statsData = await statsResponse.text()
        const statsPath = path.join(backupDir, `stats_${date}.csv`)
        fs.writeFileSync(statsPath, statsData)
        console.log(`✅ Saved: ${statsPath}`)
      } else {
        console.error('❌ Failed to fetch stats data:', statsResponse.statusText)
      }
    } catch (error) {
      console.error('❌ Error exporting stats:', error.message)
    }
    
    try {
      // Backup 3: JSON backup (Complete data)
      console.log('📦 Exporting JSON backup...')
      const jsonResponse = await fetch(`${baseUrl}/api/export/parlays?format=json`)
      if (jsonResponse.ok) {
        const jsonData = await jsonResponse.text()
        const jsonPath = path.join(backupDir, `backup_${date}.json`)
        fs.writeFileSync(jsonPath, jsonData)
        console.log(`✅ Saved: ${jsonPath}`)
      } else {
        console.error('❌ Failed to fetch JSON data:', jsonResponse.statusText)
      }
    } catch (error) {
      console.error('❌ Error exporting JSON:', error.message)
    }
    
    try {
      // Backup 4: Copy database file
      console.log('💾 Backing up database...')
      const dbSource = path.join(__dirname, '..', 'prisma', 'dev.db')
      if (fs.existsSync(dbSource)) {
        const dbDest = path.join(backupDir, `dev_${date}.db`)
        fs.copyFileSync(dbSource, dbDest)
        console.log(`✅ Saved: ${dbDest}`)
      } else {
        console.warn('⚠️ Database file not found at:', dbSource)
      }
    } catch (error) {
      console.error('❌ Error backing up database:', error.message)
    }
    
    // Create backup summary
    const summaryPath = path.join(backupDir, 'README.txt')
    const summary = `
Backup Created: ${new Date().toISOString()}
=====================================

Files in this backup:
- parlays_${date}.csv - Excel-ready parlay data
- stats_${date}.csv - Statistics for charts
- backup_${date}.json - Complete JSON backup
- dev_${date}.db - Raw database file

To restore:
1. Copy dev_${date}.db to prisma/dev.db
2. Run: npx prisma generate
3. Run: npm run dev

To analyze in Excel:
1. Open parlays_${date}.csv or stats_${date}.csv
2. Create charts from the data
3. See EXCEL_EXPORT_GUIDE.md for details
`
    fs.writeFileSync(summaryPath, summary.trim())
    
    console.log('🎉 Backup complete!')
    console.log(`📁 Location: ${backupDir}`)
    
  } catch (error) {
    console.error('❌ Backup failed:', error)
    process.exit(1)
  }
}

// Run backup
console.log('🚀 Starting automated backup...')
console.log('⚠️ Make sure your app is running at http://localhost:3000')
console.log('')

backupData()
  .then(() => {
    console.log('')
    console.log('✅ Backup process completed successfully!')
    process.exit(0)
  })
  .catch(error => {
    console.error('❌ Backup process failed:', error)
    process.exit(1)
  })





