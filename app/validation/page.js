import Link from 'next/link'
import { Suspense } from 'react'
import { getValidationStats, getValidationRecords, getValidationCounts } from '../../lib/validation.js'
import CheckPropsButton from '../../components/CheckPropsButton.js'
import CompletedPropsTable from '../../components/CompletedPropsTable.js'
import TimeWindowFilter from '../../components/TimeWindowFilter.js'
import MethodologyPanel from '../../components/MethodologyPanel.js'
import { SportBadge } from '../../components/ui'

export const metadata = {
  title: 'Validation — Transparent Record',
  description: 'A transparent record of every pick we track — wins, losses, and pushes across MLB, NFL, and NHL props.',
  openGraph: {
    title: 'Validation — Transparent Record | Odds on Deck',
    description: 'A transparent record of every pick we track. See what hit and what missed.',
  },
}

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

// Min sample size to show a prop type breakdown (raised to reduce small-sample noise)
const MIN_SAMPLE_SIZE = 25
// Sample size below which we visually flag results as low-confidence
const LOW_CONFIDENCE_SAMPLE = 50
// ROI absolute value above which we show a small-sample caveat
const ROI_OUTLIER_THRESHOLD = 1.0 // 100%

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

function isLowSample(total) {
  return total < LOW_CONFIDENCE_SAMPLE
}

function isOutlierROI(roi, total) {
  return Math.abs(roi) > ROI_OUTLIER_THRESHOLD && total < LOW_CONFIDENCE_SAMPLE
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

const TH_CLASS = 'px-4 sm:px-6 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider'

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
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300 transition-colors duration-100 mb-3"
        >
          ← Home
        </Link>
        <h1 className="text-xl font-semibold text-slate-100">Transparent Record</h1>
        <p className="text-sm text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
          An honest, ongoing record of every prop we track &mdash; wins, losses, and pushes.
          No filters. No cherry-picking.
        </p>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <CheckPropsButton />
          <Link
            href="/insights"
            className="inline-flex items-center justify-center px-3 py-2 bg-surface hover:bg-elevated text-slate-200 text-sm font-medium rounded-[4px] border border-white/[0.06] transition-colors duration-100"
          >
            View Insights
          </Link>
        </div>
      </div>

      {/* Time Window Filter */}
      <div>
        <Suspense fallback={null}>
          <TimeWindowFilter />
        </Suspense>
        <p className="text-[11px] text-slate-500 mt-2">
          Showing: {windowLabel(window)} &middot; {sourceLabel(sourceFilter)}
        </p>
      </div>

      {/* Primary Stats — Tracked + Hit Rate (dominant) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className="rounded-[4px] border border-white/[0.06] bg-surface p-5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-widest">Tracked Predictions</div>
          <div className="mt-2 text-3xl sm:text-4xl font-semibold text-slate-100 tabular-nums font-mono">
            {stats.total.toLocaleString()}
          </div>
          <div className="text-sm text-slate-500 mt-2 tabular-nums font-mono">
            {stats.correct.toLocaleString()} won &middot; {stats.incorrect.toLocaleString()} lost
            {stats.pushes > 0 && ` · ${stats.pushes} push`}
          </div>
        </div>

        <div className="rounded-[4px] border border-green-500/20 bg-green-500/[0.06] p-5">
          <div className="text-[11px] font-medium text-green-400 uppercase tracking-widest">Hit Rate</div>
          <div className="mt-2 text-3xl sm:text-4xl font-semibold text-green-400 tabular-nums font-mono">
            {stats.total > 0 ? `${(stats.accuracy * 100).toFixed(1)}%` : 'N/A'}
          </div>
          <div className="text-sm text-green-300/60 mt-2 tabular-nums font-mono">
            {stats.correct.toLocaleString()} of {(stats.correct + stats.incorrect).toLocaleString()} resolved
          </div>
        </div>
      </div>

      {/* Secondary Stats — ROI + Avg Implied (supporting context) */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Avg Edge vs Market
          </div>
          <div className="mt-1 text-lg sm:text-xl font-semibold text-blue-400 tabular-nums font-mono">
            {stats.total > 0 ? `${(stats.avgEdge * 100).toFixed(1)}%` : '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            avg line difference vs consensus
          </div>
        </div>

        <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
            Units P/L &middot; ROI
          </div>
          <div className="mt-1 text-lg sm:text-xl font-semibold tabular-nums font-mono">
            <span className={typeof stats.units === 'number' && stats.units >= 0 ? 'text-green-400' : 'text-red-400'}>
              {typeof stats.units === 'number' ? formatUnits(stats.units) : '—'}u
            </span>
            <span className="text-sm text-slate-500 ml-2">
              ({stats.total > 0 ? formatROI(stats.roi) : '—'})
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            1-unit flat per pick &middot; pushes excluded
          </div>
        </div>
      </div>

      {/* Methodology panel — explains how we track and grade */}
      <MethodologyPanel minSampleSize={MIN_SAMPLE_SIZE} />

      {/* Performance by Sport */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {nflStats.total > 0 && <SportCard sport="nfl" stats={nflStats} />}
        {nhlStats.total > 0 && <SportCard sport="nhl" stats={nhlStats} />}
        {mlbStats.total > 0 && <SportCard sport="mlb" stats={mlbStats} />}
      </div>

      {/* Performance by Prop Type */}
      {propTypeEntries.length > 0 && (
        <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Record by Prop Type</h3>
            <span className="text-[11px] text-slate-500">
              Showing prop types with at least {MIN_SAMPLE_SIZE} resolved bets
            </span>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed mb-4">
            See how different prop types have performed over time. Use this table to compare
            hit rate, volume, and results by market &mdash; smaller samples can swing more
            sharply, so larger tracked groups usually tell the clearer story.
          </p>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full">
              <thead className="bg-bg border-y border-white/[0.06]">
                <tr>
                  <th className={`${TH_CLASS} text-left`}>Prop Type</th>
                  <th className={`${TH_CLASS} text-center`}>Record</th>
                  <th className={`${TH_CLASS} text-center`}>Hit Rate</th>
                  <th className={`${TH_CLASS} text-center hidden sm:table-cell`}>Avg Implied</th>
                  <th className={`${TH_CLASS} text-center`}>ROI</th>
                  <th className={`${TH_CLASS} text-center`}>Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {propTypeEntries.map(([propType, propStats]) => {
                  const lowSample = isLowSample(propStats.total)
                  const outlierROI = isOutlierROI(propStats.roi, propStats.total)
                  return (
                    <tr key={propType} className="hover:bg-elevated transition-colors duration-100">
                      <td className="px-4 sm:px-6 py-3 whitespace-nowrap text-sm font-medium text-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="capitalize">{propType.replace(/_/g, ' ')}</span>
                          {lowSample && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-[3px] bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              title="Sample size below 50 — results may vary as more data comes in"
                            >
                              small sample
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 sm:px-6 py-3 whitespace-nowrap text-sm text-center text-slate-400 tabular-nums font-mono">
                        {propStats.correct}–{propStats.incorrect}{propStats.pushes > 0 && `–${propStats.pushes}`}
                        <span className="text-slate-600 ml-1">({propStats.total})</span>
                      </td>
                      <td className="px-4 sm:px-6 py-3 whitespace-nowrap text-sm text-center">
                        <span className={`font-semibold tabular-nums font-mono ${
                          lowSample ? 'text-slate-400' :
                          propStats.accuracy >= 0.55 ? 'text-green-400' :
                          propStats.accuracy >= 0.50 ? 'text-blue-400' : 'text-red-400'
                        }`}>
                          {(propStats.accuracy * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-3 whitespace-nowrap text-sm text-center text-slate-400 tabular-nums font-mono hidden sm:table-cell">
                        {typeof propStats.avgImplied === 'number'
                          ? `${(propStats.avgImplied * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                      <td className="px-4 sm:px-6 py-3 whitespace-nowrap text-sm text-center">
                        <span
                          className={`font-semibold tabular-nums font-mono ${
                            outlierROI ? 'text-slate-500' :
                            propStats.roi >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}
                          title={outlierROI ? 'Extreme ROI from small sample — interpret with caution' : undefined}
                        >
                          {formatROI(propStats.roi)}
                          {outlierROI && (
                            <span className="ml-1 text-[10px] text-amber-500/80">!</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-3 whitespace-nowrap text-sm text-center">
                        <span className={`font-semibold tabular-nums font-mono ${
                          outlierROI ? 'text-slate-500' :
                          propStats.units >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {formatUnits(propStats.units)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 mt-3">
            Rows marked &ldquo;small sample&rdquo; have between {MIN_SAMPLE_SIZE} and {LOW_CONFIDENCE_SAMPLE - 1} resolved bets.
            Hit rate and ROI for these will fluctuate as we collect more data.
          </p>
        </div>
      )}

      {/* Status & Source Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4 sm:p-6">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-4">Status</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Completed</span>
              <span className="font-semibold text-green-400 tabular-nums font-mono">{counts.completed.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Pending</span>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-amber-400 tabular-nums font-mono">{counts.pending}</span>
                {counts.pending > 0 && (
                  <span className="text-[11px] text-slate-500">
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
              <span className="text-slate-400">Needs Review</span>
              <span className="font-semibold text-blue-400 tabular-nums font-mono">{counts.needs_review}</span>
            </div>
            {counts.manual_closed > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Manually Closed</span>
                <span className="font-semibold text-slate-500 tabular-nums font-mono">{counts.manual_closed}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-3 border-t border-white/[0.06]">
              <span className="font-semibold text-slate-200">Total Tracked</span>
              <span className="font-semibold text-slate-100 tabular-nums font-mono">{counts.total.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4 sm:p-6">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-4">Source Tracking</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Individual Props</span>
              <span className="font-semibold text-blue-400 tabular-nums font-mono">{sourceCounts.user_saved}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Saved Parlays</span>
              <span className="font-semibold text-slate-300 tabular-nums font-mono">{sourceCounts.parlay_leg}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Auto-Generated</span>
              <span className="font-semibold text-slate-400 tabular-nums font-mono">{sourceCounts.system_generated}</span>
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-white/[0.06]">
              <span className="font-semibold text-slate-200">Your Saved Picks</span>
              <span className="font-semibold text-green-400 tabular-nums font-mono">{sourceCounts.user_saved + sourceCounts.parlay_leg}</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/[0.06] text-[11px] text-slate-500 leading-relaxed">
            &ldquo;Saved Parlays&rdquo; = legs from parlays you saved. &ldquo;Auto-Generated&rdquo; = system-tracked for accuracy analysis.
          </div>
        </div>
      </div>

      {/* Recent Predictions */}
      <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4 sm:p-6">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-4">Recent Tracked Predictions</h3>

        {recentRecords.length > 0 ? (
          <div className="rounded-[4px] border border-white/[0.06] divide-y divide-white/[0.06] overflow-hidden">
            {recentRecords.slice(0, 20).map((record) => (
              <div key={record.id} className="p-3 sm:p-4 bg-bg hover:bg-elevated transition-colors duration-100">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-100">
                    {record.playerName}
                  </span>
                  <span className="text-sm text-slate-400 capitalize">
                    &middot; {record.propType.replace(/_/g, ' ')}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide border ${
                    record.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                    record.status === 'needs_review' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                    record.result === 'correct' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                    record.result === 'push' ? 'bg-white/[0.05] text-slate-400 border-white/[0.06]' :
                    'bg-red-500/10 text-red-400 border-red-500/20'
                  }`}>
                    {record.status === 'pending' ? 'Pending' :
                     record.status === 'needs_review' ? 'Needs Review' :
                     record.result}
                  </span>
                </div>
                <div className="text-sm text-slate-400 mt-1 tabular-nums font-mono">
                  {record.prediction.toUpperCase()} {record.threshold}
                  {record.actualValue !== null && ` · Actual: ${record.actualValue.toFixed(1)}`}
                  {record.projectedValue && ` · Proj: ${record.projectedValue.toFixed(1)}`}
                </div>
                <div className="flex flex-wrap gap-3 sm:gap-4 mt-2 text-[11px] text-slate-500 tabular-nums font-mono">
                  {record.edge > 0 && <span>Edge: {(record.edge * 100).toFixed(1)}%</span>}
                  <span>Win Prob: {((record.probability || 0.5) * 100).toFixed(1)}%</span>
                  {record.qualityScore > 0 && <span>Quality: {record.qualityScore.toFixed(1)}</span>}
                  <span className="capitalize font-sans">{(record.source || 'system_generated').replace(/_/g, ' ')}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <h3 className="text-sm font-medium text-slate-200 mb-1">No validation records yet</h3>
            <p className="text-sm text-slate-500">
              Save some parlays or generate props to start tracking accuracy.
            </p>
          </div>
        )}
      </div>

      {/* Completed Props History */}
      {completedRecords.length > 0 && (
        <CompletedPropsTable records={completedRecords} />
      )}
    </div>
  )
}

function SportCard({ sport, stats }) {
  return (
    <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <SportBadge sport={sport} />
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Record</h3>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Record</span>
          <span className="text-slate-100 font-medium tabular-nums font-mono">
            {stats.correct}–{stats.incorrect}{stats.pushes > 0 && `–${stats.pushes}`}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Hit Rate</span>
          <span className={`font-semibold tabular-nums font-mono ${stats.accuracy >= 0.50 ? 'text-green-400' : 'text-red-400'}`}>
            {(stats.accuracy * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-400">ROI</span>
          <span className={`font-semibold tabular-nums font-mono ${stats.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatROI(stats.roi)}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Units</span>
          <span className={`font-semibold tabular-nums font-mono ${stats.units >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatUnits(stats.units)}
          </span>
        </div>
      </div>
    </div>
  )
}
