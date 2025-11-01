export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

// Quick test data to populate
const TEST_GAMES = [
  {
    id: 'mlb-test-1',
    sport: 'mlb',
    date: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // Tomorrow
    homeId: 'MLB_119', // Dodgers
    awayId: 'MLB_141', // Blue Jays
    status: 'scheduled'
  },
  {
    id: 'nfl-test-1',
    sport: 'nfl',
    date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    homeId: 'NFL_1',
    awayId: 'NFL_2',
    status: 'scheduled'
  },
  {
    id: 'nhl-test-1',
    sport: 'nhl',
    date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    homeId: 'NHL_1',
    awayId: 'NHL_2',
    status: 'scheduled'
  }
]

export async function GET() {
  try {
    console.log('🚀 VERCEL SETUP: Quick populating test data...')
    
    // First check if we have any games at all
    const existingCount = await prisma.game.count()
    console.log(`Existing games: ${existingCount}`)
    
    if (existingCount > 0) {
      return NextResponse.json({
        success: true,
        message: `Database already has ${existingCount} games! No need to populate.`,
        hint: 'To see games on the homepage, ensure DATABASE_URL on Vercel points to your Supabase instance.'
      })
    }
    
    // Check if teams exist
    const teamCount = await prisma.team.count()
    console.log(`Existing teams: ${teamCount}`)
    
    if (teamCount === 0) {
      return NextResponse.json({
        success: false,
        error: 'No teams in database. Run the local setup script first.',
        hint: 'Run: node scripts/setup-database.js'
      })
    }
    
    // Try to insert test games
    let inserted = 0
    for (const game of TEST_GAMES) {
      try {
        // Verify teams exist
        const home = await prisma.team.findFirst({ where: { id: game.homeId } })
        const away = await prisma.team.findFirst({ where: { id: game.awayId } })
        
        if (home && away) {
          await prisma.game.create({ data: game })
          inserted++
        }
      } catch (e) {
        console.log(`Skipped game ${game.id}: ${e.message}`)
      }
    }
    
    console.log(`✅ Inserted ${inserted} test games`)
    
    return NextResponse.json({
      success: true,
      message: `Setup complete!`,
      inserted,
      hint: 'Refresh your homepage to see games'
    })
    
  } catch (error) {
    console.error('❌ Setup error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
