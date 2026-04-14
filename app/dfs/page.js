import Link from 'next/link'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'DFS Optimizer — Coming Soon',
  description: 'Daily Fantasy Sports player value rankings and salary-based projections for MLB, NFL, and NHL. Coming soon to Odds on Deck.',
  openGraph: {
    title: 'DFS Optimizer — Coming Soon | Odds on Deck',
    description: 'DFS player value rankings and salary-based projections. Coming soon.',
  },
}

export default function DFSPage() {
  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        <div className="text-center">
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-amber-900/30 border border-amber-500/40 text-amber-400 text-xs font-semibold uppercase tracking-wide mb-6">
            Coming Soon
          </div>
          
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            DFS Optimizer
          </h1>
          <p className="text-lg text-gray-400 max-w-xl mx-auto leading-relaxed mb-10">
            We&apos;re building a daily fantasy optimizer that uses the same edge-detection engine 
            powering our props and picks. Player projections, salary-based value rankings, and 
            lineup suggestions — all backed by real data.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <div className="text-2xl mb-2">📊</div>
              <h3 className="text-sm font-semibold text-white mb-1">Value Rankings</h3>
              <p className="text-xs text-gray-500">Points per dollar across all salary tiers</p>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <div className="text-2xl mb-2">🎯</div>
              <h3 className="text-sm font-semibold text-white mb-1">Projection Engine</h3>
              <p className="text-xs text-gray-500">Matchup-driven projections for every player</p>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
              <div className="text-2xl mb-2">⚡</div>
              <h3 className="text-sm font-semibold text-white mb-1">Lineup Builder</h3>
              <p className="text-xs text-gray-500">Optimized lineups for DraftKings & FanDuel</p>
            </div>
          </div>

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
          </div>
        </div>
      </div>
    </div>
  )
}
