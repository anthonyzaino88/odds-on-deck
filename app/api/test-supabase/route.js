export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'

export async function GET() {
  try {
    console.log('🧪 Testing Supabase connection...')
    
    // Check env vars
    console.log('📍 NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ SET' : '❌ NOT SET')
    console.log('📍 NEXT_PUBLIC_SUPABASE_ANON_KEY:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ SET' : '❌ NOT SET')
    
    // Import Supabase
    const { supabase } = await import('../../../lib/supabase.js')
    
    console.log('✅ Supabase client imported successfully')
    
    // Try to query
    const { data, error, status } = await supabase
      .from('Game')
      .select('*')
      .limit(5)
    
    console.log('📊 Query result:', { status, dataCount: data?.length, error: error?.message })
    
    if (error) {
      console.error('❌ Supabase error:', error)
      return NextResponse.json({
        success: false,
        error: error.message,
        code: error.code,
        status: status
      }, { status: 500 })
    }
    
    return NextResponse.json({
      success: true,
      message: 'Supabase connection working!',
      gameCount: data?.length,
      sample: data?.slice(0, 2)
    })
    
  } catch (error) {
    console.error('❌ Fatal error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      type: error.constructor.name
    }, { status: 500 })
  }
}
