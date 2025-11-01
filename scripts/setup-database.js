#!/usr/bin/env node

/**
 * Local database setup script
 * Run this from your terminal: node scripts/setup-database.js
 * 
 * This avoids Vercel timeouts by running locally
 */

import { PrismaClient } from '@prisma/client'
import { fetchNFLTeams } from '../lib/vendors/nfl-stats.js'
import { fetchNHLTeams } from '../lib/vendors/nhl-stats.js'
import { fetchSchedule as fetchMLBGames } from '../lib/vendors/stats.js'
import { fetchNFLSchedule } from '../lib/vendors/nfl-stats.js'
import { fetchNHLSchedule } from '../lib/vendors/nhl-stats.js'

const prisma = new PrismaClient()

const MLB_TEAMS = [
  { id: '108', name: 'Los Angeles Angels', abbr: 'LAA', sport: 'mlb' },
  { id: '109', name: 'Arizona Diamondbacks', abbr: 'ARI', sport: 'mlb' },
  { id: '110', name: 'Baltimore Orioles', abbr: 'BAL', sport: 'mlb' },
  { id: '111', name: 'Boston Red Sox', abbr: 'BOS', sport: 'mlb' },
  { id: '112', name: 'Chicago Cubs', abbr: 'CHC', sport: 'mlb' },
  { id: '113', name: 'Cincinnati Reds', abbr: 'CIN', sport: 'mlb' },
  { id: '114', name: 'Cleveland Guardians', abbr: 'CLE', sport: 'mlb' },
  { id: '115', name: 'Colorado Rockies', abbr: 'COL', sport: 'mlb' },
  { id: '116', name: 'Detroit Tigers', abbr: 'DET', sport: 'mlb' },
  { id: '117', name: 'Houston Astros', abbr: 'HOU', sport: 'mlb' },
  { id: '118', name: 'Kansas City Royals', abbr: 'KC', sport: 'mlb' },
  { id: '119', name: 'Los Angeles Dodgers', abbr: 'LAD', sport: 'mlb' },
  { id: '120', name: 'Washington Nationals', abbr: 'WSH', sport: 'mlb' },
  { id: '121', name: 'New York Mets', abbr: 'NYM', sport: 'mlb' },
  { id: '133', name: 'Oakland Athletics', abbr: 'OAK', sport: 'mlb' },
  { id: '134', name: 'Pittsburgh Pirates', abbr: 'PIT', sport: 'mlb' },
  { id: '135', name: 'San Diego Padres', abbr: 'SD', sport: 'mlb' },
  { id: '136', name: 'Seattle Mariners', abbr: 'SEA', sport: 'mlb' },
  { id: '137', name: 'San Francisco Giants', abbr: 'SF', sport: 'mlb' },
  { id: '138', name: 'St. Louis Cardinals', abbr: 'STL', sport: 'mlb' },
  { id: '139', name: 'Tampa Bay Rays', abbr: 'TB', sport: 'mlb' },
  { id: '140', name: 'Texas Rangers', abbr: 'TEX', sport: 'mlb' },
  { id: '141', name: 'Toronto Blue Jays', abbr: 'TOR', sport: 'mlb' },
  { id: '142', name: 'Minnesota Twins', abbr: 'MIN', sport: 'mlb' },
  { id: '143', name: 'Philadelphia Phillies', abbr: 'PHI', sport: 'mlb' },
  { id: '144', name: 'Atlanta Braves', abbr: 'ATL', sport: 'mlb' },
  { id: '145', name: 'Chicago White Sox', abbr: 'CWS', sport: 'mlb' },
  { id: '146', name: 'Miami Marlins', abbr: 'MIA', sport: 'mlb' },
  { id: '147', name: 'New York Yankees', abbr: 'NYY', sport: 'mlb' },
  { id: '158', name: 'Milwaukee Brewers', abbr: 'MIL', sport: 'mlb' }
]

async function main() {
  try {
    console.log('🚀 DATABASE SETUP - Running locally to avoid timeouts\n')
    
    // Step 1: Populate MLB teams (fast - hardcoded)
    console.log('📋 Step 1: Populating MLB teams...')
    for (const team of MLB_TEAMS) {
      await prisma.team.upsert({
        where: { id: team.id },
        update: { name: team.name, abbr: team.abbr },
        create: team
      })
    }
    console.log(`✅ Populated ${MLB_TEAMS.length} MLB teams\n`)
    
    // Step 2: Populate NFL teams
    console.log('📋 Step 2: Populating NFL teams...')
    try {
      const nflTeams = await fetchNFLTeams()
      for (const team of nflTeams) {
        await prisma.team.upsert({
          where: { id: team.id },
          update: { name: team.name, abbr: team.abbr },
          create: team
        })
      }
      console.log(`✅ Populated ${nflTeams.length} NFL teams\n`)
    } catch (error) {
      console.error('⚠️ Error fetching NFL teams:', error.message)
    }
    
    // Step 3: Populate NHL teams
    console.log('📋 Step 3: Populating NHL teams...')
    try {
      const nhlTeams = await fetchNHLTeams()
      for (const team of nhlTeams) {
        await prisma.team.upsert({
          where: { id: team.id },
          update: { name: team.name, abbr: team.abbr },
          create: team
        })
      }
      console.log(`✅ Populated ${nhlTeams.length} NHL teams\n`)
    } catch (error) {
      console.error('⚠️ Error fetching NHL teams:', error.message)
    }
    
    // Step 4: Populate MLB games
    console.log('📅 Step 4: Populating MLB games...')
    try {
      const mlbGames = await fetchMLBGames({ useLocalDate: true })
      let mlbCount = 0
      
      for (const game of mlbGames) {
        try {
          const homeTeam = await prisma.team.findFirst({ where: { abbr: game.home.abbr } })
          const awayTeam = await prisma.team.findFirst({ where: { abbr: game.away.abbr } })
          
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
            mlbCount++
          }
        } catch (e) {
          // Skip individual game errors
        }
      }
      console.log(`✅ Populated ${mlbCount} MLB games\n`)
    } catch (error) {
      console.error('⚠️ Error fetching MLB games:', error.message)
    }
    
    // Step 5: Populate NFL games
    console.log('📅 Step 5: Populating NFL games...')
    try {
      const nflGames = await fetchNFLSchedule()
      let nflCount = 0
      
      for (const game of nflGames) {
        try {
          const homeTeam = await prisma.team.findFirst({ where: { abbr: game.home.abbr } })
          const awayTeam = await prisma.team.findFirst({ where: { abbr: game.away.abbr } })
          
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
            nflCount++
          }
        } catch (e) {
          // Skip individual game errors
        }
      }
      console.log(`✅ Populated ${nflCount} NFL games\n`)
    } catch (error) {
      console.error('⚠️ Error fetching NFL games:', error.message)
    }
    
    // Step 6: Populate NHL games
    console.log('📅 Step 6: Populating NHL games...')
    try {
      const nhlGames = await fetchNHLSchedule()
      let nhlCount = 0
      
      for (const game of nhlGames) {
        try {
          const homeTeam = await prisma.team.findFirst({ where: { abbr: game.home.abbr } })
          const awayTeam = await prisma.team.findFirst({ where: { abbr: game.away.abbr } })
          
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
            nhlCount++
          }
        } catch (e) {
          // Skip individual game errors
        }
      }
      console.log(`✅ Populated ${nhlCount} NHL games\n`)
    } catch (error) {
      console.error('⚠️ Error fetching NHL games:', error.message)
    }
    
    console.log('✅ DATABASE SETUP COMPLETE!')
    console.log('🌐 Your homepage should now load with games!\n')
    
  } catch (error) {
    console.error('❌ Setup failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main()
