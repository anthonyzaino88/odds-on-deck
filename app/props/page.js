// Player Props Page - Display player prop betting opportunities

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import PlayerPropsFilter from '../../components/PlayerPropsFilter.js'
import DataFreshness from '../../components/DataFreshness.js'
import { cn } from '../../lib/utils'
import { SectionHeading } from '../../components/ui'

const SPORT_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'mlb', label: 'MLB' },
  { value: 'nhl', label: 'NHL' },
  { value: 'nfl', label: 'NFL' },
]

export default function PropsPage() {
  const [props, setProps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sportFilter, setSportFilter] = useState('all') // 'all', 'mlb', 'nfl', 'nhl'

  useEffect(() => {
    fetchProps()
  }, [sportFilter])

  async function fetchProps() {
    try {
      setLoading(true)
      setError(null)

      const url = sportFilter === 'all'
        ? '/api/props'
        : `/api/props?sport=${sportFilter}`

      const response = await fetch(url)
      const data = await response.json()

      if (data.success) {
        setProps(data.props || [])
      } else {
        setError(data.error || 'Failed to load props')
      }
    } catch (err) {
      console.error('Error fetching props:', err)
      setError('Failed to load player props. Please try again later.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="pb-8">

      {/* Header */}
      <header className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300 transition-colors mb-3"
        >
          &larr; Home
        </Link>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-xl font-semibold text-slate-100 tracking-tight">Player Props</h1>
        </div>
        <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
          Compare prop lines across 10+ sportsbooks side-by-side. See the best available
          number and how it stacks up against the market.
        </p>
        <div className="mt-2">
          <DataFreshness />
        </div>
      </header>

      {/* Sport Filter + quick stats */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-0.5 bg-surface border border-white/[0.06] rounded-[4px] p-0.5 w-fit">
          {SPORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSportFilter(opt.value)}
              className={cn(
                'px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide rounded-[3px] transition-colors duration-100',
                sportFilter === opt.value
                  ? 'bg-elevated text-slate-100'
                  : 'text-slate-500 hover:text-slate-300',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {!loading && !error && props.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            <span><span className="text-slate-100 font-medium tabular-nums font-mono">{props.length}</span> compared</span>
            <span className="hidden sm:block h-3 w-px bg-white/[0.06]" />
            <span><span className="text-green-400 font-medium tabular-nums font-mono">{props.filter(p => (p.probability || 0) >= 0.55).length}</span> @ 55%+</span>
            <span className="hidden sm:block h-3 w-px bg-white/[0.06]" />
            <span><span className="text-slate-300 font-medium tabular-nums font-mono">{props.filter(p => (p.probability || 0) >= 0.52).length}</span> above breakeven</span>
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="rounded-[4px] border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-3 py-2.5 bg-surface animate-pulse">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-28 bg-elevated rounded-[3px]" />
                    <div className="h-3 w-10 bg-elevated/60 rounded-[3px]" />
                  </div>
                  <div className="h-3 w-44 bg-elevated/40 rounded-[3px]" />
                </div>
                <div className="h-4 w-16 bg-elevated/40 rounded-[3px]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-500/[0.08] border border-red-500/20 rounded-[4px] p-4 mb-6">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={fetchProps}
            className="mt-3 px-3 py-1.5 rounded-md bg-elevated hover:bg-[#283548] border border-white/[0.12] text-slate-100 text-xs font-medium transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Props Display */}
      {!loading && !error && (
        <>
          {props.length > 0 ? (
            sportFilter !== 'all' && (
              <div className="flex items-center justify-between bg-surface border border-white/[0.06] rounded-[4px] px-4 py-2.5 mb-4">
                <p className="text-xs text-slate-400">
                  <span className="text-slate-100 font-semibold uppercase tracking-wide">{sportFilter}</span>
                  {' '}&middot;{' '}
                  <span className="tabular-nums font-mono">{props.length}</span> props compared
                </p>
                <button
                  onClick={() => setSportFilter('all')}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-100 transition-colors"
                >
                  View all
                </button>
              </div>
            )
          ) : (
            <div className="bg-surface border border-white/[0.06] rounded-[4px] p-8">
              <h3 className="text-sm font-semibold text-slate-100 mb-1">No player props available</h3>
              <p className="text-sm text-slate-500 mb-1">
                {sportFilter === 'all'
                  ? "No player props are available right now. Props appear once today's odds are published by the sportsbooks."
                  : `No ${sportFilter.toUpperCase()} player props available right now.`}
              </p>
              <p className="text-xs text-slate-600">
                Props are typically available a few hours before game time.
              </p>
              {sportFilter !== 'all' && (
                <button
                  onClick={() => setSportFilter('all')}
                  className="mt-4 px-3 py-1.5 rounded-md bg-elevated hover:bg-[#283548] border border-white/[0.12] text-slate-100 text-xs font-medium transition-colors"
                >
                  View all sports
                </button>
              )}
            </div>
          )}

          {props.length > 0 && <PlayerPropsFilter props={props} />}
        </>
      )}

      {/* Info Section */}
      <div className="mt-8">
        <SectionHeading title="How This Page Works" />
        <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">
          Player props are pulled in real time from 10+ sportsbooks via The Odds API. Each prop
          is shown with the best available number, the bookmaker offering it, and how it compares
          to the rest of the market. Sort and filter to surface the comparisons that matter most.
        </p>
      </div>
    </div>
  )
}
