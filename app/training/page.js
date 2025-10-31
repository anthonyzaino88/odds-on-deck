// Training Mode - Generate & validate mock props without paid API
'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function TrainingPage() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [stats, setStats] = useState(null)

  const generateMockProps = async () => {
    setLoading(true)
    setResult(null)

    try {
      const response = await fetch('/api/training/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      const data = await response.json()

      if (data.success) {
        setResult({
          success: true,
          message: data.message,
          generated: data.generated,
          games: data.games,
          saved: data.saved
        })
        
        // Refresh stats
        await fetchStats()
      } else {
        setResult({
          success: false,
          message: data.error || 'Failed to generate props'
        })
      }
    } catch (error) {
      console.error('Error generating props:', error)
      setResult({
        success: false,
        message: error.message
      })
    } finally {
      setLoading(false)
    }
  }

  const validateMockProps = async (force = false) => {
    setLoading(true)
    setResult(null)

    try {
      const response = await fetch('/api/training/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      })

      const data = await response.json()

      if (data.success) {
        setResult({
          success: true,
          message: data.message,
          validated: data.validated,
          correct: data.correct,
          incorrect: data.incorrect
        })
        
        // Refresh stats
        await fetchStats()
      } else {
        setResult({
          success: false,
          message: data.error || 'Failed to validate props'
        })
      }
    } catch (error) {
      console.error('Error validating props:', error)
      setResult({
        success: false,
        message: error.message
      })
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/training/stats')
      const data = await response.json()
      
      if (data.success) {
        setStats({
          total: data.summary.totalProps,
          pending: data.summary.pendingProps,
          completed: data.summary.completedProps,
          correct: data.summary.correctProps,
          incorrect: data.summary.incorrectProps,
          pushes: data.summary.pushProps,
          accuracy: data.summary.accuracy,
          sportBreakdown: data.sportBreakdown,
          gameStatusBreakdown: data.gameStatusBreakdown
        })
      }
    } catch (error) {
      console.error('Error fetching stats:', error)
    }
  }

  // Load stats on mount
  useState(() => {
    fetchStats()
  }, [])

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
              🧪 Training Mode
            </h1>
            <p className="text-lg text-gray-600 mt-2">
              Generate & validate props using free APIs (no Odds API required)
            </p>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            💡 What is Training Mode?
          </h3>
          <div className="text-gray-700 space-y-2">
            <p>
              <strong>Training Mode</strong> allows you to generate "shadow props" using <strong>free APIs</strong> (ESPN, MLB Stats) 
              instead of the paid Odds API. This is perfect for:
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>Testing your validation system</li>
              <li>Building a training dataset</li>
              <li>Tracking accuracy when Odds API is at limit</li>
              <li>Training ML models without API costs</li>
            </ul>
            <p className="mt-3">
              <strong>How it works:</strong> Generate props using statistical models → Wait for games to finish → Validate results
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          
          {/* Generate Props */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="text-3xl">🎲</div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Generate Mock Props
                </h3>
                <p className="text-sm text-gray-600">
                  Create props for today's games
                </p>
              </div>
            </div>

            <button
              onClick={generateMockProps}
              disabled={loading}
              className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
                loading
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {loading ? '⏳ Generating...' : '🎲 Generate Props'}
            </button>

            <p className="text-xs text-gray-500 mt-3">
              Uses free ESPN & MLB Stats APIs to generate statistical predictions
            </p>
          </div>

          {/* Validate Props */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="text-3xl">✅</div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Validate Completed Props
                </h3>
                <p className="text-sm text-gray-600">
                  Check finished games
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => validateMockProps(false)}
                disabled={loading}
                className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
                  loading
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {loading ? '⏳ Validating...' : '✅ Validate Finished Games'}
              </button>

              <button
                onClick={() => validateMockProps(true)}
                disabled={loading}
                className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                  loading
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-purple-600 text-white hover:bg-purple-700'
                }`}
              >
                {loading ? '⏳ Validating...' : '⚡ Force Validate All (Testing)'}
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-3">
              Use "Force Validate" to test with upcoming games
            </p>
          </div>
        </div>

        {/* Result Message */}
        {result && (
          <div className={`rounded-lg p-6 mb-8 ${
            result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
          }`}>
            <div className="flex items-start gap-3">
              <div className="text-2xl">
                {result.success ? '✅' : '❌'}
              </div>
              <div className="flex-1">
                <h3 className={`font-semibold mb-2 ${
                  result.success ? 'text-green-900' : 'text-red-900'
                }`}>
                  {result.success ? 'Success!' : 'Error'}
                </h3>
                <p className={result.success ? 'text-green-800' : 'text-red-800'}>
                  {result.message}
                </p>
                {result.success && result.generated && (
                  <div className="mt-3 text-sm text-green-700">
                    <p>📊 Generated: {result.generated} props</p>
                    <p>🎮 Games: {result.games}</p>
                    <p>💾 Saved: {result.saved}</p>
                  </div>
                )}
                {result.success && result.validated && (
                  <div className="mt-3 text-sm text-green-700">
                    <p>📊 Validated: {result.validated} props</p>
                    <p>✅ Correct: {result.correct}</p>
                    <p>❌ Incorrect: {result.incorrect}</p>
                    <p>📈 Accuracy: {((result.correct / result.validated) * 100).toFixed(1)}%</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Current Stats */}
        {stats && (
          <>
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                📊 Overall Statistics
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-gray-900">
                    {stats.total || 0}
                  </div>
                  <div className="text-sm text-gray-600">Total Props</div>
                </div>

                <div className="bg-yellow-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-yellow-800">
                    {stats.pending || 0}
                  </div>
                  <div className="text-sm text-gray-600">Pending</div>
                </div>

                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-800">
                    {stats.completed || 0}
                  </div>
                  <div className="text-sm text-gray-600">Completed</div>
                </div>

                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-800">
                    {stats.accuracy ? stats.accuracy.toFixed(1) : '0.0'}%
                  </div>
                  <div className="text-sm text-gray-600">Accuracy</div>
                </div>
              </div>

              {stats.completed > 0 && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">Correct</span>
                    <span className="text-sm font-medium text-green-600">
                      {stats.correct || 0}
                    </span>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">Incorrect</span>
                    <span className="text-sm font-medium text-red-600">
                      {stats.incorrect || 0}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Push</span>
                    <span className="text-sm font-medium text-gray-600">
                      {stats.pushes || 0}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Sport Breakdown */}
            {stats.sportBreakdown && Object.keys(stats.sportBreakdown).length > 0 && (
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  🏆 Props by Sport
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Object.entries(stats.sportBreakdown).map(([sport, data]) => (
                    <div key={sport} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-lg font-semibold uppercase">
                          {sport === 'mlb' ? '⚾ MLB' : sport === 'nfl' ? '🏈 NFL' : sport === 'nhl' ? '🏒 NHL' : sport}
                        </span>
                        <span className="text-2xl font-bold text-gray-900">{data.total}</span>
                      </div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Pending:</span>
                          <span className="font-medium text-yellow-600">{data.pending}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Completed:</span>
                          <span className="font-medium text-green-600">{data.completed}</span>
                        </div>
                        {data.completed > 0 && (
                          <div className="flex justify-between pt-2 border-t border-gray-200">
                            <span className="text-gray-600">Accuracy:</span>
                            <span className="font-bold text-blue-600">{data.accuracy}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Game Status Breakdown */}
            {stats.gameStatusBreakdown && stats.gameStatusBreakdown.total > 0 && (
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  🎮 Game Status (for Pending Props)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-gray-900">
                      {stats.gameStatusBreakdown.total}
                    </div>
                    <div className="text-sm text-gray-600">Total Games</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-blue-800">
                      {stats.gameStatusBreakdown.upcoming}
                    </div>
                    <div className="text-sm text-gray-600">⏰ Upcoming</div>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-orange-800">
                      {stats.gameStatusBreakdown.inProgress}
                    </div>
                    <div className="text-sm text-gray-600">🔴 In Progress</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-green-800">
                      {stats.gameStatusBreakdown.finished}
                    </div>
                    <div className="text-sm text-gray-600">✅ Finished</div>
                  </div>
                </div>
                {stats.gameStatusBreakdown.finished > 0 && (
                  <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-800">
                      💡 <strong>{stats.gameStatusBreakdown.finished} games</strong> are finished and ready to validate!
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Quick Links */}
        <div className="mt-8 flex gap-4 justify-center">
          <Link
            href="/validation"
            className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors"
          >
            📊 View Validation Dashboard
          </Link>
          <Link
            href="/insights"
            className="inline-flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
          >
            💡 View Insights
          </Link>
        </div>
      </div>
    </div>
  )
}

