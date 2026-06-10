// Shared API security helpers: admin-secret auth, basic rate limiting,
// and generic error responses that don't leak internals to clients.

import { NextResponse } from 'next/server'

// In-memory rate-limit buckets.
// NOTE: this is per-serverless-instance and resets on cold start; it is NOT a
// shared/distributed limiter. It blocks naive hammering from a single warm
// instance. For production-grade limiting use Vercel KV / Upstash Redis.
const buckets = new Map()

export function getClientIp(request) {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return request.headers.get('x-real-ip') || 'unknown'
}

/**
 * Sliding fixed-window rate limit keyed by route + client IP.
 * @returns {{ allowed: boolean, retryAfter?: number }}
 */
export function rateLimit(request, { key, limit = 10, windowMs = 60_000 }) {
  const id = `${key}:${getClientIp(request)}`
  const now = Date.now()
  const entry = buckets.get(id)

  if (!entry || now > entry.reset) {
    buckets.set(id, { count: 1, reset: now + windowMs })
    return { allowed: true }
  }
  if (entry.count >= limit) {
    return { allowed: false, retryAfter: Math.ceil((entry.reset - now) / 1000) }
  }
  entry.count++
  return { allowed: true }
}

/**
 * Verify the request carries the admin/cron shared secret.
 * Fails closed: if CRON_SECRET is not configured, nothing is authorized.
 * Accepts either `Authorization: Bearer <secret>` or `x-api-key: <secret>`.
 */
export function isAuthorizedAdmin(request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const auth = request.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const provided = bearer || request.headers.get('x-api-key')

  if (!provided || provided.length !== secret.length) return false
  // constant-time comparison
  let mismatch = 0
  for (let i = 0; i < secret.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ secret.charCodeAt(i)
  }
  return mismatch === 0
}

export function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
}

export function rateLimited(retryAfter = 60) {
  return NextResponse.json(
    { success: false, error: 'Too many requests. Please slow down.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )
}

export function serverError() {
  return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
}

export function badRequest(message = 'Invalid request') {
  return NextResponse.json({ success: false, error: message }, { status: 400 })
}
