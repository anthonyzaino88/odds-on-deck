// Initialize database tables in Supabase

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET() {
  try {
    console.log('🔧 Initializing database...')
    
    // Test connection
    await prisma.$connect()
    console.log('✅ Database connected')
    
    // Check if tables exist by trying to count teams
    let teamsExist = false
    try {
      const count = await prisma.team.count()
      teamsExist = true
      console.log(`✅ Tables exist. Found ${count} teams`)
    } catch (error) {
      console.log('⚠️ Tables may not exist:', error.message)
    }
    
    // Try to create a test team to verify write access
    if (teamsExist) {
      try {
        await prisma.team.upsert({
          where: { id: 'TEST_1' },
          update: {},
          create: {
            id: 'TEST_1',
            name: 'Test Team',
            abbr: 'TEST',
            sport: 'test',
            league: 'TEST'
          }
        })
        
        // Delete test team
        await prisma.team.delete({
          where: { id: 'TEST_1' }
        })
        
        console.log('✅ Database write access confirmed')
      } catch (error) {
        console.log('⚠️ Write test failed:', error.message)
      }
    }
    
    // Get counts of existing data
    const counts = {
      teams: 0,
      games: 0,
      players: 0
    }
    
    if (teamsExist) {
      try {
        counts.teams = await prisma.team.count()
        counts.games = await prisma.game.count()
        counts.players = await prisma.player.count()
      } catch (error) {
        console.log('Error getting counts:', error.message)
      }
    }
    
    await prisma.$disconnect()
    
    return NextResponse.json({
      success: true,
      message: 'Database connection successful',
      tablesExist: teamsExist,
      counts,
      nextStep: teamsExist ? 
        'Database ready! Visit /api/nhl/fix-and-fetch to add games' :
        'Tables need to be created. Check Vercel logs for prisma db push errors.'
    })
    
  } catch (error) {
    console.error('❌ Database initialization error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack,
      hint: 'Make sure DATABASE_URL is set correctly in Vercel environment variables'
    }, { status: 500 })
  }
}

