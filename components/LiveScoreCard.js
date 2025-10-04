// Live Score Card - Optimized for real-time scoring updates
// Displays live scores for active games with minimal API calls

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function LiveScoreCard({ game, refreshInterval = 15000 }) {
  const [liveData, setLiveData] = useState(game)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Auto-refresh for live games only
  useEffect(() => {
    if (!isGameLive(game)) return

    const interval = setInterval(async () => {
      if (!isRefreshing) {
        setIsRefreshing(true)
        try {
          const response = await fetch(`/api/games/${game.id}`)
          if (response.ok) {
            const result = await response.json()
            if (result.success) {
              setLiveData(result.game)
            }
          }
        } catch (error) {
          console.error('Error refreshing live data:', error)
        } finally {
          setIsRefreshing(false)
        }
      }
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [game.id, refreshInterval, isRefreshing])

  const isGameLive = (game) => {
    return game.status === 'in_progress' || game.status === 'warmup' || game.status === 'halftime'
  }

  const formatScore = () => {
    if (liveData.homeScore === null || liveData.awayScore === null) {
      return '0-0'
    }
    return `${liveData.awayScore}-${liveData.homeScore}`
  }

  const formatGameStatus = () => {
    if (liveData.status === 'final') {
      return <span className="text-green-600 font-semibold">FINAL</span>
    }
    
    if (liveData.status === 'in_progress') {
      if (liveData.sport === 'nfl' && liveData.nflData) {
        return `Q${liveData.nflData.quarter || '?'} ${liveData.nflData.timeLeft || ''}`
      } else if (liveData.sport === 'mlb') {
        return `${liveData.inningHalf || ''} ${liveData.inning || ''}${liveData.outs !== null ? ` • ${liveData.outs} out` : ''}`
      }
    }
    
    if (liveData.status === 'warmup') {
      return <span className="text-yellow-600">Starting Soon</span>
    }
    
    if (liveData.status === 'halftime') {
      return <span className="text-blue-600">HALFTIME</span>
    }
    
    return liveData.status
  }

  const getStatusColor = () => {
    if (liveData.status === 'in_progress') return 'text-red-600'
    if (liveData.status === 'warmup') return 'text-yellow-600'
    if (liveData.status === 'halftime') return 'text-blue-600'
    if (liveData.status === 'final') return 'text-green-600'
    return 'text-gray-600'
  }

  return (
    <Link href={`/game/${game.id}`}>
      <div className="flex items-center justify-between p-4 bg-white rounded-lg shadow-sm border border-gray-200 hover:border-blue-300 transition-colors cursor-pointer">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-gray-900">
              {liveData.away.abbr} @ {liveData.home.abbr}
            </div>
            <div className={`text-sm font-medium ${getStatusColor()}`}>
              {isGameLive(liveData) && (
                <span className="inline-flex items-center">
                  <div className="w-2 h-2 bg-red-500 rounded-full mr-1 animate-pulse"></div>
                  LIVE
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {formatGameStatus()}
            </div>
            <div className="text-lg font-bold text-gray-900">
              {formatScore()}
            </div>
          </div>
        </div>
        
        {isRefreshing && (
          <div className="ml-2">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>
    </Link>
  )
}

