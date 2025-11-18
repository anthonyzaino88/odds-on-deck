import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function GET() {
  try {
    console.log('🧪 Testing database connection...')

    // Test basic connection
    const { data: nflTest, error: nflError } = await supabase
      .from('Game')
      .select('id, sport, date')
      .eq('sport', 'nfl')
      .limit(5)

    const { data: nhlTest, error: nhlError } = await supabase
      .from('Game')
      .select('id, sport, date')
      .eq('sport', 'nhl')
      .limit(5)

    // Check environment variables
    const envCheck = {
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasSupabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      urlLength: process.env.NEXT_PUBLIC_SUPABASE_URL?.length || 0,
      keyLength: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.length || 0
    }

    console.log('Environment check:', envCheck)

    return Response.json({
      success: true,
      environment: envCheck,
      nfl: {
        count: nflTest?.length || 0,
        error: nflError?.message || null,
        sample: nflTest?.slice(0, 2) || []
      },
      nhl: {
        count: nhlTest?.length || 0,
        error: nhlError?.message || null,
        sample: nhlTest?.slice(0, 2) || []
      }
    })

  } catch (error) {
    console.error('Database test error:', error)
    return Response.json({
      success: false,
      error: error.message
    })
  }
}
