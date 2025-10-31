// Get training mode statistics
// Shows mock prop accuracy and insights

// Force dynamic rendering (required for Vercel deployment)
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/db.js'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const sport = searchParams.get('sport') // optional filter
    
    // Build where clause
    const where = sport ? { sport } : {}
    
    // Get overall stats
    const totalProps = await prisma.mockPropValidation.count({ where })
    const pendingProps = await prisma.mockPropValidation.count({ 
      where: { ...where, status: 'pending' } 
    })
    const completedProps = await prisma.mockPropValidation.count({ 
      where: { ...where, status: 'completed' } 
    })
    
    // Get accuracy stats
    const correctProps = await prisma.mockPropValidation.count({ 
      where: { ...where, status: 'completed', result: 'correct' } 
    })
    const incorrectProps = await prisma.mockPropValidation.count({ 
      where: { ...where, status: 'completed', result: 'incorrect' } 
    })
    const pushProps = await prisma.mockPropValidation.count({ 
      where: { ...where, status: 'completed', result: 'push' } 
    })
    
    const accuracy = completedProps > 0 
      ? (correctProps / completedProps * 100).toFixed(1)
      : 0
    
    // Accuracy by prop type
    const propsByType = await prisma.mockPropValidation.groupBy({
      by: ['propType', 'result'],
      where: { ...where, status: 'completed' },
      _count: true
    })
    
    // Calculate accuracy per prop type
    const propTypeStats = {}
    for (const item of propsByType) {
      if (!propTypeStats[item.propType]) {
        propTypeStats[item.propType] = { correct: 0, incorrect: 0, push: 0, total: 0 }
      }
      propTypeStats[item.propType][item.result] = item._count
      propTypeStats[item.propType].total += item._count
    }
    
    // Format prop type stats
    const propTypeAccuracy = Object.entries(propTypeStats).map(([propType, stats]) => ({
      propType,
      accuracy: (stats.correct / stats.total * 100).toFixed(1),
      total: stats.total,
      correct: stats.correct,
      incorrect: stats.incorrect,
      push: stats.push
    })).sort((a, b) => b.accuracy - a.accuracy)
    
    // Accuracy by confidence level
    const confidenceStats = await prisma.mockPropValidation.groupBy({
      by: ['confidence', 'result'],
      where: { ...where, status: 'completed' },
      _count: true
    })
    
    const confidenceAccuracy = {}
    for (const item of confidenceStats) {
      if (!confidenceAccuracy[item.confidence]) {
        confidenceAccuracy[item.confidence] = { correct: 0, incorrect: 0, push: 0, total: 0 }
      }
      confidenceAccuracy[item.confidence][item.result] = item._count
      confidenceAccuracy[item.confidence].total += item._count
    }
    
    const confidenceStats2 = Object.entries(confidenceAccuracy).map(([confidence, stats]) => ({
      confidence,
      accuracy: (stats.correct / stats.total * 100).toFixed(1),
      total: stats.total
    }))
    
    // Recent predictions (last 20)
    const recentPredictions = await prisma.mockPropValidation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        playerName: true,
        propType: true,
        threshold: true,
        prediction: true,
        expectedValue: true,
        actualValue: true,
        result: true,
        status: true,
        confidence: true,
        qualityScore: true,
        sport: true,
        createdAt: true,
        validatedAt: true
      }
    })
    
    // Props by sport
    const propsBySport = await prisma.mockPropValidation.groupBy({
      by: ['sport'],
      _count: true
    })
    
    const sportBreakdown = {}
    for (const item of propsBySport) {
      const sportPending = await prisma.mockPropValidation.count({
        where: { sport: item.sport, status: 'pending' }
      })
      const sportCompleted = await prisma.mockPropValidation.count({
        where: { sport: item.sport, status: 'completed' }
      })
      const sportCorrect = await prisma.mockPropValidation.count({
        where: { sport: item.sport, status: 'completed', result: 'correct' }
      })
      
      sportBreakdown[item.sport] = {
        total: item._count,
        pending: sportPending,
        completed: sportCompleted,
        correct: sportCorrect,
        accuracy: sportCompleted > 0 ? (sportCorrect / sportCompleted * 100).toFixed(1) : 0
      }
    }
    
    // Game status breakdown
    const mockProps = await prisma.mockPropValidation.findMany({
      where: { status: 'pending' },
      select: { gameIdRef: true },
      distinct: ['gameIdRef']
    })
    
    const gameIds = mockProps.map(p => p.gameIdRef)
    const games = await prisma.game.findMany({
      where: { id: { in: gameIds } },
      select: {
        id: true,
        sport: true,
        status: true,
        date: true,
        homeTeam: true,
        awayTeam: true
      }
    })
    
    const gameStatusBreakdown = {
      upcoming: 0,
      inProgress: 0,
      finished: 0,
      total: games.length
    }
    
    const now = new Date()
    for (const game of games) {
      const gameDate = new Date(game.date)
      const hoursAgo = (now - gameDate) / (1000 * 60 * 60)
      
      const isFinal = ['final', 'completed', 'f', 'closed'].includes(game.status?.toLowerCase()) || hoursAgo > 5
      const isInProgress = !isFinal && hoursAgo > 0 && hoursAgo < 5
      
      if (isFinal) gameStatusBreakdown.finished++
      else if (isInProgress) gameStatusBreakdown.inProgress++
      else gameStatusBreakdown.upcoming++
    }
    
    // Calculate cost savings (vs paid API)
    // Assuming $0.01 per odds API call, and we'd need 1 call per prop
    const costSaved = (totalProps * 0.01).toFixed(2)
    
    return NextResponse.json({
      success: true,
      summary: {
        totalProps,
        pendingProps,
        completedProps,
        correctProps,
        incorrectProps,
        pushProps,
        accuracy: parseFloat(accuracy),
        costSaved: `$${costSaved}`
      },
      sportBreakdown,
      gameStatusBreakdown,
      propTypeAccuracy,
      confidenceStats: confidenceStats2,
      recentPredictions
    })
    
  } catch (error) {
    console.error('❌ Error fetching training stats:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}

