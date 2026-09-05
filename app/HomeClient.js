'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import DataFreshness from '../components/DataFreshness.js'
import { cn } from '../lib/utils'
import { SectionHeading, SportBadge, SPORT_CONFIG } from '../components/ui'

const SPORT_SUB = { mlb: 'Games Today', nfl: 'Games This Week', nhl: 'Games Today' }

function FeatureCard({ title, description }) {
  return (
    <div className="bg-surface border border-white/[0.06] rounded-[4px] p-4 hover:bg-elevated hover:border-white/[0.10] transition-colors duration-150">
      <h3 className="text-sm font-semibold text-slate-100 mb-1.5">{title}</h3>
      <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
    </div>
  )
}

function StepCard({ number, title, description }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-6 h-6 rounded-[3px] bg-elevated flex items-center justify-center text-slate-300 font-semibold text-[11px] tabular-nums font-mono">
        {number}
      </div>
      <div>
        <h4 className="text-sm font-semibold text-slate-100 mb-0.5">{title}</h4>
        <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

function ConceptCard({ term, definition, example, href }) {
  return (
    <div className="bg-surface border border-white/[0.06] rounded-[4px] p-4">
      <dt className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
        <Link href={href} className="hover:text-slate-300 transition-colors">
          {term}
        </Link>
      </dt>
      <dd className="text-slate-300 text-xs leading-relaxed mb-1.5">{definition}</dd>
      {example && (
        <dd className="text-[11px] text-slate-600 leading-relaxed">{example}</dd>
      )}
    </div>
  )
}

export default function HomeClient() {
  const [games, setGames] = useState({ mlb: [], nfl: [], nhl: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [todayStr, setTodayStr] = useState('')

  useEffect(() => {
    setTodayStr(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))

    const fetchGames = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/games/today', { cache: 'no-store' })
        if (!response.ok) throw new Error(`API returned ${response.status}`)
        const result = await response.json()
        if (result.success) {
          setGames(result.data)
        } else {
          setError(result.error || 'Failed to load games')
        }
      } catch (err) {
        setError(err.message)
        setGames({ mlb: [], nfl: [], nhl: [] })
      } finally {
        setLoading(false)
      }
    }

    fetchGames()
  }, [])

  return (
    <div className="pb-8">

      <div className="flex items-center gap-3 mb-6">
        <p className="text-xs text-slate-500 tabular-nums">{todayStr}</p>
        <DataFreshness />
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-500/[0.08] border border-red-500/20 rounded-[4px] p-4 mb-8">
          <p className="text-sm text-red-400 font-medium">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-red-400/80 text-xs mt-2 underline hover:text-red-400 transition-colors"
          >
            Try refreshing
          </button>
        </div>
      )}

      {/* Today's Slate */}
      <section className="mb-10">
        <SectionHeading title="Today's Slate" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {loading
            ? ['mlb', 'nfl', 'nhl'].map((sport) => (
                <div key={sport} className="bg-surface border border-white/[0.06] rounded-[4px] p-4 animate-pulse">
                  <div className="h-4 w-12 bg-elevated rounded-[3px] mb-3" />
                  <div className="h-8 w-10 bg-elevated rounded-[3px] mb-1" />
                  <div className="h-3 w-20 bg-elevated/60 rounded-[3px]" />
                </div>
              ))
            : Object.keys(SPORT_CONFIG).map((sport) => {
                const cfg = SPORT_CONFIG[sport]
                return (
                  <Link key={sport} href={`/games#${sport}`}>
                    <div className="bg-surface border border-white/[0.06] rounded-[4px] p-4 hover:bg-elevated hover:border-white/[0.10] transition-colors duration-150 cursor-pointer h-full">
                      <div className="flex items-center justify-between mb-3">
                        <SportBadge sport={sport} />
                      </div>
                      <p className={cn('text-2xl font-semibold tabular-nums font-mono', cfg.text)}>
                        {games[sport]?.length ?? 0}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{SPORT_SUB[sport]}</p>
                    </div>
                  </Link>
                )
              })}
        </div>
      </section>

      {/* What this is for */}
      <section className="mb-10">
        <SectionHeading title="What This Is For" />
        <p className="text-sm text-slate-400 mb-4 max-w-2xl">
          Most tools show you one book&apos;s odds. We show you <span className="text-slate-100 font-medium">all of them</span> &mdash; in one place, with the math already done.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <FeatureCard title="Line Shopping" description="See odds from 10+ sportsbooks for the same prop, side-by-side. When one book has a better number, it's obvious at a glance." />
          <FeatureCard title="Vig-Free Probabilities" description="We strip the sportsbook margin from every line so you see the real market-implied probability." />
          <FeatureCard title="Sortable Quality Score" description="Combines line deviation from market consensus and the number of books offering each prop. Surfaces unusual lines worth a closer look." />
          <FeatureCard title="Full Transparency" description="Every prop is tracked against actual game results. Hit rate and record update automatically — no hidden losses." />
          <FeatureCard title="Track & Save" description="Save props or whole parlays to follow them through to the result. Come back to see what hit and what missed." />
          <FeatureCard title="Parlay Comparison" description="Build parlays using the best available number for each leg. See combined odds and implied probability before placing." />
        </div>
      </section>

      {/* How It Works */}
      <section className="mb-10">
        <SectionHeading title="How It Works" />
        <div className="space-y-5">
          <StepCard number="1" title="We pull today's games from ESPN and league APIs" description="Every morning we fetch the full slate — schedules, probable pitchers, matchup context — for MLB, NHL, and NFL." />
          <StepCard number="2" title="Live odds are pulled from 10+ sportsbooks" description="Moneylines, spreads, totals, and player prop markets pulled in real time. You see what DraftKings, FanDuel, BetMGM, BetRivers, and others are posting — all in one place." />
          <StepCard number="3" title="We strip the vig and surface the comparison" description="For each line we remove the sportsbook margin to reveal the real market-implied probability, then show how each book's number compares to consensus." />
          <StepCard number="4" title="Outlier lines are flagged for a closer look" description="Props where one book's price differs meaningfully from the rest move to the top. You decide whether they're worth tracking." />
          <StepCard number="5" title="Every tracked prop is graded after the game" description="When the box score is final, we pull official stats and grade every prop. Hit rate and record update automatically." />
        </div>
      </section>

      {/* Key Concepts */}
      <section className="mb-10">
        <SectionHeading title="Key Concepts" />
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ConceptCard href="/glossary/edge" term="Edge" definition="The percentage difference between one book's implied probability and the vig-removed market consensus. A positive edge means that book is offering a better price than the rest of the market." example="If consensus is 55% but one book implies only 48%, that book is paying more than the market thinks it should." />
          <ConceptCard href="/glossary/implied-probability" term="Implied Probability" definition="The break-even win rate embedded in the odds. American odds of -110 imply ~52.4% — you need to win more than that to profit long-term." example="+150 odds imply 40% probability. If the true chance is 50%, that's a value bet." />
          <ConceptCard href="/glossary/vig" term="Vig (Juice)" definition="The sportsbook's built-in margin. Both sides of a bet add up to more than 100%. We strip the vig to see the true market probability." example="-110 on both sides = ~104.8% total. The extra 4.8% is the book's cut." />
          <ConceptCard href="/glossary/quality-score" term="Quality Score" definition="A sorting aid (0-10) combining line deviation from consensus, the number of books offering the prop, and implied probability. It's context, not a recommendation." example="Scores above 7 typically mean strong agreement across books and a meaningful gap from consensus." />
          <ConceptCard href="/glossary/line-shopping" term="Line Shopping" definition="Comparing the same bet across multiple sportsbooks to find the best price. A half-point or +10 in odds compounds over hundreds of bets." example="Player Over 2.5 hits might be -130 on DraftKings but -110 on BetRivers." />
          <ConceptCard href="/glossary/win-probability" term="Win Probability" definition="The market-implied chance the bet wins, derived from stripping the vig from the consensus line. This is what the collective market thinks, not a proprietary model." />
        </dl>
      </section>

      {/* Jump in */}
      <section className="mb-10">
        <SectionHeading title="Jump In" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link href="/props">
            <div className="bg-surface border border-white/[0.06] rounded-[4px] p-4 hover:bg-elevated hover:border-white/[0.10] transition-colors duration-150 cursor-pointer h-full">
              <h3 className="text-sm font-semibold text-slate-100 mb-0.5">Player Props</h3>
              <p className="text-xs text-slate-500">Compare lines across books</p>
            </div>
          </Link>
          <Link href="/games">
            <div className="bg-surface border border-white/[0.06] rounded-[4px] p-4 hover:bg-elevated hover:border-white/[0.10] transition-colors duration-150 cursor-pointer h-full">
              <h3 className="text-sm font-semibold text-slate-100 mb-0.5">Today&apos;s Slate</h3>
              <p className="text-xs text-slate-500">Full schedule and scores</p>
            </div>
          </Link>
          <Link href="/picks">
            <div className="bg-surface border border-white/[0.06] rounded-[4px] p-4 hover:bg-elevated hover:border-white/[0.10] transition-colors duration-150 cursor-pointer h-full">
              <h3 className="text-sm font-semibold text-slate-100 mb-0.5">Editor&apos;s Picks</h3>
              <p className="text-xs text-slate-500">Curated props worth a closer look</p>
            </div>
          </Link>
        </div>
      </section>

    </div>
  )
}
