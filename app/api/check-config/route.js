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
  
  // Identify which key this is
  let keyType = 'UNKNOWN'
  if (apiKey === '0437577781a9c1944c96cf470cf4e35d') {
    keyType = 'FREE TIER (500 req/month) ✅'
  } else if (apiKey === '065843404dbb936f13929a104de407f3') {
    keyType = 'PAID TIER (20,000 req/month)'
  }
  
  return NextResponse.json({
    apiKey: keyPreview,
    keyType: keyType,
    fullKeyLastFour: apiKey ? apiKey.substring(apiKey.length - 4) : 'N/A',
    demoMode: demoMode === 'true' ? '✅ ENABLED' : '❌ DISABLED',
    publicDemoMode: publicDemoMode === 'true' ? '✅ ENABLED' : '❌ DISABLED',
    expected: {
      free: '0437...e35d',
      paid: '0658...07f3'
    }
  })
}

