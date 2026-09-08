// Editor's Picks — public shortlist of props we'd actually bet

'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { useState, useEffect } from 'react'
import DataFreshness from '../../components/DataFreshness.js'
import EditorsPicksDesk from '../../components/EditorsPicksDesk.js'
import SidesAndTotalsCard from '../../components/SidesAndTotalsCard.js'

export default function PicksPage() {
  const [picks, setPicks] = useState([])
  const [gameLines, setGameLines] = useState([])
  const [sidesTotals, setSidesTotals] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    fetchPicks()
  }, [])

  async function fetchPicks() {
    try {
      setLoading(true)
      const response = await fetch('/api/picks')
      const data = await response.json()

      if (data.success) {
        setPicks(data.picks || [])
        setGameLines(data.gameLines || [])
        setSidesTotals(data.sidesTotals || null)
        setLastUpdated(new Date())
      } else {
        console.error('Failed to fetch picks:', data.error)
        setPicks([])
        setGameLines([])
        setSidesTotals(null)
      }
    } catch (err) {
      console.error('Error fetching picks:', err)
      setPicks([])
      setGameLines([])
      setSidesTotals(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/"
          className="inline-flex items-center text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300 transition-colors duration-100 mb-3"
        >
          ← Home
        </Link>
        <h1 className="text-xl font-semibold text-slate-100">Editor&apos;s Picks</h1>
        <p className="text-sm text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
          These are the props we&apos;d actually bet &mdash; a short list aimed
          at ROI, not a tour of every interesting line. MLB and NFL only.
          Prices in a sane range, roughly −200 to +250. The model has to show
          a positive edge. Quality score of 40 or better. Same standard as
          Today&apos;s picks on the homepage and the{' '}
          <Link href="/validation" className="text-slate-300 underline decoration-white/15 underline-offset-2 hover:text-slate-100">
            public track record
          </Link>.
        </p>
        <div className="flex items-center gap-3 mt-2.5">
          {lastUpdated && (
            <span className="text-[11px] text-slate-500 tabular-nums font-mono" suppressHydrationWarning>
              Updated {format(lastUpdated, 'h:mm a')}
            </span>
          )}
          <DataFreshness />
        </div>
      </div>

      <EditorsPicksDesk picks={picks} loading={loading} />

      <SidesAndTotalsCard lines={gameLines} loading={loading} summary={sidesTotals} />

      <div className="p-4 bg-amber-500/[0.08] border border-amber-500/20 rounded-[4px]">
        <p className="text-xs text-amber-400/90 leading-relaxed">
          <span className="font-semibold">Disclaimer:</span> These picks are for educational purposes based on
          statistical models. Always gamble responsibly and within your means. Past performance does not
          guarantee future results.
        </p>
      </div>
    </div>
  )
}
