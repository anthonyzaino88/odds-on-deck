'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'

export default function ClientDate({ formatString = 'EEEE, MMMM d' }) {
  const [mounted, setMounted] = useState(false)
  const [date, setDate] = useState('')

  useEffect(() => {
    setMounted(true)
    setDate(format(new Date(), formatString))
  }, [formatString])

  if (!mounted) {
    return <span>Loading...</span>
  }

  return <span>{date}</span>
}
