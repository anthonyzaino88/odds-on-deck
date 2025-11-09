#!/usr/bin/env node

/**
 * FIX SUPABASE SCHEMA - Change odds column to DECIMAL
 * 
 * This script updates the PlayerPropCache table to use DECIMAL for odds
 * instead of INTEGER, allowing decimal odds like 1.95, 2.10, etc.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
  console.log('\n🔧 FIXING SUPABASE SCHEMA')
  console.log('='.repeat(80))
  console.log('\n⚠️  IMPORTANT: This will modify the PlayerPropCache table')
  console.log('    Change: odds column from INTEGER → DECIMAL(10,2)\n')
  
  console.log('📋 SQL Query to execute:')
  console.log('   ALTER TABLE "PlayerPropCache"')
  console.log('   ALTER COLUMN "odds" TYPE DECIMAL(10,2);')
  
  console.log('\n\n📖 MANUAL STEPS REQUIRED:')
  console.log('='.repeat(80))
  console.log('\n1. Go to your Supabase dashboard:')
  console.log(`   ${supabaseUrl.replace('/v1', '')}\n`)
  console.log('2. Navigate to: SQL Editor (left sidebar)')
  console.log('\n3. Run this SQL command:\n')
  console.log('   ALTER TABLE "PlayerPropCache"')
  console.log('   ALTER COLUMN "odds" TYPE DECIMAL(10,2);')
  console.log('\n4. Click "Run" (or press Ctrl+Enter / Cmd+Enter)')
  console.log('\n5. Come back and re-run: node scripts/fetch-live-odds.js nhl --cache-fresh')
  
  console.log('\n' + '='.repeat(80))
  console.log('✅ After running the SQL command, the props will save correctly!')
  console.log('='.repeat(80) + '\n')
}

main().catch(console.error)

