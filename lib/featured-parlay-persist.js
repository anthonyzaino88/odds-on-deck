/**
 * Supabase IO for the Featured-cleared parlay track.
 * Quality + write plan live in featured-parlays.js — this file only writes.
 *
 * Does not call The Odds API. Does not write explorer Builder cards.
 * Does not insert extra PropValidation rows (Published persist already
 * records those props; a second row would pollute Published ROI).
 *
 * Snapshot uniqueness is claim-then-retract: look up the slot, insert if
 * empty, then re-read and delete pending losers. Two overlapping Featured
 * generates (SGP + a multi that collapsed to SGP, Strict Mode, two
 * visitors) can both miss the first lookup; the second read keeps the
 * earliest createdAt row.
 */
import { supabaseAdmin } from './supabase-admin.js'
import {
  featuredPersistClaim,
  featuredPersistWritePlan,
  featuredRowToDisplayParlay,
  featuredSnapshotKey,
  featuredSnapshotKeyFor,
  featuredSnapshotWinner,
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

const SNAPSHOT_LOOKUP_COLUMNS = 'id, notes, status, outcome, sport, type, createdAt, generatedAt, totalOdds'

export async function findFeaturedSnapshotsByKey(key, client = supabaseAdmin) {
  const { data, error } = await client
    .from('Parlay')
    .select(SNAPSHOT_LOOKUP_COLUMNS)
    .ilike('notes', `%snapshot:${key}%`)
    .order('createdAt', { ascending: true })

  if (error) throw new Error(`Featured snapshot lookup failed: ${error.message}`)
  return data || []
}

export async function findFeaturedSnapshots(parlay, now = new Date(), client = supabaseAdmin) {
  return findFeaturedSnapshotsByKey(featuredSnapshotKey(parlay, now), client)
}

export async function findFeaturedSnapshot(parlay, now = new Date(), client = supabaseAdmin) {
  return featuredSnapshotWinner(await findFeaturedSnapshots(parlay, now, client))
}

export async function loadFeaturedSnapshotCard(options = {}) {
  const {
    sport,
    type,
    now = new Date(),
    client = supabaseAdmin,
  } = options
  const key = featuredSnapshotKeyFor(sport, type, now)
  const { data, error } = await client
    .from('Parlay')
    .select('*, legs:ParlayLeg(*)')
    .ilike('notes', `%snapshot:${key}%`)
    .order('createdAt', { ascending: true })

  if (error) throw new Error(`Featured snapshot load failed: ${error.message}`)
  const winner = featuredSnapshotWinner(data || [])
  return winner ? featuredRowToDisplayParlay(winner) : null
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

async function defaultDeleteParlay(id, client) {
  const { error: legError } = await client
    .from('ParlayLeg')
    .delete()
    .eq('parlayId', id)
  if (legError) throw new Error(`Failed to retract Featured parlay legs: ${legError.message}`)
  const { error } = await client
    .from('Parlay')
    .delete()
    .eq('id', id)
  if (error) throw new Error(`Failed to retract duplicate Featured parlay: ${error.message}`)
}

/**
 * Persist one Featured-cleared card. First write for the day's
 * sport+kind slot wins. Inject `findSnapshots` / `insertParlay` /
 * `insertLegs` / `deleteParlay` in tests.
 */
export async function persistFeaturedClearedParlay(parlay, options = {}) {
  const now = options.now || new Date()
  const client = options.client || supabaseAdmin
  const findSnapshots = options.findSnapshots
    || ((card, at) => findFeaturedSnapshots(card, at, client))
  const insertParlay = options.insertParlay || ((row) => defaultInsertParlay(row, client))
  const insertLegs = options.insertLegs || ((legs) => defaultInsertLegs(legs, client))
  const deleteParlay = options.deleteParlay || ((id) => defaultDeleteParlay(id, client))

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

  const existing = featuredSnapshotWinner(await findSnapshots(parlay, now))
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
  const savedId = saved?.id || id
  const legs = toFeaturedParlayLegs(parlay, savedId, now).map((leg, index) => ({
    id: generateId() + String(index),
    ...leg,
  }))
  const savedLegs = await insertLegs(legs)

  const claimedRows = await findSnapshots(parlay, now)
  const rowsForClaim = (claimedRows || []).some((row) => row?.id === savedId)
    ? claimedRows
    : [{ ...(saved || row), id: savedId }, ...(claimedRows || [])]
  const claim = featuredPersistClaim(savedId, rowsForClaim)

  for (const extra of claim.retract) {
    try {
      await deleteParlay(extra.id)
    } catch (error) {
      console.error(`⚠️ Failed to retract duplicate Featured snapshot ${extra.id}:`, error)
    }
  }

  if (!claim.keepInserted) {
    return {
      ok: true,
      rejected: false,
      skipped: true,
      reason: 'already_snapped',
      parlay: claim.winner,
      legs: [],
    }
  }

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
