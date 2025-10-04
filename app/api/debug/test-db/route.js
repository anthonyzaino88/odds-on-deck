// Test database connection and basic queries

import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET() {
  try {
    console.log('🎯 Testing database connection...')
    
    // Test basic database connection
    const teamCount = await prisma.team.count()
    const gameCount = await prisma.game.count()
    
    // Test getting some basic data
    const teams = await prisma.team.findMany({
      take: 5,
      select: { id: true, name: true, abbr: true, sport: true }
    })
    
    const games = await prisma.game.findMany({
      take: 5,
      select: { id: true, status: true, sport: true, date: true }
    })
    
    return NextResponse.json({
      success: true,
      message: 'Database connection successful',
      stats: {
        teamCount,
        gameCount
      },
      sampleTeams: teams,
      sampleGames: games,
      timestamp: new Date().toISOString()
    })
    
  } catch (error) {
    console.error('Database error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      errorCode: error.code,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

