// Parlay Generator Page

'use client'

import { useState } from 'react'
import ParlayBuilder from '../../components/ParlayBuilder'
import ParlayResults from '../../components/ParlayResults'
import ParlayHistory from '../../components/ParlayHistory'

export default function ParlaysPage() {
  const [generatedParlays, setGeneratedParlays] = useState(null)
  const [refreshHistory, setRefreshHistory] = useState(0)

  const handleParlayGeneration = (parlays) => {
    console.log('ParlaysPage: Received parlays from builder:', parlays.length)
    setGeneratedParlays(parlays)
  }
  
  const handleParlaySaved = () => {
    // Trigger refresh of parlay history
    setRefreshHistory(prev => prev + 1)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            🎯 Parlay Generator
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Generate optimized parlays with the best edges and highest probability to hit. 
            Our algorithm analyzes thousands of betting opportunities to find the most profitable combinations.
          </p>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Builder Section */}
          <div className="lg:col-span-1">
            <div className="sticky top-8">
              <ParlayBuilder onGenerate={handleParlayGeneration} />
            </div>
          </div>

          {/* Results Section */}
          <div className="lg:col-span-2">
            <ParlayResults 
              generatedParlays={generatedParlays} 
              onParlaySaved={handleParlaySaved}
            />
          </div>
        </div>

        {/* History Section */}
        <div className="mt-12">
          <ParlayHistory key={refreshHistory} />
        </div>

        {/* Tips Section */}
        <div className="mt-12 bg-blue-50 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-4">
            💡 Parlay Tips
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-800">
            <div>
              <h4 className="font-medium mb-2">🎯 Best Practices:</h4>
              <ul className="space-y-1">
                <li>• Focus on parlays with positive expected value</li>
                <li>• Avoid correlated bets in the same game</li>
                <li>• Consider weather and situational factors</li>
                <li>• Don't chase high odds without good edges</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">📊 Understanding Metrics:</h4>
              <ul className="space-y-1">
                <li>• <strong>Edge:</strong> Our advantage over the market</li>
                <li>• <strong>Probability:</strong> True chance of winning</li>
                <li>• <strong>Expected Value:</strong> Average profit per bet</li>
                <li>• <strong>Confidence:</strong> Reliability of our analysis</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
