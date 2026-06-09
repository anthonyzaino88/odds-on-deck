'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import ParlayBuilder from '../../components/ParlayBuilder.js'
import ParlayResults from '../../components/ParlayResults.js'
import ParlayHistory from '../../components/ParlayHistory.js'
import { SportBadge, BookBadge } from '../../components/ui'

function formatOdds(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return '+100'
  if (decimalOdds >= 2.0) return `+${Math.round((decimalOdds - 1) * 100)}`
  return `${Math.round(-100 / (decimalOdds - 1))}`
}

function FeaturedParlayCard({ parlay, sport, parlayType }) {
  const gameIds = new Set(parlay.legs.map(l => l.gameId))
  const actualSGP = gameIds.size === 1

  return (
    <div className="bg-surface border border-white/[0.06] rounded-[4px] p-4 hover:bg-elevated transition-colors duration-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <SportBadge sport={sport} />
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide border ${
            actualSGP
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              : 'bg-white/[0.05] text-slate-400 border-white/[0.06]'
          }`}>
            {actualSGP ? 'SGP' : 'Multi-Game'}
          </span>
        </div>
        <div className="text-right">
          <div className="text-base font-semibold text-green-400 tabular-nums font-mono">{formatOdds(parlay.totalOdds)}</div>
          <div className="text-[10px] text-slate-500 tabular-nums font-mono">{parlay.totalOdds.toFixed(2)}x</div>
        </div>
      </div>
      <div className="space-y-1.5 mb-3">
        {parlay.legs.map((leg, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-slate-300 truncate mr-2">
              {leg.betType === 'prop'
                ? `${leg.playerName} ${leg.selection?.toUpperCase()} ${leg.threshold}`
                : `${leg.team} ${leg.betType}`
              }
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              {leg.bookmaker && <BookBadge book={leg.bookmaker} />}
              <span className="text-slate-500 tabular-nums font-mono">{formatOdds(leg.odds)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-blue-400 tabular-nums font-mono">{(parlay.probability * 100).toFixed(0)}% win</span>
          {parlay.expectedValue > 0 && (
            <span className="text-green-400 font-medium">+EV</span>
          )}
        </div>
        <div className="text-[10px] text-slate-600 tabular-nums font-mono">
          {parlay.legs.length}-leg &middot; {actualSGP ? 'same game' : `${gameIds.size} games`}
        </div>
      </div>
    </div>
  )
}

function SectionHeading({ title, action }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">
        {title}
      </h2>
      <div className="flex-1 h-px bg-white/[0.04]" />
      {action}
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
      <div>
        <SectionHeading title="Today's Featured Parlays" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-surface border border-white/[0.06] rounded-[4px] p-4 animate-pulse">
              <div className="h-4 w-20 bg-white/[0.06] rounded mb-3" />
              <div className="space-y-2">
                <div className="h-3 w-full bg-white/[0.04] rounded" />
                <div className="h-3 w-3/4 bg-white/[0.04] rounded" />
                <div className="h-3 w-5/6 bg-white/[0.04] rounded" />
              </div>
              <div className="h-6 w-16 bg-white/[0.06] rounded mt-4" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (cards.length === 0) return null

  return (
    <div>
      <SectionHeading
        title="Today's Featured Parlays"
        action={<span className="text-[11px] text-slate-600">Auto-generated from best lines</span>}
      />
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
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300 transition-colors duration-100 mb-3"
        >
          ← Home
        </Link>
        <h1 className="text-xl font-semibold text-slate-100">Parlay Builder</h1>
        <p className="text-sm text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
          A practical way to build and follow parlays. Assemble parlays from the current slate,
          save the ones you want to track, and review what happened later &mdash; all in one place.
        </p>
      </div>

      {/* Parlay of the Day */}
      <ParlayOfTheDay />

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ParlayBuilder onGenerate={handleGenerate} />
        <ParlayResults
          generatedParlays={generatedParlays}
          onParlaySaved={handleParlaySaved}
        />
      </div>

      {/* Parlay History Section */}
      <ParlayHistory refreshTrigger={refreshHistory} />

      {/* Info Section */}
      <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">How It Works</h4>
        <ul className="text-sm text-slate-400 space-y-1.5">
          <li>&bull; <span className="text-slate-200 font-medium">Featured Parlays</span> are auto-generated daily from the best available lines</li>
          <li>&bull; <span className="text-slate-200 font-medium">Build Your Own</span> by selecting sport, strategy, and leg count below</li>
          <li>&bull; <span className="text-slate-200 font-medium">Same-Game Parlays (SGPs)</span> stack multiple props from a single game</li>
          <li>&bull; <span className="text-slate-200 font-medium">Save &amp; Track</span> any parlay to monitor results when games complete</li>
          <li>&bull; <span className="text-slate-200 font-medium">Every leg</span> uses the sharpest line from 10+ sportsbooks</li>
        </ul>
      </div>
    </div>
  )
}
