export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

// Teams data (same as local script)
const MLB_TEAMS = [
  { id: 'MLB_108', name: 'Los Angeles Angels', abbr: 'LAA', sport: 'mlb' },
  { id: 'MLB_109', name: 'Arizona Diamondbacks', abbr: 'ARI', sport: 'mlb' },
  { id: 'MLB_110', name: 'Baltimore Orioles', abbr: 'BAL', sport: 'mlb' },
  { id: 'MLB_111', name: 'Boston Red Sox', abbr: 'BOS', sport: 'mlb' },
  { id: 'MLB_112', name: 'Chicago Cubs', abbr: 'CHC', sport: 'mlb' },
  { id: 'MLB_113', name: 'Cincinnati Reds', abbr: 'CIN', sport: 'mlb' },
  { id: 'MLB_114', name: 'Cleveland Guardians', abbr: 'CLE', sport: 'mlb' },
  { id: 'MLB_115', name: 'Colorado Rockies', abbr: 'COL', sport: 'mlb' },
  { id: 'MLB_116', name: 'Detroit Tigers', abbr: 'DET', sport: 'mlb' },
  { id: 'MLB_117', name: 'Houston Astros', abbr: 'HOU', sport: 'mlb' },
  { id: 'MLB_118', name: 'Kansas City Royals', abbr: 'KC', sport: 'mlb' },
  { id: 'MLB_119', name: 'Los Angeles Dodgers', abbr: 'LAD', sport: 'mlb' },
  { id: 'MLB_120', name: 'Washington Nationals', abbr: 'WSH', sport: 'mlb' },
  { id: 'MLB_121', name: 'New York Mets', abbr: 'NYM', sport: 'mlb' },
  { id: 'MLB_133', name: 'Oakland Athletics', abbr: 'OAK', sport: 'mlb' },
  { id: 'MLB_134', name: 'Pittsburgh Pirates', abbr: 'PIT', sport: 'mlb' },
  { id: 'MLB_135', name: 'San Diego Padres', abbr: 'SD', sport: 'mlb' },
  { id: 'MLB_136', name: 'Seattle Mariners', abbr: 'SEA', sport: 'mlb' },
  { id: 'MLB_137', name: 'San Francisco Giants', abbr: 'SF', sport: 'mlb' },
  { id: 'MLB_138', name: 'St. Louis Cardinals', abbr: 'STL', sport: 'mlb' },
  { id: 'MLB_139', name: 'Tampa Bay Rays', abbr: 'TB', sport: 'mlb' },
  { id: 'MLB_140', name: 'Texas Rangers', abbr: 'TEX', sport: 'mlb' },
  { id: 'MLB_141', name: 'Toronto Blue Jays', abbr: 'TOR', sport: 'mlb' },
  { id: 'MLB_142', name: 'Minnesota Twins', abbr: 'MIN', sport: 'mlb' },
  { id: 'MLB_143', name: 'Philadelphia Phillies', abbr: 'PHI', sport: 'mlb' },
  { id: 'MLB_144', name: 'Atlanta Braves', abbr: 'ATL', sport: 'mlb' },
  { id: 'MLB_145', name: 'Chicago White Sox', abbr: 'CWS', sport: 'mlb' },
  { id: 'MLB_146', name: 'Miami Marlins', abbr: 'MIA', sport: 'mlb' },
  { id: 'MLB_147', name: 'New York Yankees', abbr: 'NYY', sport: 'mlb' },
  { id: 'MLB_158', name: 'Milwaukee Brewers', abbr: 'MIL', sport: 'mlb' }
]

export async function GET() {
  try {
    console.log('🚀 SUPABASE SETUP: Populating from local data...')
    
    let stats = {
      teamsInserted: 0,
      teamsFailed: 0,
      gamesSample: []
    }
    
    // Populate MLB teams
    console.log('📋 Populating MLB teams...')
    for (const team of MLB_TEAMS) {
      try {
        await prisma.team.upsert({
          where: { abbr_sport: { abbr: team.abbr, sport: team.sport } },
          update: { name: team.name },
          create: team
        })
        stats.teamsInserted++
      } catch (e) {
        console.error(`Failed to insert ${team.abbr}:`, e.message)
        stats.teamsFailed++
      }
    }
    
    // Get a sample of available games to show what's possible
    const sampleGames = await prisma.game.findMany({
      select: { sport: true, date: true, home: { select: { abbr: true } }, away: { select: { abbr: true } } },
      take: 10,
      orderBy: { date: 'asc' }
    })
    
    stats.gamesSample = sampleGames.map(g => ({
      matchup: `${g.away.abbr} @ ${g.home.abbr}`,
      sport: g.sport,
      date: g.date
    }))
    
    console.log(`✅ Setup complete! Inserted ${stats.teamsInserted} teams`)
    
    return NextResponse.json({
      success: true,
      message: 'Supabase populated with teams!',
      stats,
      nextStep: 'Refresh the homepage to see games from your local database'
    })
    
  } catch (error) {
    console.error('❌ Setup error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
