// Quick endpoint to check which API key is being used
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.ODDS_API_KEY
  const demoMode = process.env.DEMO_MODE
  const publicDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE
  
  // Show first 4 and last 4 characters of key for security
  const keyPreview = apiKey 
    ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
    : 'NOT SET'
  
  // Identify which tier this is (without exposing full key)
  // Use last 4 chars only for identification
  const keyLastFour = apiKey ? apiKey.substring(apiKey.length - 4) : null
  let keyType = 'UNKNOWN'
  
  // Safe identification using only last 4 characters
  if (keyLastFour === 'e35d') {
    keyType = 'FREE TIER (500 req/month) ✅'
  } else if (keyLastFour === '07f3') {
    keyType = 'PAID TIER (20,000 req/month)'
  }
  
  return NextResponse.json({
    apiKey: keyPreview,
    keyType: keyType,
    fullKeyLastFour: keyLastFour || 'N/A',
    demoMode: demoMode === 'true' ? '✅ ENABLED' : '❌ DISABLED',
    publicDemoMode: publicDemoMode === 'true' ? '✅ ENABLED' : '❌ DISABLED'
  })
}

