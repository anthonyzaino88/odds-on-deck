'use client'

import { useState } from 'react'

function decimalToAmerican(d) {
  if (!d || d === 1) return '+100'
  d = parseFloat(d)
  if (isNaN(d)) return null
  return d >= 2.0 ? `+${Math.round((d - 1) * 100)}` : `${Math.round(-100 / (d - 1))}`
}

export default function ShareButton({ prop, variant = 'icon' }) {
  const [copied, setCopied] = useState(false)

  const odds = decimalToAmerican(prop.odds)
  const propLabel = (prop.type || prop.propType || '').replace(/_/g, ' ')
  const line = [
    prop.playerName || prop.team,
    prop.pick?.toUpperCase(),
    prop.threshold,
    propLabel,
    odds ? `@ ${odds}` : '',
    prop.bookmaker ? `on ${prop.bookmaker}` : '',
  ].filter(Boolean).join(' ')

  const shareText = `${line} — Odds on Deck`
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/game/${prop.gameId}`
    : ''

  async function handleShare(e) {
    e.preventDefault()
    e.stopPropagation()

    if (navigator.share) {
      try {
        await navigator.share({ text: shareText, url: shareUrl })
        return
      } catch {
        // User cancelled or not supported, fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Last resort fallback
      const ta = document.createElement('textarea')
      ta.value = `${shareText}\n${shareUrl}`
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (variant === 'icon') {
    return (
      <button
        onClick={handleShare}
        className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-slate-700 transition-colors"
        title="Share this pick"
      >
        {copied ? (
          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        )}
      </button>
    )
  }

  return (
    <button
      onClick={handleShare}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          Share
        </>
      )}
    </button>
  )
}
