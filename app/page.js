'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'

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

export default function HomePage() {
  const [games, setGames] = useState({ mlb: [], nfl: [], nhl: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [todayStr, setTodayStr] = useState('')
  const [validationStats, setValidationStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)

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

    fetchGames()
    fetchStats()
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
            Compare odds. Spot value. Track everything.
          </p>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg leading-relaxed">
            We pull live odds from 10+ sportsbooks, strip the vig so you can see the real market
            prices, and highlight where one book&apos;s line stands out from the rest.
            Every pick gets tracked against actual results &mdash; full transparency, no hidden losses.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            <span className="px-4 py-1.5 rounded-full bg-green-900/30 border border-green-500/40 text-green-400 text-sm font-medium">MLB</span>
            <span className="px-4 py-1.5 rounded-full bg-cyan-900/30 border border-cyan-500/40 text-cyan-400 text-sm font-medium">NHL</span>
            <span className="px-4 py-1.5 rounded-full bg-blue-900/30 border border-blue-500/40 text-blue-400 text-sm font-medium">NFL</span>
          </div>
          <p className="text-slate-500 text-sm mt-4">{todayStr}</p>
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

        {/* Transparent Results — Dynamic Validation Stats */}
        <section className="mb-16" id="results">
          <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-8 text-center">
            <h2 className="text-2xl font-bold text-white mb-4">Every pick tracked, win or lose</h2>
            <p className="text-gray-400 max-w-xl mx-auto mb-8 leading-relaxed">
              After each game, we pull the real box score and check every tracked prop.
              Wins, losses, and ROI are all public &mdash; filter by time window, sport, or source on the dashboard.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 mb-8">
              <div className="min-w-0">
                {statsLoading ? <StatSkeleton /> : (
                  <div className="text-2xl sm:text-3xl font-bold text-green-400 truncate">
                    {validationStats?.accuracy != null
                      ? `${(validationStats.accuracy * 100).toFixed(1)}%`
                      : '---'}
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-1">Win Rate</div>
              </div>
              <div className="min-w-0">
                {statsLoading ? <StatSkeleton /> : (
                  <div className="text-2xl sm:text-3xl font-bold text-blue-400 truncate">
                    {validationStats?.total != null
                      ? validationStats.total.toLocaleString()
                      : '---'}
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-1">Props Tracked</div>
              </div>
              <div className="min-w-0">
                {statsLoading ? <StatSkeleton /> : (
                  <div className="text-2xl sm:text-3xl font-bold text-purple-400 truncate">
                    {validationStats?.roi != null
                      ? `${validationStats.roi > 0 ? '+' : ''}${(validationStats.roi * 100).toFixed(0)}%`
                      : '---'}
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-1">ROI</div>
              </div>
              <div className="min-w-0">
                {statsLoading ? <StatSkeleton /> : (
                  <div className="text-2xl sm:text-3xl font-bold text-amber-400 truncate">
                    {validationStats?.units != null
                      ? `${validationStats.units > 0 ? '+' : ''}${validationStats.units.toFixed(0)}u`
                      : '---'}
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-1">Units P/L</div>
              </div>
            </div>
            {validationStats?.correct != null && validationStats?.total != null && (
              <p className="text-xs text-slate-500 mb-4">
                Based on {validationStats.correct} correct out of {validationStats.total - (validationStats.pushes || 0)} resolved predictions (excludes pushes) &middot; 1 unit flat per bet
              </p>
            )}
            <Link
              href="/validation"
              className="inline-flex items-center px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors text-sm"
            >
              View Full Validation Dashboard
            </Link>
          </div>
        </section>

        {/* What Makes This Different */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-2">What makes this different</h2>
          <p className="text-gray-400 mb-8">
            Most tools show you one book&apos;s odds. We show you <span className="text-white font-medium">all of them</span> &mdash; and do the math for you.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              icon="&#128269;"
              title="Line Shopping"
              description="Compare odds across 10+ sportsbooks side-by-side. When one book is offering a better price than the rest, you'll see it instantly."
            />
            <FeatureCard
              icon="&#128208;"
              title="Vig-Free Probabilities"
              description="We strip the sportsbook margin from every line to show you the real market-implied probability. See what the odds actually mean, not what the book wants you to think."
            />
            <FeatureCard
              icon="&#127942;"
              title="Quality Scoring"
              description="Props are ranked by a composite of how far a line deviates from market consensus, how many books offer it, and the implied probability. Higher score = bigger outlier."
            />
            <FeatureCard
              icon="&#128202;"
              title="Full Transparency"
              description="Every pick is tracked against actual game results. Win rates, ROI, and units are updated automatically — no cherry-picked screenshots, no hiding bad days."
            />
            <FeatureCard
              icon="&#127919;"
              title="Strategy Filters"
              description="Filter by confidence level, value tier, or sport. Whether you want conservative singles or aggressive long shots, sort the board to match your style."
            />
            <FeatureCard
              icon="&#127922;"
              title="Parlay Builder"
              description="Combine props into parlays with calculated combined odds. See the implied probability of the full parlay before you bet."
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
              description="Every morning, we fetch the full slate — schedules, probable pitchers, matchup data — for MLB, NHL, and NFL."
            />
            <StepCard
              number="2"
              title="Live odds are scraped from 10+ sportsbooks"
              description="Moneylines, spreads, totals, and 10+ player prop markets are pulled from The Odds API. We see what DraftKings, FanDuel, BetMGM, BetRivers, and others are posting."
            />
            <StepCard
              number="3"
              title="We strip the vig and compare every line"
              description="For each prop, we remove the sportsbook margin to reveal the true market-implied probability. Then we compare each book's line against the consensus to find outliers."
            />
            <StepCard
              number="4"
              title="Outlier lines surface to the top"
              description="Props are ranked by how far a book's price deviates from the market consensus, weighted by the number of books offering the line and market agreement."
            />
            <StepCard
              number="5"
              title="Results are validated against actual stats"
              description="After games finish, we pull box scores from official league APIs and check every prediction. Win rate, ROI, and units are tracked over time with full transparency."
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
              definition="Our composite metric (0-10) that combines edge size, number of books offering the line, market consensus, and implied probability. Higher is better."
              example="Scores above 7 indicate strong agreement across books with meaningful edge."
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
          <p className="text-gray-400 mb-8">A few approaches depending on your style.</p>
          <div className="space-y-5">
            <div className="bg-gradient-to-r from-green-900/20 to-transparent border border-green-800/40 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-green-400 mb-2">Conservative: High-Confidence Singles</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Go to <span className="text-white">Player Props</span> and filter by <span className="text-white">High Confidence</span>.
                These are props where multiple books agree on the line and the edge is moderate but consistent.
                Place straight bets on the top 3-5 picks. Win rate tends to be highest here.
              </p>
            </div>
            <div className="bg-gradient-to-r from-blue-900/20 to-transparent border border-blue-800/40 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-blue-400 mb-2">Balanced: Quality Score Ranking</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Use the default <span className="text-white">Best Value</span> sort on the Props page.
                This balances edge and confidence. The top 10 props by quality score represent the best
                risk-adjusted opportunities on the board. Mix singles and small parlays.
              </p>
            </div>
            <div className="bg-gradient-to-r from-purple-900/20 to-transparent border border-purple-800/40 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-purple-400 mb-2">Aggressive: Sharp Value Hunting</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Filter by <span className="text-white">Sharp Value</span> to find props with the largest edges.
                These may have lower win probability but the payout more than compensates.
                Use the <span className="text-white">Parlay Generator</span> to combine 2-3 of these for bigger payouts.
                Expect more losses but larger wins.
              </p>
            </div>
            <div className="bg-gradient-to-r from-amber-900/20 to-transparent border border-amber-800/40 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-amber-400 mb-2">Research: Game Detail Pages</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Click into any game on <span className="text-white">Today&apos;s Slate</span> to see moneyline edges,
                probable pitchers, player props for that matchup, and box scores for completed games.
                Use this to validate your own analysis before placing bets.
              </p>
            </div>
          </div>
        </section>

        {/* Quick Navigation */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-6 text-center">Jump in</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href="/picks">
              <div className="bg-slate-800/50 border border-slate-700 hover:border-blue-500/60 rounded-xl p-6 transition cursor-pointer group text-center">
                <div className="text-3xl mb-2">&#127919;</div>
                <h3 className="text-lg font-bold mb-1 group-hover:text-blue-400 transition">Editor&apos;s Picks</h3>
                <p className="text-slate-400 text-sm">Top recommended plays</p>
              </div>
            </Link>
            <Link href="/props">
              <div className="bg-slate-800/50 border border-slate-700 hover:border-purple-500/60 rounded-xl p-6 transition cursor-pointer group text-center">
                <div className="text-3xl mb-2">&#128202;</div>
                <h3 className="text-lg font-bold mb-1 group-hover:text-purple-400 transition">Player Props</h3>
                <p className="text-slate-400 text-sm">Detailed prop analysis</p>
              </div>
            </Link>
            <Link href="/games">
              <div className="bg-slate-800/50 border border-slate-700 hover:border-cyan-500/60 rounded-xl p-6 transition cursor-pointer group text-center">
                <div className="text-3xl mb-2">&#128203;</div>
                <h3 className="text-lg font-bold mb-1 group-hover:text-cyan-400 transition">Today&apos;s Slate</h3>
                <p className="text-slate-400 text-sm">Full game schedule + scores</p>
              </div>
            </Link>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white mb-4">See today&apos;s best lines</h2>
          <p className="text-gray-400 mb-8">Compare odds across every major book and find the best price.</p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/props"
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              Browse Player Props
            </Link>
            <Link
              href="/picks"
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg border border-slate-700 transition-colors"
            >
              See Editor&apos;s Picks
            </Link>
            <Link
              href="/games"
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg border border-slate-700 transition-colors"
            >
              Today&apos;s Slate
            </Link>
          </div>
        </section>

      </div>
    </div>
  )
}
