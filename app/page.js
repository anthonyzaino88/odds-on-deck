'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import DataFreshness from '../components/DataFreshness.js'

function FeatureCard({ icon, title, description }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 hover:border-blue-500/40 transition-colors">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
    </div>
  )
}

function StepCard({ number, title, description }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
        {number}
      </div>
      <div>
        <h4 className="font-semibold text-white mb-1">{title}</h4>
        <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

function ConceptCard({ term, definition, example }) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-5 border border-slate-700/50">
      <dt className="font-semibold text-blue-400 text-sm uppercase tracking-wide mb-2">{term}</dt>
      <dd className="text-gray-300 text-sm leading-relaxed mb-2">{definition}</dd>
      {example && (
        <dd className="text-xs text-gray-500 italic">{example}</dd>
      )}
    </div>
  )
}

function StatSkeleton() {
  return <div className="h-8 w-20 bg-slate-700 rounded animate-pulse mx-auto" />
}

function decimalToAmerican(d) {
  if (!d || d === 1) return '+100'
  d = parseFloat(d)
  if (isNaN(d)) return null
  return d >= 2.0 ? `+${Math.round((d - 1) * 100)}` : `${Math.round(-100 / (d - 1))}`
}

export default function HomePage() {
  const [games, setGames] = useState({ mlb: [], nfl: [], nhl: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [todayStr, setTodayStr] = useState('')
  const [validationStats, setValidationStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [topProps, setTopProps] = useState([])
  const [propsLoading, setPropsLoading] = useState(true)

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

    const fetchStats = async () => {
      try {
        const response = await fetch('/api/validation?type=stats')
        if (response.ok) {
          const result = await response.json()
          if (result.success) setValidationStats(result.data)
        }
      } catch {
        // Stats are non-critical; silently fail
      } finally {
        setStatsLoading(false)
      }
    }

    const fetchTopProps = async () => {
      try {
        const response = await fetch('/api/props?limit=5')
        if (response.ok) {
          const result = await response.json()
          if (result.success) setTopProps(result.props?.slice(0, 5) || [])
        }
      } catch {
        // Non-critical
      } finally {
        setPropsLoading(false)
      }
    }

    fetchGames()
    fetchStats()
    fetchTopProps()
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12">

        {/* Hero */}
        <div className="text-center mb-16">
          <h1 className="text-5xl sm:text-6xl font-extrabold mb-4 bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent tracking-tight">
            Odds on Deck
          </h1>
          <p className="text-xl text-blue-400 font-medium mb-4">
            Compare lines. Track props. Learn from results.
          </p>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg leading-relaxed">
            We pull live odds from 10+ sportsbooks side-by-side, so you can see at a glance
            where each book&apos;s number stands relative to the rest of the market.
            Save props, follow them, and review what hit &mdash; full record, no cherry-picking.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            <span className="px-4 py-1.5 rounded-full bg-green-900/30 border border-green-500/40 text-green-400 text-sm font-medium">MLB</span>
            <span className="px-4 py-1.5 rounded-full bg-cyan-900/30 border border-cyan-500/40 text-cyan-400 text-sm font-medium">NHL</span>
            <span className="px-4 py-1.5 rounded-full bg-blue-900/30 border border-blue-500/40 text-blue-400 text-sm font-medium">NFL</span>
          </div>
          <div className="flex items-center justify-center gap-3 mt-4">
            <p className="text-slate-500 text-sm">{todayStr}</p>
            <DataFreshness />
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-lg p-6 mb-8">
            <p className="text-red-200 font-medium">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-red-400 text-sm mt-3 underline hover:text-red-300 transition"
            >
              Try refreshing
            </button>
          </div>
        )}

        {/* Today's Slate */}
        {loading ? (
          <div className="mb-16">
            <h2 className="text-2xl font-bold text-white mb-6 text-center">Today&apos;s Slate</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {['MLB', 'NFL', 'NHL'].map((sport) => (
                <div key={sport} className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-6 h-full text-center animate-pulse">
                  <div className="h-8 w-24 bg-slate-700 rounded mx-auto mb-4" />
                  <div className="h-10 w-12 bg-slate-700 rounded mx-auto mb-2" />
                  <div className="h-4 w-20 bg-slate-700/60 rounded mx-auto" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-16">
            <h2 className="text-2xl font-bold text-white mb-6 text-center">Today&apos;s Slate</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Link href="/games#mlb">
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-6 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/20 transition cursor-pointer h-full group text-center">
                  <h3 className="text-3xl font-bold mb-1 group-hover:text-blue-400 transition">&#9918; MLB</h3>
                  <p className="text-slate-500 text-sm mb-4">Major League Baseball</p>
                  <p className="text-4xl font-bold text-blue-400">{games.mlb.length}</p>
                  <p className="text-slate-400 text-xs mt-1">Games Today</p>
                </div>
              </Link>
              <Link href="/games#nfl">
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-6 hover:border-green-500 hover:shadow-lg hover:shadow-green-500/20 transition cursor-pointer h-full group text-center">
                  <h3 className="text-3xl font-bold mb-1 group-hover:text-green-400 transition">&#127944; NFL</h3>
                  <p className="text-slate-500 text-sm mb-4">National Football League</p>
                  <p className="text-4xl font-bold text-green-400">{games.nfl.length}</p>
                  <p className="text-slate-400 text-xs mt-1">Games This Week</p>
                </div>
              </Link>
              <Link href="/games#nhl">
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-6 hover:border-cyan-500 hover:shadow-lg hover:shadow-cyan-500/20 transition cursor-pointer h-full group text-center">
                  <h3 className="text-3xl font-bold mb-1 group-hover:text-cyan-400 transition">&#127954; NHL</h3>
                  <p className="text-slate-500 text-sm mb-4">National Hockey League</p>
                  <p className="text-4xl font-bold text-cyan-400">{games.nhl.length}</p>
                  <p className="text-slate-400 text-xs mt-1">Games Today</p>
                </div>
              </Link>
            </div>
          </div>
        )}

        {/* Top Props Preview */}
        <section className="mb-16">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">Top props right now</h2>
            <Link href="/props" className="text-sm text-blue-400 hover:text-blue-300 font-medium">
              View all &rarr;
            </Link>
          </div>
          {propsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="h-5 w-28 bg-slate-700 rounded" />
                    <div className="h-4 w-40 bg-slate-700/50 rounded" />
                    <div className="ml-auto h-5 w-16 bg-slate-700 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : topProps.length > 0 ? (
            <div className="space-y-3">
              {topProps.map((prop) => {
                const odds = decimalToAmerican(prop.odds)
                return (
                  <Link key={prop.propId || `${prop.gameId}-${prop.playerName}-${prop.type}`} href={`/game/${prop.gameId}`}>
                    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 hover:border-blue-500/40 transition-colors cursor-pointer">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-white">{prop.playerName}</span>
                            <span className="text-xs text-gray-500 uppercase">{prop.sport}</span>
                          </div>
                          <div className="text-sm text-gray-400 mt-0.5">
                            {prop.pick?.toUpperCase()} {prop.threshold} {(prop.type || '').replace(/_/g, ' ')}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {odds && (
                            <span className="text-sm text-amber-400 font-bold">{odds}</span>
                          )}
                          {prop.bookmaker && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-700 text-[10px] text-cyan-400 font-medium border border-slate-600">
                              {prop.bookmaker}
                            </span>
                          )}
                          <span className="text-sm font-bold text-green-400">
                            {((prop.probability || 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center">
              <p className="text-gray-500">No props available right now. Check back closer to game time.</p>
            </div>
          )}
        </section>

        {/* Transparent Results — Dynamic Validation Stats */}
        <section className="mb-16" id="results">
          <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-8 text-center">
            <h2 className="text-2xl font-bold text-white mb-4">A transparent record</h2>
            <p className="text-gray-400 max-w-xl mx-auto mb-8 leading-relaxed">
              After each game, we pull the real box score and grade every tracked prop.
              Wins, losses, and pushes are all public &mdash; filter by time window, sport,
              or whether you saved the pick yourself.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:gap-6 mb-4 max-w-md mx-auto">
              <div className="min-w-0">
                {statsLoading ? <StatSkeleton /> : (
                  <div className="text-2xl sm:text-3xl font-bold text-blue-400 truncate">
                    {validationStats?.total != null
                      ? validationStats.total.toLocaleString()
                      : '---'}
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-1">Tracked</div>
              </div>
              <div className="min-w-0">
                {statsLoading ? <StatSkeleton /> : (
                  <div className="text-2xl sm:text-3xl font-bold text-green-400 truncate">
                    {validationStats?.accuracy != null
                      ? `${(validationStats.accuracy * 100).toFixed(1)}%`
                      : '---'}
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-1">Hit Rate</div>
              </div>
            </div>
            {validationStats?.correct != null && validationStats?.total != null && (
              <p className="text-xs text-slate-500 mb-6">
                {validationStats.correct.toLocaleString()} correct of {(validationStats.total - (validationStats.pushes || 0)).toLocaleString()} resolved &middot; pushes excluded
              </p>
            )}
            <Link
              href="/validation"
              className="inline-flex items-center px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors text-sm"
            >
              See full record
            </Link>
          </div>
        </section>

        {/* Value Support */}
        <section className="mb-16">
          <div className="bg-gradient-to-r from-blue-900/20 via-slate-900/40 to-purple-900/20 border border-slate-700 rounded-xl p-6 sm:p-8">
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-3">A faster way to check the board</h2>
            <p className="text-gray-300 leading-relaxed max-w-3xl">
              Odds on Deck helps you scan prop lines side-by-side, spot better prices, track what
              you played, and learn from real outcomes. Instead of bouncing between books, you can
              review the market in one place &mdash; and come back to see how it played out.
            </p>
          </div>
        </section>

        {/* What Makes This Different */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-2">What this is for</h2>
          <p className="text-gray-400 mb-8">
            Most tools show you one book&apos;s odds. We show you <span className="text-white font-medium">all of them</span> &mdash; in one place, with the math already done.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              icon="&#128269;"
              title="Line Shopping"
              description="See odds from 10+ sportsbooks for the same prop, side-by-side. When one book has a better number than the rest, it&rsquo;s obvious at a glance."
            />
            <FeatureCard
              icon="&#128208;"
              title="Vig-Free Probabilities"
              description="We strip the sportsbook margin from every line so you can see the real market-implied probability &mdash; not what the book wants you to focus on."
            />
            <FeatureCard
              icon="&#127942;"
              title="Sortable Quality Score"
              description="A sorting aid that combines line deviation from the market consensus and the number of books offering each prop. Use it to surface unusual lines worth a closer look."
            />
            <FeatureCard
              icon="&#128202;"
              title="Full Transparency"
              description="Every prop we display is tracked against actual game results. Hit rate and record are updated automatically &mdash; no cherry-picked screenshots, no hidden losses."
            />
            <FeatureCard
              icon="&#127919;"
              title="Track &amp; Save"
              description="Save props or whole parlays to follow them through to the result. Come back tomorrow to see what hit and what missed."
            />
            <FeatureCard
              icon="&#127922;"
              title="Parlay Comparison"
              description="Build parlays using the best available number for each leg. See the combined odds and implied probability before you place anything."
            />
          </div>
        </section>

        {/* How It Works */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-8">How it works</h2>
          <div className="space-y-8">
            <StepCard
              number="1"
              title="We pull today's games from ESPN and league APIs"
              description="Every morning, we fetch the full slate — schedules, probable pitchers, matchup context — for MLB, NHL, and NFL."
            />
            <StepCard
              number="2"
              title="Live odds are pulled from 10+ sportsbooks"
              description="Moneylines, spreads, totals, and player prop markets are pulled in real time from The Odds API. You see what DraftKings, FanDuel, BetMGM, BetRivers, and others are posting &mdash; all in one place."
            />
            <StepCard
              number="3"
              title="We strip the vig and surface the comparison"
              description="For each line, we remove the sportsbook margin to reveal the real market-implied probability, then show you how each book&rsquo;s number compares to the consensus."
            />
            <StepCard
              number="4"
              title="Outlier lines are flagged for a closer look"
              description="Props where one book&rsquo;s price is meaningfully different from the rest of the market move to the top of the list. You decide whether they&rsquo;re worth tracking."
            />
            <StepCard
              number="5"
              title="Every tracked prop is graded after the game"
              description="When the box score is final, we pull official stats and grade every prop we surfaced. Hit rate and record are updated automatically &mdash; you can see what worked and what didn&rsquo;t over any time window."
            />
          </div>
        </section>

        {/* Key Concepts */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-2">Key concepts</h2>
          <p className="text-gray-400 mb-8">Understanding these terms will help you get the most out of the data.</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ConceptCard
              term="Edge"
              definition="The percentage difference between one book's implied probability and the vig-removed market consensus. A positive edge means that book is offering a better price than the rest of the market."
              example='Example: If the market consensus is 55% but one book implies only 48%, that book is paying more than the market thinks it should.'
            />
            <ConceptCard
              term="Implied Probability"
              definition="The break-even win rate embedded in the odds. American odds of -110 imply ~52.4% — you need to win more than that to profit long-term."
              example="Example: +150 odds imply 40% probability. If the true chance is 50%, that's a value bet."
            />
            <ConceptCard
              term="Vig (Juice)"
              definition="The sportsbook's built-in margin. Both sides of a bet add up to more than 100%. We strip the vig to see the true market probability."
              example="Example: -110 on both sides = ~104.8% total. The extra 4.8% is the book's cut."
            />
            <ConceptCard
              term="Quality Score"
              definition="A sorting aid (0-10) that combines line deviation from the market consensus, the number of books offering the prop, and the implied probability. Use it to bring unusual lines to the top &mdash; it&rsquo;s context, not a recommendation."
              example="Scores above 7 typically mean strong agreement across books and a meaningful gap from the consensus."
            />
            <ConceptCard
              term="Line Shopping"
              definition="Comparing the same bet across multiple sportsbooks to find the best price. A half-point or +10 in odds compounds over hundreds of bets."
              example="Player Over 2.5 hits might be -130 on DraftKings but -110 on BetRivers."
            />
            <ConceptCard
              term="Win Probability"
              definition="The market-implied chance the bet wins, derived from stripping the vig from the consensus line. This is what the collective market thinks, not a proprietary model."
            />
          </dl>
        </section>

        {/* How to Use */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-2">How to use this</h2>
          <p className="text-gray-400 mb-8">A simple workflow for getting value out of the data.</p>
          <div className="space-y-5">
            <div className="bg-gradient-to-r from-blue-900/20 to-transparent border border-blue-800/40 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-blue-400 mb-2">1. Compare lines across books</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Head to <span className="text-white">Player Props</span> to see every prop with its
                best available number, the bookmaker offering it, and how it compares to the rest
                of the market. This is the core utility &mdash; spotting where books disagree.
              </p>
            </div>
            <div className="bg-gradient-to-r from-cyan-900/20 to-transparent border border-cyan-800/40 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-cyan-400 mb-2">2. Check today&apos;s slate</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Browse <span className="text-white">Today&apos;s Slate</span> to see all games at a
                glance. Click into any game for moneyline comparison, probable pitchers, matchup
                context, and the props specific to that matchup.
              </p>
            </div>
            <div className="bg-gradient-to-r from-purple-900/20 to-transparent border border-purple-800/40 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-purple-400 mb-2">3. Save and track props</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Save individual props or build parlays you want to follow.
                We&apos;ll grade them after the game and add them to your record so you can see
                what hit and what missed over time.
              </p>
            </div>
            <div className="bg-gradient-to-r from-green-900/20 to-transparent border border-green-800/40 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-green-400 mb-2">4. Use Editor&apos;s Picks for context</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                <span className="text-white">Editor&apos;s Picks</span> is a curated shortlist of
                props worth a closer look based on current pricing and market context. Treat it as
                a starting point for your own research, not a recommendation list.
              </p>
            </div>
            <div className="bg-gradient-to-r from-amber-900/20 to-transparent border border-amber-800/40 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-amber-400 mb-2">5. Review the record</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Come back to <span className="text-white">Validation</span> to see how the lines we
                surface have performed over time &mdash; by sport, time window, and prop type.
                The record is fully public and built from every prop we&apos;ve tracked.
              </p>
            </div>
          </div>
        </section>

        {/* Quick Navigation */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-6 text-center">Jump in</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href="/props">
              <div className="bg-slate-800/50 border border-slate-700 hover:border-purple-500/60 rounded-xl p-6 transition cursor-pointer group text-center">
                <div className="text-3xl mb-2">&#128202;</div>
                <h3 className="text-lg font-bold mb-1 group-hover:text-purple-400 transition">Player Props</h3>
                <p className="text-slate-400 text-sm">Compare lines across books</p>
              </div>
            </Link>
            <Link href="/games">
              <div className="bg-slate-800/50 border border-slate-700 hover:border-cyan-500/60 rounded-xl p-6 transition cursor-pointer group text-center">
                <div className="text-3xl mb-2">&#128203;</div>
                <h3 className="text-lg font-bold mb-1 group-hover:text-cyan-400 transition">Today&apos;s Slate</h3>
                <p className="text-slate-400 text-sm">Full schedule and scores</p>
              </div>
            </Link>
            <Link href="/picks">
              <div className="bg-slate-800/50 border border-slate-700 hover:border-blue-500/60 rounded-xl p-6 transition cursor-pointer group text-center">
                <div className="text-3xl mb-2">&#127919;</div>
                <h3 className="text-lg font-bold mb-1 group-hover:text-blue-400 transition">Editor&apos;s Picks</h3>
                <p className="text-slate-400 text-sm">Curated props worth a closer look</p>
              </div>
            </Link>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white mb-4">Start comparing lines</h2>
          <p className="text-gray-400 mb-8">See today&apos;s props side-by-side across every major sportsbook.</p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/props"
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              Browse Player Props
            </Link>
            <Link
              href="/games"
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg border border-slate-700 transition-colors"
            >
              Today&apos;s Slate
            </Link>
            <Link
              href="/picks"
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg border border-slate-700 transition-colors"
            >
              Editor&apos;s Picks
            </Link>
          </div>
        </section>

      </div>
    </div>
  )
}
