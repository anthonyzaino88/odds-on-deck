// Insights Dashboard - Learn what's working and what's not

export const metadata = {
  title: 'Insights — Performance Breakdown',
  description: 'Deep analysis of what is working and what is not. Performance breakdowns by sport, prop type, and player to refine your betting strategy.',
  openGraph: {
    title: 'Insights — Performance Breakdown | Odds on Deck',
    description: 'Deep performance analysis by sport, prop type, and player.',
  },
}

import Link from 'next/link'
import { analyzePerformance } from '../../lib/performance-analyzer.js'
import { getValidationStats } from '../../lib/validation.js'
import { SportBadge } from '../../components/ui'
import InsightsBreakdown from '../../components/InsightsBreakdown'

export const dynamic = 'force-dynamic'

const TH_CLASS = 'px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider'

export default async function InsightsDashboard() {
  const analysis = await analyzePerformance()
  const { insights, propTypeStats, playerStats } = analysis

  // Get overall stats from validation (consistent with Validation page)
  const overallStats = await getValidationStats()
  const overallAccuracy = overallStats.accuracy // Use same source as Validation page

  // Get stats by sport
  const nflStats = await getValidationStats({ sport: 'nfl' })
  const nhlStats = await getValidationStats({ sport: 'nhl' })
  const mlbStats = await getValidationStats({ sport: 'mlb' })

  // Sort insights by type (success, warning, info)
  const successInsights = insights.filter(i => i.type === 'success')
  const warningInsights = insights.filter(i => i.type === 'warning')
  const infoInsights = insights.filter(i => i.type === 'info')

  // Group actionable insights for the breakdown component
  const actionable = insights.filter(i => i.type === 'success' || i.type === 'warning')
  const systemInsights = actionable.filter(i => i.category === 'overall')

  const toPropChip = (i) => {
    const m = i.message.match(/([\d.]+)%/)
    return { name: (i.subject || '').replace(/_/g, ' '), accuracy: m ? m[1] : null }
  }
  const propTypeSuccess = actionable.filter(i => i.category === 'prop_type' && i.type === 'success').map(toPropChip)
  const propTypeWarning = actionable.filter(i => i.category === 'prop_type' && i.type === 'warning').map(toPropChip)

  const playerInsights = actionable
    .filter(i => i.category === 'player')
    .map(i => {
      const m = i.message.match(/\((\d+)\/(\d+)\)/)
      return {
        name: i.subject,
        correct: m ? parseInt(m[1], 10) : 0,
        total: m ? parseInt(m[2], 10) : 0,
        tone: i.type,
      }
    })

  // Get best and worst prop types
  const propTypeArray = Object.keys(propTypeStats).map(type => ({
    type,
    ...propTypeStats[type]
  })).filter(p => p.total >= 3).sort((a, b) => b.accuracy - a.accuracy)

  const bestPropTypes = propTypeArray.slice(0, 5)
  const worstPropTypes = propTypeArray.slice(-5).reverse()

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/validation"
          className="inline-flex items-center text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-300 transition-colors duration-100 mb-3"
        >
          ← Validation
        </Link>
        <h1 className="text-xl font-semibold text-slate-100">Performance Insights</h1>
        <p className="text-sm text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
          Learn what&apos;s working and improve your picks.
        </p>
      </div>

      {/* Overall Performance */}
      <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4 sm:p-6">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-4">Overall Performance</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="text-center p-4 bg-bg border border-white/[0.06] rounded-[4px]">
            <div className={`text-3xl sm:text-4xl font-semibold tabular-nums font-mono ${overallAccuracy >= 0.524 ? 'text-green-400' : 'text-red-400'}`}>
              {(overallAccuracy * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-slate-400 mt-1">Overall Win Rate</div>
            <div className="text-[11px] text-slate-500 mt-1">
              Break-even: 52.4%
            </div>
          </div>
          <div className="text-center p-4 bg-bg border border-white/[0.06] rounded-[4px]">
            <div className="text-3xl sm:text-4xl font-semibold text-slate-100 tabular-nums font-mono">
              {overallStats.correct}-{overallStats.incorrect}
            </div>
            <div className="text-xs text-slate-400 mt-1">Record</div>
            <div className="text-[11px] text-slate-500 mt-1 tabular-nums font-mono">
              {overallStats.total} total props
            </div>
          </div>
          <div className="text-center p-4 bg-bg border border-white/[0.06] rounded-[4px]">
            <div className={`text-xl sm:text-2xl font-semibold mt-1 ${overallAccuracy >= 0.524 ? 'text-green-400' : 'text-red-400'}`}>
              {overallAccuracy >= 0.524 ? 'Profitable' : 'Needs Work'}
            </div>
            <div className="text-xs text-slate-400 mt-2">
              {overallAccuracy >= 0.524 ? 'Above break-even' : 'Focus on improvement'}
            </div>
          </div>
          <div className="text-center p-4 bg-bg border border-white/[0.06] rounded-[4px]">
            <div className="text-3xl sm:text-4xl font-semibold text-blue-400 tabular-nums font-mono">
              {insights.length}
            </div>
            <div className="text-xs text-slate-400 mt-1">Actionable Insights</div>
            <div className="text-[11px] text-slate-500 mt-1 tabular-nums font-mono">
              {successInsights.length} strengths &middot; {warningInsights.length} improvements
            </div>
          </div>
        </div>
      </div>

      {/* Performance by Sport */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {nflStats.total > 0 && <SportPerformance sport="nfl" stats={nflStats} />}
        {nhlStats.total > 0 && <SportPerformance sport="nhl" stats={nhlStats} />}
        {mlbStats.total > 0 && <SportPerformance sport="mlb" stats={mlbStats} />}
      </div>

      {/* Actionable Insights */}
      {(systemInsights.length > 0 || propTypeSuccess.length > 0 || propTypeWarning.length > 0 || playerInsights.length > 0) && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">Actionable Insights</h3>
            <div className="flex-1 h-px bg-white/[0.04]" />
            <span className="text-[11px] text-slate-600 tabular-nums font-mono">
              {successInsights.length} trust &middot; {warningInsights.length} caution
            </span>
          </div>
          <InsightsBreakdown
            system={systemInsights}
            propTypeSuccess={propTypeSuccess}
            propTypeWarning={propTypeWarning}
            players={playerInsights}
          />
        </div>
      )}

      {/* Best Prop Types */}
      {bestPropTypes.length > 0 && (
        <PropTypeTable title="Best Performing Prop Types" props={bestPropTypes} tone="best" />
      )}

      {/* Worst Prop Types */}
      {worstPropTypes.length > 0 && (
        <PropTypeTable title="Struggling Prop Types" props={worstPropTypes} tone="worst" />
      )}

      {/* Info Box */}
      <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">How to Use These Insights</h4>
        <ul className="text-sm text-slate-400 space-y-1.5">
          <li>&bull; <span className="text-slate-200 font-medium">Prioritize</span> prop types with high accuracy in your parlays</li>
          <li>&bull; <span className="text-slate-200 font-medium">Avoid or reduce</span> prop types with low accuracy</li>
          <li>&bull; <span className="text-slate-200 font-medium">Track players</span> you predict well and focus on them</li>
          <li>&bull; <span className="text-slate-200 font-medium">Adjust confidence</span> based on historical performance</li>
          <li>&bull; <span className="text-slate-200 font-medium">Review regularly</span> as more data becomes available</li>
        </ul>
      </div>
    </div>
  )
}

function SportPerformance({ sport, stats }) {
  return (
    <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <SportBadge sport={sport} />
        <span className={`text-xl font-semibold tabular-nums font-mono ${stats.accuracy >= 0.524 ? 'text-green-400' : 'text-red-400'}`}>
          {(stats.accuracy * 100).toFixed(1)}%
        </span>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-400">Record</span>
          <span className="text-slate-100 font-medium tabular-nums font-mono">
            {stats.correct}-{stats.incorrect}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">ROI</span>
          <span className={`font-medium tabular-nums font-mono ${stats.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {(stats.roi * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Avg Edge</span>
          <span className="text-blue-400 font-medium tabular-nums font-mono">
            +{(stats.avgEdge * 100).toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  )
}

function PropTypeTable({ title, props, tone }) {
  const accuracyClass = (accuracy) => {
    if (tone === 'best') return accuracy >= 0.55 ? 'text-green-400' : 'text-slate-400'
    return accuracy < 0.45 ? 'text-red-400' : 'text-slate-400'
  }
  const correctClass = tone === 'best' ? 'text-green-400' : 'text-red-400'

  return (
    <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4 sm:p-6">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-4">{title}</h3>

      {/* Mobile Card View */}
      <div className="block lg:hidden space-y-3">
        {props.map((prop, idx) => (
          <div key={idx} className="bg-bg rounded-[4px] p-3 border border-white/[0.06]">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-slate-100 text-sm capitalize">
                {prop.type.replace(/_/g, ' ')}
              </span>
              <span className={`text-base font-semibold tabular-nums font-mono ${accuracyClass(prop.accuracy)}`}>
                {(prop.accuracy * 100).toFixed(1)}%
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs tabular-nums font-mono">
              <div>
                <span className="text-slate-500">Total: </span>
                <span className="text-slate-300">{prop.total}</span>
              </div>
              <div>
                <span className="text-slate-500">Correct: </span>
                <span className={`font-medium ${correctClass}`}>{prop.correct}</span>
              </div>
              <div>
                <span className="text-slate-500">Edge: </span>
                <span className="text-blue-400">+{(prop.avgEdge * 100).toFixed(1)}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden lg:block overflow-x-auto -mx-6">
        <table className="min-w-full">
          <thead className="bg-bg border-y border-white/[0.06]">
            <tr>
              <th className={`${TH_CLASS} text-left`}>Prop Type</th>
              <th className={`${TH_CLASS} text-center`}>Total</th>
              <th className={`${TH_CLASS} text-center`}>Correct</th>
              <th className={`${TH_CLASS} text-center`}>Accuracy</th>
              <th className={`${TH_CLASS} text-center`}>Avg Edge</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {props.map((prop, idx) => (
              <tr key={idx} className="hover:bg-elevated transition-colors duration-100">
                <td className="px-4 py-3 text-sm font-medium text-slate-100 capitalize">
                  {prop.type.replace(/_/g, ' ')}
                </td>
                <td className="px-4 py-3 text-sm text-center text-slate-400 tabular-nums font-mono">
                  {prop.total}
                </td>
                <td className={`px-4 py-3 text-sm text-center font-semibold tabular-nums font-mono ${correctClass}`}>
                  {prop.correct}
                </td>
                <td className="px-4 py-3 text-sm text-center">
                  <span className={`font-semibold tabular-nums font-mono ${accuracyClass(prop.accuracy)}`}>
                    {(prop.accuracy * 100).toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-center text-blue-400 tabular-nums font-mono">
                  +{(prop.avgEdge * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
