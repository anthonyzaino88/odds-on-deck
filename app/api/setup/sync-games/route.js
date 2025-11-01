export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'
import { fetchSchedule as fetchMLBGames } from '../../../../lib/vendors/stats.js'
import { fetchNFLSchedule } from '../../../../lib/vendors/nfl-stats.js'
import { fetchNHLSchedule } from '../../../../lib/vendors/nhl-stats.js'

export async function GET() {
  try {
    console.log('🚀 SYNC: Fetching and syncing games to Supabase...')
    
    let stats = {
      mlb: 0,
      nfl: 0,
      nhl: 0,
      errors: []
    }
    
    // Fetch MLB games
    console.log('📅 Fetching MLB games...')
    try {
      const mlbGames = await fetchMLBGames({ useLocalDate: true })
      for (const game of mlbGames) {
        try {
          const homeTeam = await prisma.team.findFirst({ where: { abbr: game.home.abbr, sport: 'mlb' } })
          const awayTeam = await prisma.team.findFirst({ where: { abbr: game.away.abbr, sport: 'mlb' } })
          
          if (homeTeam && awayTeam) {
            await prisma.game.upsert({
              where: { id: game.id },
              update: { status: game.status, sport: 'mlb' },
              create: {
                id: game.id,
                sport: 'mlb',
                date: game.date,
                homeId: homeTeam.id,
                awayId: awayTeam.id,
                status: game.status || 'scheduled',
                mlbGameId: game.mlbGameId
              }
            })
            stats.mlb++
          }
        } catch (e) {
          console.error('Error inserting MLB game:', e.message)
        }
      }
      console.log(`✅ Synced ${stats.mlb} MLB games`)
    } catch (error) {
      console.error('Error fetching MLB games:', error.message)
      stats.errors.push('MLB fetch failed')
    }
    
    // Fetch NFL games
    console.log('📅 Fetching NFL games...')
    try {
      const nflGames = await fetchNFLSchedule()
      for (const game of nflGames) {
        try {
          let homeTeam, awayTeam
          
          // Parse game ID to get abbreviations
          if (game.id && game.id.includes('_at_')) {
            const parts = game.id.split('_at_')
            const awayAbbr = parts[0]
            const homeAbbr = parts[1]?.split('_')[0]
            
            homeTeam = await prisma.team.findFirst({ where: { abbr: homeAbbr, sport: 'nfl' } })
            awayTeam = await prisma.team.findFirst({ where: { abbr: awayAbbr, sport: 'nfl' } })
          }
          
          if (homeTeam && awayTeam) {
            await prisma.game.upsert({
              where: { id: game.id },
              update: { status: game.status, sport: 'nfl' },
              create: {
                id: game.id,
                sport: 'nfl',
                date: game.date,
                homeId: homeTeam.id,
                awayId: awayTeam.id,
                status: game.status || 'scheduled'
              }
            })
            stats.nfl++
          }
        } catch (e) {
          // Skip individual errors
        }
      }
      console.log(`✅ Synced ${stats.nfl} NFL games`)
    } catch (error) {
      console.error('Error fetching NFL games:', error.message)
      stats.errors.push('NFL fetch failed')
    }
    
    // Fetch NHL games
    console.log('📅 Fetching NHL games...')
    try {
      const nhlGames = await fetchNHLSchedule()
      for (const game of nhlGames) {
        try {
          let homeTeam, awayTeam
          
          // Parse game ID to get abbreviations
          if (game.id && game.id.includes('_at_')) {
            const parts = game.id.split('_at_')
            const awayAbbr = parts[0]
            const homeAbbr = parts[1]?.split('_')[0]
            
            homeTeam = await prisma.team.findFirst({ where: { abbr: homeAbbr, sport: 'nhl' } })
            awayTeam = await prisma.team.findFirst({ where: { abbr: awayAbbr, sport: 'nhl' } })
          }
          
          if (homeTeam && awayTeam) {
            await prisma.game.upsert({
              where: { id: game.id },
              update: { status: game.status, sport: 'nhl' },
              create: {
                id: game.id,
                sport: 'nhl',
                date: game.date,
                homeId: homeTeam.id,
                awayId: awayTeam.id,
                status: game.status || 'scheduled'
              }
            })
            stats.nhl++
          }
        } catch (e) {
          // Skip individual errors
        }
      }
      console.log(`✅ Synced ${stats.nhl} NHL games`)
    } catch (error) {
      console.error('Error fetching NHL games:', error.message)
      stats.errors.push('NHL fetch failed')
    }
    
    console.log(`✅ SYNC COMPLETE: ${stats.mlb} MLB, ${stats.nfl} NFL, ${stats.nhl} NHL`)
    
    return NextResponse.json({
      success: true,
      message: `Synced ${stats.mlb + stats.nfl + stats.nhl} games to Supabase!`,
      stats,
      nextStep: 'Refresh your homepage to see the games'
    })
    
  } catch (error) {
    console.error('❌ Sync error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
