'use client'

import { useState } from 'react'

/**
 * Button to manually trigger validation checking for completed games
 * Useful for clearing backlog of pending props
 */
export default function CheckValidationsButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [stats, setStats] = useState(null)

  // Fetch current stats on mount
  const fetchStats = async () => {
    try {
      const response = await fetch('/api/validation/check')
      const data = await response.json()
      setStats(data)
    } catch (error) {
      console.error('Error fetching stats:', error)
    }
  }

  // Load stats when component mounts
  useState(() => {
    fetchStats()
  }, [])

  const handleCheck = async () => {
    setLoading(true)
    setResult(null)

    try {
      console.log('🔍 Checking validations...')

      const response = await fetch('/api/validation/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const data = await response.json()

      if (data.success) {
        console.log('✅ Validations checked:', data)
        setResult({
          success: true,
          message: data.message,
          updated: data.updated,
          errors: data.errors,
          remaining: data.remaining
        })

        // Refresh stats
        await fetchStats()
      } else {
        console.error('❌ Error checking validations:', data)
        setResult({
          success: false,
          message: data.error || 'Failed to check validations'
        })
      }
    } catch (error) {
      console.error('❌ Error checking validations:', error)
      setResult({
        success: false,
        message: error.message || 'Failed to check validations'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Validation Checker
          </h3>
          <p className="text-sm text-gray-600">
            Check completed games and update prop results
          </p>
        </div>

        <button
          onClick={handleCheck}
          disabled={loading}
          className={`
            px-6 py-3 rounded-lg font-medium text-white
            transition-all duration-200
            ${loading
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
            }
          `}
        >
          {loading ? (
            <span className="flex items-center space-x-2">
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Checking...</span>
            </span>
          ) : (
            '🔍 Check Now'
          )}
        </button>
      </div>

      {/* Current Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-600">
              {stats.pending}
            </div>
            <div className="text-xs text-gray-600 uppercase">Pending</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {stats.completed}
            </div>
            <div className="text-xs text-gray-600 uppercase">Completed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {stats.correct}
            </div>
            <div className="text-xs text-gray-600 uppercase">Correct</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">
              {(stats.accuracy * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-gray-600 uppercase">Accuracy</div>
          </div>
        </div>
      )}

      {/* Result Message */}
      {result && (
        <div className={`
          p-4 rounded-lg border-2
          ${result.success
            ? 'bg-green-50 border-green-300'
            : 'bg-red-50 border-red-300'
          }
        `}>
          <div className="flex items-start space-x-3">
            <div className="text-2xl">
              {result.success ? '✅' : '❌'}
            </div>
            <div className="flex-1">
              <p className={`font-medium ${result.success ? 'text-green-900' : 'text-red-900'}`}>
                {result.message}
              </p>
              {result.success && (
                <div className="mt-2 text-sm text-gray-700 space-y-1">
                  <p>✅ Updated: <span className="font-semibold">{result.updated}</span> props</p>
                  {result.errors > 0 && (
                    <p>❌ Errors: <span className="font-semibold">{result.errors}</span> props</p>
                  )}
                  <p>⏳ Remaining: <span className="font-semibold">{result.remaining}</span> pending</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="text-xs text-gray-500 border-t pt-4">
        <p>💡 <strong>Tip:</strong> This runs automatically every refresh, but you can manually trigger it here to check old games.</p>
        <p className="mt-1">🔄 <strong>Auto-refresh:</strong> The system automatically checks validations during scheduled refreshes.</p>
      </div>
    </div>
  )
}




