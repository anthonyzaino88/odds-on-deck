// Player Props page - Show individual player betting recommendations

import Link from 'next/link'
import { format } from 'date-fns'
import { getAllData } from '../../lib/data-manager.js'
import PlayerPropsFilter from '../../components/PlayerPropsFilter.js'

// Force dynamic rendering to avoid build-time database queries
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PlayerPropsPage() {
  // Get all data from centralized data manager (includes player props)
  const { playerProps, lastUpdated } = await getAllData()
  
  // Use all props
  const props = playerProps
  
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
              🎯 Player Props
            </h1>
            <p className="text-lg text-gray-600 mt-2">
              Individual player betting recommendations sorted by <strong>win probability</strong>
            </p>
            <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
              <span className="text-green-700 text-sm font-medium">
                ✅ Highest Win Chance Props First
              </span>
            </div>
            <div className="text-sm text-gray-500 mt-1">
              <span suppressHydrationWarning>Updated: {format(new Date(), 'h:mm a')}</span> • {props.length} props available
            </div>
          </div>
        </div>

        {props.length > 0 ? (
          <PlayerPropsFilter props={props} />
        ) : (
          <div className="text-center py-12">
            <div className="text-gray-400 text-6xl mb-4">🎯</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Player Props Available</h3>
            <p className="text-gray-600">
              Player props require lineup data. Check back once lineups are posted (typically 2-3 hours before game time).
            </p>
          </div>
        )}

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">
            <strong>Player Props Disclaimer:</strong> These recommendations are based on statistical analysis and matchup data. 
            Player performance can vary significantly game-to-game. Always consider injury reports, weather, and recent form.
          </p>
        </div>
      </div>
    </div>
  )
}
