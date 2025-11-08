// Parlay Generator Page - Re-enabled with Supabase

'use client'

import { useState } from 'react'
import Link from 'next/link'
import ParlayBuilder from '../../components/ParlayBuilder.js'
import ParlayResults from '../../components/ParlayResults.js'

export default function ParlaysPage() {
  const [generatedParlays, setGeneratedParlays] = useState(null)

  const handleGenerate = (parlays) => {
    console.log('ParlaysPage: Received parlays:', parlays?.length)
    setGeneratedParlays(parlays)
  }

  const handleParlaySaved = () => {
    // Refresh parlay history if needed
    console.log('Parlay saved, refreshing...')
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <Link 
            href="/"
            className="inline-flex items-center text-sm font-medium text-blue-400 hover:text-blue-300 mb-4"
          >
            ← Back to Home
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white">
              🎯 Parlay Generator
            </h1>
            <p className="text-lg text-gray-400 mt-2">
              Build optimized multi-leg parlays with the best betting opportunities
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
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

        {/* Info Section */}
        <div className="mt-8 p-4 bg-blue-900/20 border border-blue-500/50 rounded-lg">
          <p className="text-sm text-blue-300">
            <strong>💡 How it works:</strong> Select your betting strategy, sport, and parlay type. 
            The system will generate optimized parlays based on player props and game-level bets with the best edges.
            Parlays are sorted by win probability, quality score, or edge depending on your selected strategy.
          </p>
        </div>
      </div>
    </div>
  )
}
