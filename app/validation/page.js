import Link from 'next/link'
import { Suspense } from 'react'
import { getValidationStats, getValidationRecords, getValidationCounts } from '../../lib/validation.js'
import CheckPropsButton from '../../components/CheckPropsButton.js'
import CompletedPropsTable from '../../components/CompletedPropsTable.js'
import TimeWindowFilter from '../../components/TimeWindowFilter.js'
import ROITooltip from '../../components/ROITooltip.js'

export const metadata = {
  title: 'Validation — Transparent Pick Tracking',
  description: 'Full transparency on every pick we make. Track win rates, ROI, and units profit/loss across MLB, NFL, and NHL props — updated in real time.',
  openGraph: {
    title: 'Validation — Transparent Pick Tracking | Odds on Deck',
    description: 'Full transparency on every pick. Track win rates, ROI, and units P/L in real time.',
  },
}

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const MIN_SAMPLE_SIZE = 10

function formatROI(roi) {
  const pct = roi * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function formatUnits(units) {
  if (typeof units !== 'number') return '—'
  const sign = units >= 0 ? '+' : ''
  return `${sign}${units.toFixed(2)}`
}

function windowLabel(window) {
  if (window === '7') return 'Last 7 Days'
  if (window === '30') return 'Last 30 Days'
  if (window === '90') return 'Last 90 Days'
  return 'All Time'
}

function sourceLabel(source) {
  if (source === 'user') return 'Your Picks'
  if (source === 'system') return 'System Tracked'
  return 'All Picks'
}

export default async function ValidationDashboard({ searchParams }) {
  const window = searchParams?.window || 'all'
  const sourceFilter = searchParams?.source || 'all'
  const days = window !== 'all' ? parseInt(window) : undefined

  const statsOpts = { days, minSample: MIN_SAMPLE_SIZE }
  if (sourceFilter === 'user') statsOpts.sourceGroup = 'user'
  else if (sourceFilter === 'system') statsOpts.sourceGroup = 'system'

  const [stats, recentRecords, validationCounts, nflStats, nhlStats, mlbStats] = await Promise.all([
    getValidationStats(statsOpts),
    getValidationRecords({ limit: 50 }),
    getValidationCounts(),
    getValidationStats({ ...statsOpts, sport: 'nfl' }),
    getValidationStats({ ...statsOpts, sport: 'nhl' }),
    getValidationStats({ ...statsOpts, sport: 'mlb' })
  ])

  const { counts, pendingBySport, sourceCounts } = validationCounts
  const completedRecords = recentRecords.filter(r => r.status === 'completed')

  const propTypeEntries = Object.entries(stats.byPropType)
    .sort((a, b) => b[1].total - a[1].total)

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <Link 
            href="/"
            className="inline-flex items-center text-sm font-medium text-blue-400 hover:text-blue-300 mb-4"
          >
            ← Back to Home
          </Link>
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              Validation Dashboard
            </h1>
            <p className="text-base sm:text-lg text-gray-400 mt-2">
              Every prediction tracked against real results
            </p>
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
              <CheckPropsButton />
              <Link
                href="/insights"
                className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors"
              >
                View Insights
              </Link>
            </div>
          </div>
        </div>

        {/* Time Window Filter */}
        <div className="mb-6 sm:mb-8">
          <Suspense fallback={null}>
            <TimeWindowFilter />
          </Suspense>
          <p className="text-center text-xs text-slate-500 mt-2">
            Showing: {windowLabel(window)} &middot; {sourceLabel(sourceFilter)}
          </p>
        </div>

        {/* Overall Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
          <div className="card p-4 sm:p-6">
            <div className="text-xs sm:text-sm font-medium text-gray-400">Predictions</div>
            <div className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-bold text-white">
              {stats.total.toLocaleString()}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {stats.correct.toLocaleString()}W – {stats.incorrect.toLocaleString()}L{stats.pushes > 0 && ` – ${stats.pushes}P`}
            </div>
          </div>
          
          <div className="bg-green-900/20 rounded-lg shadow p-4 sm:p-6 border-2 border-green-500/50">
            <div className="text-xs sm:text-sm font-medium text-green-400">Win Rate</div>
            <div className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-bold text-green-400">
              {stats.total > 0 ? `${(stats.accuracy * 100).toFixed(1)}%` : 'N/A'}
            </div>
            <div className="text-xs text-green-300/60 mt-1">
              {stats.correct} / {stats.correct + stats.incorrect} resolved
            </div>
          </div>
          
          <div className="bg-blue-900/20 rounded-lg shadow p-4 sm:p-6 border-2 border-blue-500/50">
            <div className="text-xs sm:text-sm font-medium text-blue-400">Avg Edge</div>
            <div className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-bold text-blue-400">
              {stats.total > 0 ? `${(stats.avgEdge * 100).toFixed(1)}%` : 'N/A'}
            </div>
          </div>
          
          <div className="bg-purple-900/20 rounded-lg shadow p-4 sm:p-6 border-2 border-purple-500/50">
            <div className="flex items-center text-xs sm:text-sm font-medium text-purple-400">
              ROI
              <ROITooltip />
            </div>
            <div className="mt-1 sm:mt-2 text-2xl sm:text-3xl font-bold text-purple-400">
              {stats.total > 0 ? formatROI(stats.roi) : 'N/A'}
            </div>
            <div className="text-xs text-purple-300/60 mt-1">
              {typeof stats.units === 'number' && (
                <>{formatUnits(stats.units)} units &middot; 1u flat</>
              )}
            </div>
          </div>
        </div>

        {/* Performance by Sport */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {nflStats.total > 0 && (
            <SportCard
              emoji="🏈"
              label="NFL"
              color="blue"
              stats={nflStats}
            />
          )}
          {nhlStats.total > 0 && (
            <SportCard
              emoji="🏒"
              label="NHL"
              color="cyan"
              stats={nhlStats}
            />
          )}
          {mlbStats.total > 0 && (
            <SportCard
              emoji="⚾"
              label="MLB"
              color="green"
              stats={mlbStats}
            />
          )}
        </div>

        {/* Performance by Prop Type */}
        {propTypeEntries.length > 0 && (
          <div className="card p-6 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <h3 className="text-lg font-semibold text-white">Performance by Prop Type</h3>
              <span className="text-xs text-slate-500">
                Minimum {MIN_SAMPLE_SIZE} bets to display
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-700">
                <thead className="bg-slate-900">
                  <tr>
                    <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Prop Type</th>
                    <th className="px-4 sm:px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Record</th>
                    <th className="px-4 sm:px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Win Rate</th>
                    <th className="px-4 sm:px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">Avg Implied</th>
                    <th className="px-4 sm:px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">ROI</th>
                    <th className="px-4 sm:px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Units</th>
                  </tr>
                </thead>
                <tbody className="bg-slate-800 divide-y divide-slate-700">
                  {propTypeEntries.map(([propType, propStats]) => (
                    <tr key={propType} className="hover:bg-slate-700/50">
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                        {propType.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-center text-gray-400">
                        {propStats.correct}–{propStats.incorrect}{propStats.pushes > 0 && `–${propStats.pushes}`}
                        <span className="text-gray-600 ml-1">({propStats.total})</span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-center">
                        <span className={`font-semibold ${propStats.accuracy >= 0.55 ? 'text-green-400' : propStats.accuracy >= 0.50 ? 'text-blue-400' : 'text-red-400'}`}>
                          {(propStats.accuracy * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-center text-gray-400 hidden sm:table-cell">
                        {typeof propStats.avgImplied === 'number'
                          ? `${(propStats.avgImplied * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-center">
                        <span className={`font-semibold ${propStats.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatROI(propStats.roi)}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-center">
                        <span className={`font-semibold ${propStats.units >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatUnits(propStats.units)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Status & Source Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Completed</span>
                <span className="font-bold text-green-400">{counts.completed.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Pending</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-yellow-400">{counts.pending}</span>
                  {counts.pending > 0 && (
                    <span className="text-xs text-gray-500">
                      ({[
                        pendingBySport.mlb > 0 && `${pendingBySport.mlb} MLB`,
                        pendingBySport.nhl > 0 && `${pendingBySport.nhl} NHL`,
                        pendingBySport.nfl > 0 && `${pendingBySport.nfl} NFL`
                      ].filter(Boolean).join(', ')})
                    </span>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Needs Review</span>
                <span className="font-bold text-blue-400">{counts.needs_review}</span>
              </div>
              {counts.manual_closed > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Manually Closed</span>
                  <span className="font-bold text-gray-500">{counts.manual_closed}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-3 border-t border-slate-700">
                <span className="font-semibold text-white">Total Tracked</span>
                <span className="font-bold text-white">{counts.total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Source Tracking</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Individual Props</span>
                <span className="font-bold text-blue-400">{sourceCounts.user_saved}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Saved Parlays</span>
                <span className="font-bold text-purple-400">{sourceCounts.parlay_leg}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Auto-Generated</span>
                <span className="font-bold text-gray-400">{sourceCounts.system_generated}</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-slate-700">
                <span className="font-semibold text-white">Your Saved Picks</span>
                <span className="font-bold text-green-400">{sourceCounts.user_saved + sourceCounts.parlay_leg}</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-700 text-xs text-gray-500">
              &ldquo;Saved Parlays&rdquo; = legs from parlays you saved. &ldquo;Auto-Generated&rdquo; = system-tracked for accuracy analysis.
            </div>
          </div>
        </div>

        {/* Recent Predictions */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Recent Predictions</h3>
          
          {recentRecords.length > 0 ? (
            <div className="space-y-3">
              {recentRecords.slice(0, 20).map((record) => (
                <div key={record.id} className="border border-slate-700 rounded-lg p-4 bg-slate-900">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-white">
                          {record.playerName}
                        </span>
                        <span className="text-sm text-gray-400">
                          &middot; {record.propType.replace(/_/g, ' ')}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          record.status === 'pending' ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-500/50' :
                          record.status === 'needs_review' ? 'bg-blue-900/30 text-blue-400 border border-blue-500/50' :
                          record.result === 'correct' ? 'bg-green-900/30 text-green-400 border border-green-500/50' :
                          record.result === 'push' ? 'bg-slate-700 text-gray-400 border border-slate-600' :
                          'bg-red-900/30 text-red-400 border border-red-500/50'
                        }`}>
                          {record.status === 'pending' ? 'Pending' : 
                           record.status === 'needs_review' ? 'Needs Review' :
                           record.result}
                        </span>
                      </div>
                      <div className="text-sm text-gray-400 mt-1">
                        {record.prediction.toUpperCase()} {record.threshold} 
                        {record.actualValue !== null && ` · Actual: ${record.actualValue.toFixed(1)}`}
                        {record.projectedValue && ` · Proj: ${record.projectedValue.toFixed(1)}`}
                      </div>
                      <div className="flex flex-wrap gap-3 sm:gap-4 mt-2 text-xs text-gray-500">
                        {record.edge > 0 && <span>Edge: {(record.edge * 100).toFixed(1)}%</span>}
                        <span>Win Prob: {((record.probability || 0.5) * 100).toFixed(1)}%</span>
                        {record.qualityScore > 0 && <span>Quality: {record.qualityScore.toFixed(1)}</span>}
                        <span className="capitalize">{(record.source || 'system_generated').replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="text-gray-500 text-5xl mb-4">📊</div>
              <h3 className="text-lg font-medium text-white mb-2">No Validation Records Yet</h3>
              <p className="text-gray-400">
                Save some parlays or generate props to start tracking accuracy.
              </p>
            </div>
          )}
        </div>

        {/* Completed Props History */}
        {completedRecords.length > 0 && (
          <CompletedPropsTable records={completedRecords} />
        )}

        {/* How Validation Works */}
        <div className="mt-8 p-5 bg-slate-900/60 border border-slate-700 rounded-xl">
          <h4 className="font-semibold text-white mb-3">How Validation Works</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm text-gray-400">
            <div><span className="text-white font-medium">Win Rate</span> — Correct predictions / total resolved (excludes pushes)</div>
            <div><span className="text-white font-medium">ROI</span> — Total units profit or loss / total resolved bets, using recorded odds (1 unit flat per bet)</div>
            <div><span className="text-white font-medium">Units</span> — Cumulative profit/loss if betting 1 unit on every pick</div>
            <div><span className="text-white font-medium">Min Sample</span> — Prop type breakdown requires at least {MIN_SAMPLE_SIZE} resolved bets to appear</div>
            <div><span className="text-white font-medium">System Generated</span> — Auto-tracked props for model accuracy measurement</div>
            <div><span className="text-white font-medium">User Saved</span> — Props you explicitly saved or included in parlays</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SportCard({ emoji, label, color, stats }) {
  const borderColor = color === 'blue' ? 'border-blue-500' : color === 'cyan' ? 'border-cyan-500' : 'border-green-500'
  const textColor = color === 'blue' ? 'text-blue-400' : color === 'cyan' ? 'text-cyan-400' : 'text-green-400'

  return (
    <div className={`card p-6 border-l-4 ${borderColor}`}>
      <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
        {emoji} {label}
      </h3>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-400">Record</span>
          <span className="text-white font-medium">
            {stats.correct}–{stats.incorrect}{stats.pushes > 0 && `–${stats.pushes}`}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-400">Win Rate</span>
          <span className={`font-bold ${stats.accuracy >= 0.50 ? 'text-green-400' : 'text-red-400'}`}>
            {(stats.accuracy * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-400">ROI</span>
          <span className={`font-bold ${stats.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatROI(stats.roi)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-400">Units</span>
          <span className={`font-bold ${stats.units >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatUnits(stats.units)}
          </span>
        </div>
      </div>
    </div>
  )
}
