// Get individual game data
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function GET(request, { params }) {
  try {
    const gameId = params.id
    
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        home: true,
        away: true,
        edges: {
          orderBy: { ts: 'desc' },
          take: 1,
        },
        odds: {
          orderBy: { ts: 'desc' },
          take: 10,
        },
        lineups: {
          include: {
            player: {
              include: {
                splits: {
                  where: {
                    season: new Date().getFullYear(),
                    scope: 'season'
                  }
                }
              }
            }
          },
        },
        probableHomePitcher: {
          select: { fullName: true, throws: true }
        },
        probableAwayPitcher: {
          select: { fullName: true, throws: true }
        }
      }
    })
    
    if (!game) {
      return NextResponse.json({
        success: false,
        error: 'Game not found'
      }, { status: 404 })
    }
    
    return NextResponse.json({
      success: true,
      game
    })
    
  } catch (error) {
    console.error('Error fetching game:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
