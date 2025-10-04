// Test player props generation with detailed breakdown

import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { generateNFLPlayerProps } from '../../../../lib/nfl-props.js'
import { getMLBPropsFromDatabase } from '../../../../lib/player-props.js'

const prisma = new PrismaClient()

export async function GET() {
  try {
    console.log('🎯 Testing player props generation with detailed breakdown...')
    
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    // Get games with lineups and player stats
    const games = await prisma.game.findMany({
      where: {
        date: {
          gte: today,
          lt: tomorrow,
        },
        status: { in: ['scheduled', 'pre_game', 'warmup', 'in_progress', 'Top', 'Bottom'] },
        lineups: {
          some: {}
        }
      },
      include: {
        home: true,
        away: true,
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
          orderBy: [
            { team: 'asc' },
            { battingOrder: 'asc' }
          ]
        }
      }
    })
    
    console.log(`Found ${games.length} games with lineups`)
    
    // Get NFL props
    const nflProps = await generateNFLPlayerProps()
    console.log(`Generated ${nflProps.length} NFL props`)
    
    // Get MLB playoff props from database
    const mlbPlayoffProps = await getMLBPropsFromDatabase()
    console.log(`Found ${mlbPlayoffProps.length} MLB playoff props`)
    
    // Combine all props
    const allProps = [...nflProps, ...mlbPlayoffProps]
    
    return NextResponse.json({
      success: true,
      breakdown: {
        gamesWithLineups: games.length,
        nflProps: nflProps.length,
        mlbPlayoffProps: mlbPlayoffProps.length,
        totalProps: allProps.length
      },
      sampleNFLProps: nflProps.slice(0, 3).map(p => ({
        playerName: p.playerName,
        type: p.type,
        team: p.team,
        edge: p.edge
      })),
      sampleMLBProps: mlbPlayoffProps.slice(0, 3).map(p => ({
        playerName: p.playerName,
        type: p.type,
        team: p.team,
        edge: p.edge
      })),
      allProps: allProps
    })
    
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

