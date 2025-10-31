// Editor's Picks page - Show recommended bets based on betting edges

import Link from 'next/link'
import { format } from 'date-fns'
import { getAllData } from '../../lib/data-manager.js'

// Force dynamic rendering to avoid build-time database queries
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PicksPage() {
  // Get all data from centralized data manager (includes picks)
  const { picks, lastUpdated } = await getAllData()
  
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <Link 
            href="/"
            className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500 mb-4"
          >
            ← Back to Home
          </Link>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900">
              🎯 Editor's Picks
            </h1>
            <p className="text-lg text-gray-600 mt-2">
              Today's best betting opportunities based on our models
            </p>
            <div className="text-sm text-gray-500 mt-1">
              Updated: {format(new Date(), 'h:mm a')}
            </div>
          </div>
        </div>

        {/* Picks Display */}
        {picks.length > 0 ? (
          <div className="space-y-6">
            {/* Best Picks */}
            <div className="card">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-900">
                  🔥 Best Picks Today
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Highest-edge opportunities ranked by our models
                </p>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {picks.slice(0, 5).map((pick, index) => (
                    <PickCard key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} rank={index + 1} />
                  ))}
                </div>
              </div>
            </div>

            {/* All Picks by Category */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Moneyline Picks */}
              <div className="card">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">
                    💰 Moneyline Picks
                  </h3>
                </div>
                <div className="p-6">
                  <div className="space-y-3">
                    {picks.filter(p => p.type === 'moneyline').map((pick) => (
                      <PickRow key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} />
                    ))}
                    {picks.filter(p => p.type === 'moneyline').length === 0 && (
                      <p className="text-gray-500 italic">No strong moneyline edges today</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Total Picks */}
              <div className="card">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">
                    📊 Over/Under Picks
                  </h3>
                </div>
                <div className="p-6">
                  <div className="space-y-3">
                    {picks.filter(p => p.type === 'total').map((pick) => (
                      <PickRow key={`${pick.gameId}-${pick.type}-${pick.pick}`} pick={pick} />
                    ))}
                    {picks.filter(p => p.type === 'total').length === 0 && (
                      <p className="text-gray-500 italic">No strong total edges today</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="text-gray-400 text-6xl mb-4">🎯</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Strong Picks Today</h3>
            <p className="text-gray-600">
              No significant betting edges found. Check back later as odds move throughout the day.
            </p>
          </div>
        )}

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">
            <strong>Disclaimer:</strong> These picks are for educational purposes based on statistical models. 
            Always gamble responsibly and within your means. Past performance does not guarantee future results.
          </p>
        </div>
      </div>
    </div>
  )
}

function PickCard({ pick, rank }) {
  const confidenceColor = {
    'very_high': 'bg-green-100 text-green-800 border-green-200',
    'high': 'bg-blue-100 text-blue-800 border-blue-200', 
    'medium': 'bg-yellow-100 text-yellow-800 border-yellow-200',
    'low': 'bg-orange-100 text-orange-800 border-orange-200',
    'very_low': 'bg-gray-100 text-gray-800 border-gray-200'
  }

  const confidenceText = {
    'very_high': 'Very High',
    'high': 'High',
    'medium': 'Medium', 
    'low': 'Low',
    'very_low': 'Very Low'
  }

  return (
    <Link href={`/game/${pick.gameId}`}>
      <div className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="text-2xl font-bold text-blue-600">#{rank}</div>
            <div>
              <div className="font-semibold text-gray-900">
                {pick.type === 'moneyline' ? `${pick.team} ML` : `${pick.team} ${pick.pick.toUpperCase()}`}
              </div>
              <div className="text-sm text-gray-600">
                {pick.reasoning}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {format(new Date(pick.gameTime), 'h:mm a')}
                {pick.odds && ` • ${pick.odds > 0 ? '+' : ''}${pick.odds}`}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${confidenceColor[pick.confidence]}`}>
              {confidenceText[pick.confidence]}
            </div>
            <div className="text-lg font-bold text-green-600 mt-1">
              +{(pick.edge * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

function PickRow({ pick }) {
  return (
    <Link href={`/game/${pick.gameId}`}>
      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
        <div>
          <div className="font-medium text-gray-900">
            {pick.type === 'moneyline' ? `${pick.team} ML` : `${pick.team} ${pick.pick.toUpperCase()}`}
          </div>
          <div className="text-sm text-gray-600">
            {format(new Date(pick.gameTime), 'h:mm a')}
            {pick.odds && ` • ${pick.odds > 0 ? '+' : ''}${pick.odds}`}
          </div>
        </div>
        <div className="text-right">
          <div className="font-bold text-green-600">
            +{(pick.edge * 100).toFixed(1)}%
          </div>
        </div>
      </div>
    </Link>
  )
}
