'use client'

import { useState } from 'react'
import Link from 'next/link'
import ParlayBuilder from '../../components/ParlayBuilder.js'
import ParlayResults from '../../components/ParlayResults.js'
import ParlayHistory from '../../components/ParlayHistory.js'
import ParlayStats from '../../components/ParlayStats.js'

export default function ParlaysPage() {
  const [generatedParlays, setGeneratedParlays] = useState(null)
  const [refreshHistory, setRefreshHistory] = useState(0)

  const handleGenerate = (parlays) => {
    console.log('ParlaysPage: Received parlays:', parlays?.length)
    setGeneratedParlays(parlays)
  }

  const handleParlaySaved = () => {
    // Refresh parlay history when a parlay is saved
    console.log('Parlay saved, refreshing history...')
    setRefreshHistory(prev => prev + 1)
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <Link 
            href="/"
            className="inline-flex items-center text-sm font-medium text-blue-400 hover:text-blue-300 mb-4"
          >
            ← Back to Home
          </Link>
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              🎯 Parlay Generator
            </h1>
            <p className="text-base sm:text-lg text-gray-400 mt-2">
              Build optimized multi-leg parlays
            </p>
          </div>
        </div>

        {/* Parlay Performance Banner */}
        <div className="mb-6">
          <ParlayStats mode="simple" />
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
          {/* Parlay Builder */}
          <div>
            <ParlayBuilder onGenerate={handleGenerate} />
          </div>

          {/* Parlay Results */}
          <div>
            <ParlayResults 
              generatedParlays={generatedParlays} 
              onParlaySaved={handleParlaySaved}
            />
          </div>
        </div>

        {/* Parlay History Section */}
        <div className="mb-8">
          <ParlayHistory refreshTrigger={refreshHistory} />
        </div>

        {/* Info Section */}
        <div className="mt-8 p-4 bg-blue-900/20 border border-blue-500/50 rounded-lg">
          <h4 className="font-semibold text-blue-300 mb-2">💡 How It Works</h4>
          <ul className="text-sm text-blue-200 space-y-1">
            <li>• <strong>Generate:</strong> Select sport, legs, and strategy to create optimized parlays</li>
            <li>• <strong>Save:</strong> Click "Save Parlay" to track it for validation</li>
            <li>• <strong>Track:</strong> View your saved parlays below and their outcomes</li>
            <li>• <strong>Validate:</strong> System auto-updates results when games complete</li>
            <li>• <strong>Learn:</strong> Use performance data to refine your strategy</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
