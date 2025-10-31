// Cleanup endpoint to remove old game records
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { prisma } from '../../../../lib/db.js'

export async function POST(request) {
  try {
    // Delete games older than 30 days
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    
    // Format as YYYY-MM-DD for comparison
    const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0]
    
    console.log(`🗑️ Deleting games older than ${cutoffDate}...`)
    
    // Delete old games
    const result = await prisma.game.deleteMany({
      where: {
        gameDate: {
          lt: cutoffDate
        }
      }
    })
    
    console.log(`✅ Deleted ${result.count} old games`)
    
    // Also clean up any games with status 'final' that are more than 7 days old
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDayCutoff = sevenDaysAgo.toISOString().split('T')[0]
    
    const finalResult = await prisma.game.deleteMany({
      where: {
        status: 'final',
        gameDate: {
          lt: sevenDayCutoff
        }
      }
    })
    
    console.log(`✅ Deleted ${finalResult.count} completed games older than 7 days`)
    
    return Response.json({
      success: true,
      deleted: {
        oldGames: result.count,
        completedGames: finalResult.count,
        total: result.count + finalResult.count
      },
      cutoffDate,
      message: `Cleaned up ${result.count + finalResult.count} old game records`
    })
  } catch (error) {
    console.error('Cleanup error:', error)
    return Response.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}




