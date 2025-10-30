// NFL Database utilities - Get NFL games and data

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

/**
 * Get this week's NFL games
 */
export async function getThisWeeksNFLGames() {
  try {
    const games = await prisma.game.findMany({
      where: {
        sport: 'nfl',
        week: { not: null }
      },
      include: {
        home: true,
        away: true,
        nflData: true,
        odds: {
          orderBy: { ts: 'desc' },
          take: 5, // Recent odds for display
        },
        edges: {
          orderBy: { ts: 'desc' },
          take: 1,
        }
      },
      orderBy: [
        { date: 'asc' },
        { week: 'asc' }
      ]
    })

    return games
  } catch (error) {
    console.error('Error fetching NFL games:', error)
    return []
  }
}

/**
 * Get NFL game detail
 */
export async function getNFLGameDetail(gameId) {
  try {
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      include: {
        home: true,
        away: true,
        nflData: true,
        odds: {
          orderBy: { ts: 'desc' },
          take: 20,
        },
        edges: {
          orderBy: { ts: 'desc' },
          take: 5,
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
            { position: 'asc' }
          ]
        }
      }
    })

    return game
  } catch (error) {
    console.error('Error fetching NFL game detail:', error)
    return null
  }
}

/**
 * Get NFL teams
 */
export async function getNFLTeams() {
  try {
    const teams = await prisma.team.findMany({
      where: {
        sport: 'nfl'
      },
      orderBy: [
        { league: 'asc' },
        { division: 'asc' },
        { abbr: 'asc' }
      ]
    })

    return teams
  } catch (error) {
    console.error('Error fetching NFL teams:', error)
    return []
  }
}
