import Link from 'next/link'

export const metadata = {
  title: 'About - Odds on Deck',
  description: 'How Odds on Deck finds betting edges using real-time odds, line shopping, and validated analytics across MLB, NHL, and NFL.',
}

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

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">

        {/* Hero */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-4 tracking-tight">
            Odds on Deck
          </h1>
          <p className="text-xl text-blue-400 font-medium mb-6">
            Data-driven sports betting analytics
          </p>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg leading-relaxed">
            We scan odds from every major sportsbook in real time, identify where the lines are off, 
            and surface the bets where you have a mathematical edge. No gut feelings, no hype 
            &mdash; just numbers.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-8">
            <span className="px-4 py-1.5 rounded-full bg-green-900/30 border border-green-500/40 text-green-400 text-sm font-medium">MLB</span>
            <span className="px-4 py-1.5 rounded-full bg-cyan-900/30 border border-cyan-500/40 text-cyan-400 text-sm font-medium">NHL</span>
            <span className="px-4 py-1.5 rounded-full bg-blue-900/30 border border-blue-500/40 text-blue-400 text-sm font-medium">NFL</span>
          </div>
        </div>

        {/* What Makes This Different */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-2">What makes this different</h2>
          <p className="text-gray-400 mb-8">
            Most tools show you odds. We show you where the odds are <span className="text-white font-medium">wrong</span>.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              icon="🔍"
              title="Line Shopping Engine"
              description="We compare odds across 10+ sportsbooks simultaneously. When one book posts a line that's out of step with the market, we flag it as an opportunity."
            />
            <FeatureCard
              icon="📐"
              title="Edge Detection"
              description="Every prop is analyzed for its implied probability vs. the true market probability. Positive edge means the payout exceeds the actual risk."
            />
            <FeatureCard
              icon="🏆"
              title="Quality Scoring"
              description="Not all edges are equal. Our quality score weighs edge size, book count, line consensus, and market confidence into a single actionable number."
            />
            <FeatureCard
              icon="📊"
              title="Validated Track Record"
              description="We track every prediction against actual results. Our validation system shows real win rates and ROI — no cherry-picked screenshots."
            />
            <FeatureCard
              icon="🎯"
              title="Strategy Filters"
              description="Filter props by betting strategy — sharp value, high confidence, balanced approach, or long shots. Match the data to your style."
            />
            <FeatureCard
              icon="🎲"
              title="Parlay Generator"
              description="Build parlays from our highest-quality props with correlated picks and calculated combined odds. See exactly what you're betting on."
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
              title="The engine calculates edges and quality scores"
              description="For each prop, we remove the vig, calculate the true implied probability from the market consensus, and compare it to each book's posted line. The difference is your edge."
            />
            <StepCard
              number="4"
              title="Top picks surface to the top"
              description="Props are ranked by quality score — a composite of edge size, number of supporting books, and market agreement. The best opportunities appear first."
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
              definition="The percentage difference between the true probability and what the sportsbook is offering. A positive edge means the bet pays more than it should."
              example='Example: If the true probability is 55% but the book implies 48%, you have a +7% edge.'
            />
            <ConceptCard
              term="Implied Probability"
              definition="The break-even win rate embedded in the odds. American odds of -110 imply ~52.4% — you need to win more than that to profit long-term."
              example="Example: +150 odds imply 40% probability. If the true chance is 50%, that&apos;s a value bet."
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
              definition="Our estimated chance the bet wins, derived from the vig-removed market consensus. Higher probability = more likely to hit, but usually lower payout."
            />
          </dl>
        </section>

        {/* How to Use It */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-2">How to use this</h2>
          <p className="text-gray-400 mb-8">A few approaches depending on your style.</p>

          <div className="space-y-6">
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

        {/* The Validation Promise */}
        <section className="mb-16">
          <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-8 text-center">
            <h2 className="text-2xl font-bold text-white mb-4">Transparent results</h2>
            <p className="text-gray-400 max-w-xl mx-auto mb-6 leading-relaxed">
              Every prop we surface gets tracked. After the game ends, we pull the actual stats 
              and record whether the prediction hit or missed. No hiding bad picks.
            </p>
            <div className="flex flex-wrap justify-center gap-8 mb-6">
              <div>
                <div className="text-3xl font-bold text-green-400">64%</div>
                <div className="text-xs text-gray-500 mt-1">Overall Win Rate</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-blue-400">4,600+</div>
                <div className="text-xs text-gray-500 mt-1">Props Tracked</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-purple-400">3</div>
                <div className="text-xs text-gray-500 mt-1">Sports Covered</div>
              </div>
            </div>
            <Link
              href="/validation"
              className="inline-flex items-center px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors text-sm"
            >
              View Full Validation Dashboard
            </Link>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Ready to find your edge?</h2>
          <p className="text-gray-400 mb-8">Check today&apos;s best opportunities.</p>
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
