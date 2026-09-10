/**
 * Supabase IO for the Featured-cleared parlay track.
 * Quality + write plan live in featured-parlays.js — this file only writes.
 *
 * Does not call The Odds API. Does not write explorer Builder cards.
 * Does not insert extra PropValidation rows (Published persist already
 * records those props; a second row would pollute Published ROI).
 */
import { supabaseAdmin } from './supabase-admin.js'
import {
  featuredPersistWritePlan,
  featuredSnapshotKey,
  isFeaturedClearedParlay,
  toFeaturedParlayLegs,
  toFeaturedParlayRow,
} from './featured-parlays.js'

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function findFeaturedSnapshot(parlay, now = new Date(), client = supabaseAdmin) {
  const key = featuredSnapshotKey(parlay, now)
  const { data, error } = await client
    .from('Parlay')
    .select('id, notes, status, outcome, sport, type, createdAt')
    .ilike('notes', `%snapshot:${key}%`)
    .order('createdAt', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Featured snapshot lookup failed: ${error.message}`)
  return data || null
}

async function defaultInsertParlay(row, client) {
  const { data, error } = await client
    .from('Parlay')
    .insert(row)
    .select()
    .single()
  if (error) throw new Error(`Failed to save Featured parlay: ${error.message}`)
  return data
}

async function defaultInsertLegs(legs, client) {
  if (!legs.length) return []
  const { data, error } = await client
    .from('ParlayLeg')
    .insert(legs)
    .select()
  if (error) throw new Error(`Failed to save Featured parlay legs: ${error.message}`)
  return data || []
}

/**
 * Persist one Featured-cleared card. First write for the day's
 * sport+kind slot wins. Inject `findSnapshot` / `insertParlay` /
 * `insertLegs` in tests.
 */
export async function persistFeaturedClearedParlay(parlay, options = {}) {
  const now = options.now || new Date()
  const client = options.client || supabaseAdmin
  const findSnapshot = options.findSnapshot || ((card, at) => findFeaturedSnapshot(card, at, client))
  const insertParlay = options.insertParlay || ((row) => defaultInsertParlay(row, client))
  const insertLegs = options.insertLegs || ((legs) => defaultInsertLegs(legs, client))

  if (!isFeaturedClearedParlay(parlay, now)) {
    return {
      ok: false,
      rejected: true,
      skipped: false,
      reason: 'not_featured_cleared',
      parlay: null,
      legs: [],
    }
  }

  const existing = await findSnapshot(parlay, now)
  if (featuredPersistWritePlan(existing) === 'skip') {
    return {
      ok: true,
      rejected: false,
      skipped: true,
      reason: 'already_snapped',
      parlay: existing,
      legs: [],
    }
  }

  const id = generateId()
  const instant = (now instanceof Date ? now : new Date(now)).toISOString()
  const row = {
    ...toFeaturedParlayRow(parlay, now),
    id,
    createdAt: instant,
    updatedAt: instant,
  }
  const saved = await insertParlay(row)
  const legs = toFeaturedParlayLegs(parlay, saved?.id || id, now).map((leg, index) => ({
    id: generateId() + String(index),
    ...leg,
  }))
  const savedLegs = await insertLegs(legs)

  return {
    ok: true,
    rejected: false,
    skipped: false,
    reason: 'inserted',
    parlay: saved,
    legs: savedLegs,
  }
}

export async function persistFeaturedClearedParlays(parlays, options = {}) {
  const results = []
  for (const parlay of Array.isArray(parlays) ? parlays : []) {
    const result = await persistFeaturedClearedParlay(parlay, options)
    results.push(result)
  }
  return results
}
