'use client'

import { useState } from 'react'

export default function CheckPropsButton() {
  const [isChecking, setIsChecking] = useState(false)

  const handleCheck = async () => {
    if (!confirm('Check all pending props and update results from completed games?')) {
      return
    }

    setIsChecking(true)
    try {
      const res = await fetch('/api/validation/check', { method: 'POST' })
      const data = await res.json()
      
      if (data.success) {
        alert(`✅ Updated ${data.updated} props!\n⏳ ${data.remaining} still pending.\n❌ ${data.errors} errors`)
        window.location.reload()
      } else {
        alert('Error: ' + data.error)
      }
    } catch (error) {
      alert('Error checking props: ' + error.message)
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <button
      onClick={handleCheck}
      disabled={isChecking}
      className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors"
    >
      {isChecking ? '🔄 Checking...' : '🔄 Check Completed Props'}
    </button>
  )
}




