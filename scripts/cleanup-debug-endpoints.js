#!/usr/bin/env node

/**
 * Cleanup Debug Endpoints Script
 * 
 * This script safely removes debug and test endpoints from the production codebase.
 * It creates a backup before deletion so you can restore if needed.
 * 
 * Usage:
 *   node scripts/cleanup-debug-endpoints.js [--dry-run] [--backup]
 * 
 * Options:
 *   --dry-run: Show what would be deleted without actually deleting
 *   --backup: Create a backup archive before deletion (recommended)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

// Parse command line arguments
const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const shouldBackup = args.includes('--backup')

console.log('🧹 Debug Endpoints Cleanup Script')
console.log('=====================================')
console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'ACTUAL DELETION'}`)
console.log(`Backup: ${shouldBackup ? 'YES' : 'NO'}`)
console.log()

// Directories and files to remove
const toRemove = [
  // Debug endpoints
  'app/api/debug',
  
  // Test endpoints
  'app/api/test-parlay',
  'app/api/test-simple',
  
  // Redundant refresh endpoints (keeping v1/data)
  'app/api/refresh-all',
  'app/api/manual/refresh-odds',
  
  // Old data endpoint (replaced by v1/data)
  // 'app/api/data', // Keep for backward compatibility during migration
  
  // Root-level test scripts (if you want to clean these too)
  // 'check-all-games.js',
  // 'check-any-games.js',
  // 'check-lineup-correct.js',
  // 'check-lineup-details.js',
  // 'check-yankees-props.js',
  // 'check-yankees.js',
  // 'debug-database-edges.js',
  // 'debug-edge-calculations.js',
  // 'debug-editors-picks.js',
  // 'debug-odds-data.js',
  // 'debug-run-calculation.js',
  // 'test-editors-picks.js',
  // 'test-env.js',
  // 'test-odds-api.js',
  // 'test-player-props.js',
  // 'test-refresh-endpoints.js',
  // 'verify-data-freshness.js'
]

/**
 * Get size of directory or file
 */
function getSize(itemPath) {
  const fullPath = path.join(rootDir, itemPath)
  
  if (!fs.existsSync(fullPath)) {
    return 0
  }
  
  const stats = fs.statSync(fullPath)
  
  if (stats.isFile()) {
    return stats.size
  }
  
  if (stats.isDirectory()) {
    let totalSize = 0
    const files = fs.readdirSync(fullPath)
    
    for (const file of files) {
      const filePath = path.join(fullPath, file)
      const fileStats = fs.statSync(filePath)
      
      if (fileStats.isDirectory()) {
        totalSize += getSize(path.relative(rootDir, filePath))
      } else {
        totalSize += fileStats.size
      }
    }
    
    return totalSize
  }
  
  return 0
}

/**
 * Count files in directory
 */
function countFiles(dirPath) {
  const fullPath = path.join(rootDir, dirPath)
  
  if (!fs.existsSync(fullPath)) {
    return 0
  }
  
  const stats = fs.statSync(fullPath)
  
  if (stats.isFile()) {
    return 1
  }
  
  if (stats.isDirectory()) {
    let count = 0
    const files = fs.readdirSync(fullPath)
    
    for (const file of files) {
      const filePath = path.join(fullPath, file)
      count += countFiles(path.relative(rootDir, filePath))
    }
    
    return count
  }
  
  return 0
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

/**
 * Remove directory or file recursively
 */
function removeRecursive(itemPath) {
  const fullPath = path.join(rootDir, itemPath)
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  ${itemPath} - Not found (already deleted?)`)
    return
  }
  
  const stats = fs.statSync(fullPath)
  
  if (stats.isFile()) {
    fs.unlinkSync(fullPath)
    console.log(`✅ Deleted file: ${itemPath}`)
  } else if (stats.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true })
    console.log(`✅ Deleted directory: ${itemPath}`)
  }
}

// Main execution
console.log('📝 Items to remove:')
console.log()

let totalSize = 0
let totalFiles = 0

for (const item of toRemove) {
  const fullPath = path.join(rootDir, item)
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⏭️  ${item} - Not found`)
    continue
  }
  
  const size = getSize(item)
  const fileCount = countFiles(item)
  
  totalSize += size
  totalFiles += fileCount
  
  const type = fs.statSync(fullPath).isDirectory() ? '📁' : '📄'
  console.log(`${type} ${item}`)
  console.log(`   Files: ${fileCount}, Size: ${formatBytes(size)}`)
}

console.log()
console.log(`📊 Total: ${totalFiles} files, ${formatBytes(totalSize)}`)
console.log()

if (isDryRun) {
  console.log('🔍 DRY RUN - No files were deleted')
  console.log('   Run without --dry-run to actually delete files')
  process.exit(0)
}

// Confirm deletion
if (!process.env.SKIP_CONFIRM) {
  console.log('⚠️  WARNING: This will permanently delete the above files!')
  console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...')
  console.log()
  
  await new Promise(resolve => setTimeout(resolve, 5000))
}

// Create backup if requested
if (shouldBackup) {
  console.log('💾 Creating backup...')
  
  const backupDir = path.join(rootDir, 'backups')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `debug-endpoints-backup-${timestamp}`)
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir)
  }
  
  fs.mkdirSync(backupPath)
  
  for (const item of toRemove) {
    const fullPath = path.join(rootDir, item)
    
    if (fs.existsSync(fullPath)) {
      const backupItemPath = path.join(backupPath, item)
      const backupItemDir = path.dirname(backupItemPath)
      
      if (!fs.existsSync(backupItemDir)) {
        fs.mkdirSync(backupItemDir, { recursive: true })
      }
      
      fs.cpSync(fullPath, backupItemPath, { recursive: true })
    }
  }
  
  console.log(`✅ Backup created at: ${backupPath}`)
  console.log()
}

// Perform deletion
console.log('🗑️  Deleting files...')
console.log()

for (const item of toRemove) {
  removeRecursive(item)
}

console.log()
console.log('✅ Cleanup complete!')
console.log(`   Removed ${totalFiles} files (${formatBytes(totalSize)})`)

if (shouldBackup) {
  console.log(`   Backup saved in ./backups/`)
}

console.log()
console.log('🎯 Next steps:')
console.log('   1. Test your application: npm run dev')
console.log('   2. Update any frontend code that called removed endpoints')
console.log('   3. Commit changes: git add . && git commit -m "chore: remove debug endpoints"')




