'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import ParlayBuilder from '../../components/ParlayBuilder.js'
import ParlayResults from '../../components/ParlayResults.js'
import ParlayHistory from '../../components/ParlayHistory.js'

function formatOdds(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return '+100'
  if (decimalOdds >= 2.0) return `+${Math.round((decimalOdds - 1) * 100)}`
  return `${Math.round(-100 / (decimalOdds - 1))}`
}

const SPORT_META = {
  mlb: { icon: '⚾', label: 'MLB' },
  nhl: { icon: '🏒', label: 'NHL' },
  nfl: { icon: '🏈', label: 'NFL' },
}

function FeaturedParlayCard({ parlay, sport, parlayType }) {
  const meta = SPORT_META[sport] || { icon: '🎯', label: sport.toUpperCase() }
  const isSGP = parlayType === 'sgp'
  const gameIds = new Set(parlay.legs.map(l => l.gameId))
  const actualSGP = gameIds.size === 1

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-xl p-5 hover:border-blue-500/40 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{meta.icon}</span>
          <span className="text-sm font-bold text-white">{meta.label}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            actualSGP
              ? 'bg-purple-900/40 text-purple-400 border border-purple-500/30'
              : 'bg-blue-900/40 text-blue-400 border border-blue-500/30'
          }`}>
            {actualSGP ? 'SGP' : 'Multi-Game'}
          </span>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-green-400">{formatOdds(parlay.totalOdds)}</div>
          <div className="text-[10px] text-gray-500">{parlay.totalOdds.toFixed(2)}x</div>
        </div>
      </div>
      <div className="space-y-1.5 mb-3">
        {parlay.legs.map((leg, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-gray-300 truncate mr-2">
              {leg.betType === 'prop'
                ? `${leg.playerName} ${leg.selection?.toUpperCase()} ${leg.threshold}`
                : `${leg.team} ${leg.betType}`
              }
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              {leg.bookmaker && (
                <span className="text-[9px] text-cyan-400">{leg.bookmaker}</span>
              )}
              <span className="text-gray-500">{formatOdds(leg.odds)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-slate-700">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-blue-400">{(parlay.probability * 100).toFixed(0)}% win</span>
          {parlay.expectedValue > 0 && (
            <span className="text-green-400">+EV</span>
          )}
        </div>
        <div className="text-[10px] text-gray-600">
          {parlay.legs.length}-leg &middot; {actualSGP ? 'same game' : `${gameIds.size} games`}
        </div>
      </div>
    </div>
  )
}

function ParlayOfTheDay() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchFeatured() {
      const sports = ['mlb', 'nhl', 'nfl']
      const results = []

      await Promise.all(sports.flatMap(s => [
        fetch(`/api/parlays/generate?sport=${s}&legs=3&maxParlays=1&type=single_game`)
          .then(r => r.json())
          .then(data => {
            if (data.success && data.parlays?.length > 0) {
              results.push({ sport: s, parlay: data.parlays[0], type: 'sgp' })
            }
          })
          .catch(() => {}),
        fetch(`/api/parlays/generate?sport=${s}&legs=3&maxParlays=1`)
          .then(r => r.json())
          .then(data => {
            if (data.success && data.parlays?.length > 0) {
              results.push({ sport: s, parlay: data.parlays[0], type: 'multi' })
            }
          })
          .catch(() => {}),
      ]))

      const deduped = []
      const seen = new Set()
      for (const r of results) {
        const key = `${r.sport}-${r.type}`
        if (!seen.has(key)) {
          seen.add(key)
          deduped.push(r)
        }
      }
      deduped.sort((a, b) => {
        const sportOrder = { mlb: 0, nhl: 1, nfl: 2 }
        const sd = (sportOrder[a.sport] ?? 9) - (sportOrder[b.sport] ?? 9)
        if (sd !== 0) return sd
        return a.type === 'sgp' ? -1 : 1
      })
      setCards(deduped)
      setLoading(false)
    }
    fetchFeatured()
  }, [])

  if (loading) {
    return (
      <div className="mb-8">
        <h2 className="text-xl font-bold text-white mb-4">Today&apos;s Featured Parlays</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 animate-pulse">
              <div className="h-5 w-24 bg-slate-700 rounded mb-3" />
              <div className="space-y-2">
                <div className="h-4 w-full bg-slate-700/50 rounded" />
                <div className="h-4 w-3/4 bg-slate-700/50 rounded" />
                <div className="h-4 w-5/6 bg-slate-700/50 rounded" />
              </div>
              <div className="h-8 w-20 bg-slate-700 rounded mt-4" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (cards.length === 0) return null

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-xl font-bold text-white">Today&apos;s Featured Parlays</h2>
        <span className="text-xs text-gray-500 bg-slate-800 px-2 py-1 rounded">Auto-generated from best lines</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c, i) => (
          <FeaturedParlayCard key={`${c.sport}-${c.type}-${i}`} parlay={c.parlay} sport={c.sport} parlayType={c.type} />
        ))}
      </div>
    </div>
  )
}

export default function ParlaysPage() {
  const [generatedParlays, setGeneratedParlays] = useState(null)
  const [refreshHistory, setRefreshHistory] = useState(0)

  const handleGenerate = (parlays) => setGeneratedParlays(parlays)
  const handleParlaySaved = () => setRefreshHistory(prev => prev + 1)

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        
        {/* Header */}
        <div className="mb-8">
          <Link 
            href="/"
            className="inline-flex items-center text-sm font-medium text-blue-400 hover:text-blue-300 mb-4"
          >
            &larr; Back to Home
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white">
              Parlay Builder
            </h1>
            <p className="text-lg text-gray-400 mt-2">
              Combine the sharpest lines from 10+ sportsbooks into multi-leg parlays
            </p>
          </div>
        </div>

        {/* Parlay of the Day */}
        <ParlayOfTheDay />

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div>
            <ParlayBuilder onGenerate={handleGenerate} />
          </div>
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
          <h4 className="font-semibold text-blue-300 mb-2">How It Works</h4>
          <ul className="text-sm text-blue-200 space-y-1">
            <li>&bull; <strong>Featured Parlays</strong> are auto-generated daily from the best available lines</li>
            <li>&bull; <strong>Build Your Own</strong> by selecting sport, strategy, and leg count below</li>
            <li>&bull; <strong>Same-Game Parlays (SGPs)</strong> stack multiple props from a single game</li>
            <li>&bull; <strong>Save &amp; Track</strong> any parlay to monitor results when games complete</li>
            <li>&bull; <strong>Every leg</strong> uses the sharpest line from 10+ sportsbooks</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
