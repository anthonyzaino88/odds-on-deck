// Database utilities and Prisma client setup

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis

export const prisma = globalForPrisma.prisma || new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Upsert helpers for data ingestion

export async function upsertTeam(teamData) {
  try {
    return await prisma.team.upsert({
      where: { id: teamData.id },
      update: {
        name: teamData.name,
        abbr: teamData.abbr,
        parkFactor: teamData.parkFactor,
        ...(teamData.last10Record && { last10Record: teamData.last10Record }),
        ...(teamData.avgPointsLast10 && { avgPointsLast10: teamData.avgPointsLast10 }),
        ...(teamData.avgPointsAllowedLast10 && { avgPointsAllowedLast10: teamData.avgPointsAllowedLast10 }),
        ...(teamData.homeRecord && { homeRecord: teamData.homeRecord }),
        ...(teamData.awayRecord && { awayRecord: teamData.awayRecord }),
      },
      create: teamData,
    })
  } catch (error) {
    // If there's a unique constraint error on abbr, try to find the existing team
    if (error.code === 'P2002' && error.meta?.target?.includes('abbr')) {
      console.log(`Team with abbr ${teamData.abbr} already exists, finding and updating...`)
      
      // Find the existing team with this abbreviation
      const existingTeam = await prisma.team.findFirst({
        where: { abbr: teamData.abbr }
      })
      
      if (existingTeam) {
        // Update the existing team instead of creating a new one
        return await prisma.team.update({
          where: { id: existingTeam.id },
          data: {
            name: teamData.name,
            abbr: teamData.abbr,
            parkFactor: teamData.parkFactor,
            ...(teamData.last10Record && { last10Record: teamData.last10Record }),
            ...(teamData.avgPointsLast10 && { avgPointsLast10: teamData.avgPointsLast10 }),
            ...(teamData.avgPointsAllowedLast10 && { avgPointsAllowedLast10: teamData.avgPointsAllowedLast10 }),
            ...(teamData.homeRecord && { homeRecord: teamData.homeRecord }),
            ...(teamData.awayRecord && { awayRecord: teamData.awayRecord }),
          }
        })
      }
    }
    
    // Re-throw the error if it's not a unique constraint error
    throw error
  }
}

export async function upsertPlayer(playerData) {
  try {
    return await prisma.player.upsert({
      where: { id: playerData.id },
      update: {
        fullName: playerData.fullName,
        bats: playerData.bats,
        throws: playerData.throws,
        teamId: playerData.teamId,
        isPitcher: playerData.isPitcher,
      },
      create: playerData,
    })
  } catch (error) {
    // If there's a foreign key constraint error, check if team exists
    if (error.code === 'P2003') {
      console.log(`Foreign key constraint error for player ${playerData.id}, checking team...`)
      
      // Check if team exists
      const team = await prisma.team.findUnique({
        where: { id: playerData.teamId }
      })
      
      if (!team) {
        console.log(`Team ${playerData.teamId} not found, creating player without team assignment`)
        // Create player without team assignment
        return await prisma.player.upsert({
          where: { id: playerData.id },
          update: {
            fullName: playerData.fullName,
            bats: playerData.bats,
            throws: playerData.throws,
            teamId: null, // Set to null instead of invalid team ID
            isPitcher: playerData.isPitcher,
          },
          create: {
            ...playerData,
            teamId: null, // Set to null instead of invalid team ID
          },
        })
      }
    }
    
    // Re-throw the error if it's not a foreign key constraint error
    throw error
  }
}

export async function upsertGame(gameData) {
  try {
    // First, check if a game with the same mlbGameId already exists
    if (gameData.mlbGameId) {
      const existingGame = await prisma.game.findFirst({
        where: { mlbGameId: gameData.mlbGameId }
      })
      
      if (existingGame) {
        console.log(`Game with mlbGameId ${gameData.mlbGameId} already exists, updating instead of creating duplicate...`)
        return await prisma.game.update({
          where: { id: existingGame.id },
          data: {
            date: gameData.date,
            homeId: gameData.homeId,
            awayId: gameData.awayId,
            probableHomePitcherId: gameData.probableHomePitcherId,
            probableAwayPitcherId: gameData.probableAwayPitcherId,
            status: gameData.status,
            temperature: gameData.temperature,
            windSpeed: gameData.windSpeed,
            windDirection: gameData.windDirection,
            humidity: gameData.humidity,
            precipitation: gameData.precipitation,
          }
        })
      }
    }
    
    return await prisma.game.upsert({
      where: { id: gameData.id },
      update: {
        date: gameData.date,
        homeId: gameData.homeId,
        awayId: gameData.awayId,
        probableHomePitcherId: gameData.probableHomePitcherId,
        probableAwayPitcherId: gameData.probableAwayPitcherId,
        status: gameData.status,
        temperature: gameData.temperature,
        windSpeed: gameData.windSpeed,
        windDirection: gameData.windDirection,
        humidity: gameData.humidity,
        precipitation: gameData.precipitation,
      },
      create: gameData,
    })
  } catch (error) {
    // If there's a foreign key constraint error, check if teams exist
    if (error.code === 'P2003') {
      console.log(`Foreign key constraint error for game ${gameData.id}, checking teams...`)
      
      // Check if home team exists
      const homeTeam = await prisma.team.findUnique({
        where: { id: gameData.homeId }
      })
      
      // Check if away team exists
      const awayTeam = await prisma.team.findUnique({
        where: { id: gameData.awayId }
      })
      
      if (!homeTeam) {
        console.log(`Home team ${gameData.homeId} not found, skipping game ${gameData.id}`)
        return null
      }
      
      if (!awayTeam) {
        console.log(`Away team ${gameData.awayId} not found, skipping game ${gameData.id}`)
        return null
      }
    }
    
    // Re-throw the error if it's not a foreign key constraint error
    throw error
  }
}

export async function createOdds(oddsData) {
  // Create new odds record (we keep history)
  return prisma.odds.create({
    data: oddsData,
  })
}

export async function createEdgeSnapshot(snapshotData) {
  return prisma.edgeSnapshot.create({
    data: snapshotData,
  })
}

// Query helpers

export async function getTodaysGames() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayAfterTomorrow = new Date(today)
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2)
  
  return prisma.game.findMany({
    where: {
      date: {
        gte: today,
        lt: dayAfterTomorrow,
      },
      sport: 'mlb', // Only get MLB games
    },
    include: {
      home: true,
      away: true,
      edges: {
        orderBy: { ts: 'desc' },
        take: 1,
      },
      odds: {
        orderBy: { ts: 'desc' },
        take: 10, // Recent odds for display
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
        orderBy: [
          { team: 'asc' },
          { battingOrder: 'asc' }
        ]
      },
    },
  })
}

export async function getGameDetail(gameId) {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      home: {
        include: {
          players: {
            where: { isPitcher: false },
            include: {
              splits: {
                where: {
                  season: new Date().getFullYear(),
                  scope: 'season'
                }
              }
            },
            take: 25, // Expanded roster
          },
        },
      },
      away: {
        include: {
          players: {
            where: { isPitcher: false },
            include: {
              splits: {
                where: {
                  season: new Date().getFullYear(),
                  scope: 'season'
                }
              }
            },
            take: 25, // Expanded roster
          },
        },
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
        orderBy: [
          { team: 'asc' },
          { battingOrder: 'asc' }
        ]
      },
      edges: {
        orderBy: { ts: 'desc' },
        take: 1,
      },
      odds: {
        orderBy: { ts: 'desc' },
      },
    },
  })
  
  if (!game) return null
  
  // Get probable pitchers if available
  if (game.probableHomePitcherId) {
    game.probableHomePitcher = await prisma.player.findUnique({
      where: { id: game.probableHomePitcherId },
      include: {
        splits: {
          where: {
            season: new Date().getFullYear()
          }
        },
        pitchMix: {
          where: {
            season: new Date().getFullYear()
          }
        },
      },
    })
  }
  
  if (game.probableAwayPitcherId) {
    game.probableAwayPitcher = await prisma.player.findUnique({
      where: { id: game.probableAwayPitcherId },
      include: {
        splits: {
          where: {
            season: new Date().getFullYear()
          }
        },
        pitchMix: {
          where: {
            season: new Date().getFullYear()
          }
        },
      },
    })
  }
  
  return game
}

export async function getPlayersForDFS() {
  // Simple query for DFS page - would be more sophisticated in production
  return prisma.player.findMany({
    where: {
      teamId: { not: null },
    },
    include: {
      team: true,
      splits: {
        where: {
          scope: 'season',
          season: new Date().getFullYear(),
        },
      },
    },
    take: 100, // Limit for performance
  })
}

// Cleanup old data
export async function cleanupOldOdds(daysToKeep = 7) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysToKeep)
  
  return prisma.odds.deleteMany({
    where: {
      ts: {
        lt: cutoff,
      },
    },
  })
}

export async function cleanupOldEdgeSnapshots(daysToKeep = 30) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysToKeep)
  
  return prisma.edgeSnapshot.deleteMany({
    where: {
      ts: {
        lt: cutoff,
      },
    },
  })
}

