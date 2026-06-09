'use client'

import { useState } from 'react'

export default function CheckPropsButton() {
  const [isChecking, setIsChecking] = useState(false)
  const [progress, setProgress] = useState(null)

  const handleCheck = async () => {
    if (!confirm('Check all pending props and update results from completed games?\n\nThis will run in batches to prevent timeout.')) {
      return
    }

    setIsChecking(true)
    setProgress({ batch: 0, updated: 0, errors: 0, total: 0 })
    
    let batch = 0
    let totalUpdated = 0
    let totalErrors = 0
    let hasMore = true
    
    try {
      while (hasMore) {
        setProgress(prev => ({ ...prev, batch: batch + 1 }))
        
        const res = await fetch('/api/validation/check', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch })
        })
        
        if (!res.ok) {
          const text = await res.text()
          throw new Error(`Server error: ${text.slice(0, 100)}`)
        }
        
        const data = await res.json()
        
        if (!data.success) {
          throw new Error(data.error || 'Unknown error')
        }
        
        totalUpdated += data.updated || 0
        totalErrors += data.errors || 0
        
        setProgress({
          batch: batch + 1,
          updated: totalUpdated,
          errors: totalErrors,
          total: data.totalPending || 0,
          remaining: data.remaining || 0
        })
        
        hasMore = data.hasMoreBatches && data.updated > 0
        batch++
        
        // Safety: max 20 batches (300 validations)
        if (batch >= 20) {
          console.log('Max batches reached')
          break
        }
        
        // Small delay between batches
        if (hasMore) {
          await new Promise(r => setTimeout(r, 500))
        }
      }
      
      alert(`Validation Complete\n\n` +
            `Batches processed: ${batch}\n` +
            `Updated: ${totalUpdated}\n` +
            `Errors: ${totalErrors}`)
      // Force hard refresh to bypass any caching
      window.location.href = window.location.href + '?t=' + Date.now()
      
    } catch (error) {
      console.error('Error checking props:', error)
      alert('Error checking props: ' + error.message)
    } finally {
      setIsChecking(false)
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleCheck}
        disabled={isChecking}
        className="inline-flex items-center justify-center px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-elevated disabled:text-slate-500 text-white text-sm font-medium rounded-[4px] transition-colors duration-100"
      >
        {isChecking ? 'Checking...' : 'Check Completed Props'}
      </button>

      {progress && (
        <div className="text-xs text-slate-400 tabular-nums font-mono">
          <div>Batch {progress.batch} &middot; Updated: {progress.updated} &middot; Errors: {progress.errors}</div>
          {progress.remaining > 0 && (
            <div className="text-amber-400">
              ~{progress.remaining} remaining
            </div>
          )}
        </div>
      )}
    </div>
  )
}
