#!/usr/bin/env node
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load .env.local
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '../.env.local')
dotenv.config({ path: envPath })

console.log('📝 Loaded .env.local')
console.log(`✅ DATABASE_URL: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 40) + '...' : 'NOT SET'}`)

// Now run the setup script
import('../setup-database.js')
