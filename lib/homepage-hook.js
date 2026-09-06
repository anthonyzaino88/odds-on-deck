/**
 * Homepage above-the-fold data. Proof numbers come from the same
 * getPublishedPicksStats() path as /validation. Board selection uses
 * lib/published-picks.js — do not invent a second cohort here.
 *
 * Results are cached briefly so a cold Published-archive scan cannot sit
 * on the homepage critical path for every request. Cohort math is unchanged.
 */
import { unstable_cache } from 'next/cache'
import { supabase } from './supabase.js'
import { getPublishedPicksStats } from './validation.js'
import {
  PUBLISHED_SPORTS,
  TODAYS_BOARD_CAP,
  filterPublishedPicks,
  getEtCalendarDayRange,
  pickWhyChip,
  selectTodaysBoardRows,
  summarizePublishedPicks,
  summarizeYesterdayPublished,
} from './published-picks.js'
import { formatAmericanOdds, unitsFromResult } from './odds-units.js'

const PROP_SELECT = [
  'propId',
  'gameId',
  'playerName',
  'team',
  'type',
  'pick',
  'threshold',
  'odds',
  'edge',
  'qualityScore',
  'numBooks',
  'sport',
  'bookmaker',
  'gameTime',
  'reasoning',
].join(', ')

function emptyBoard() {
  return {
    rows: [],
    nextSlateAt: null,
    lastNight: [],
  }
}

function parseGameTime(value) {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const raw = String(value)
  const iso = raw.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatSlateLock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
  return `${formatted} ET`
}

function marketLabel(record) {
  const raw = record?.type || record?.propType || ''
  return String(raw).replace(/_/g, ' ').trim()
}

function pickLabel(record) {
  return String(record?.pick || record?.prediction || '').trim()
}

function edgePercent(record) {
  const edge = Number(record?.edge)
  return Number.isFinite(edge) ? edge * 100 : null
}

function mapBoardRow({ prop, source }) {
  const edge = edgePercent(prop)
  const why = pickWhyChip(prop)

  return {
    key: [prop.propId, prop.gameId, prop.playerName, prop.type, prop.pick, prop.threshold]
      .filter((part) => part != null && part !== '')
      .join('|'),
    source,
    playerName: prop.playerName || 'Player',
    sport: String(prop.sport || '').toLowerCase(),
    market: marketLabel(prop),
    pick: pickLabel(prop),
    line: prop.threshold,
    odds: formatAmericanOdds(prop.odds),
    edge,
    why,
    href: prop.gameId ? `/game/${prop.gameId}` : null,
  }
}

function mapLastNightRow(record) {
  const result = String(record.result || '').toLowerCase()
  let resultLabel = 'Graded'
  if (result === 'correct' || result === 'win' || result === 'won' || result === 'hit') {
    resultLabel = 'Won'
  } else if (result === 'incorrect' || result === 'loss' || result === 'lost' || result === 'lose') {
    resultLabel = 'Lost'
  } else if (result === 'push' || result === 'pushed' || result === 'void') {
    resultLabel = 'Push'
  }

  const units = unitsFromResult(record.odds, record.result)
  const unitsLabel = `${units >= 0 ? '+' : ''}${units.toFixed(2)}u`

  return {
    key: record.id || record.propId || [record.playerName, record.propType, record.threshold].join('|'),
    playerName: record.playerName || 'Player',
    sport: String(record.sport || '').toLowerCase(),
    market: marketLabel(record),
    pick: pickLabel(record),
    line: record.threshold,
    result: resultLabel,
    units: unitsLabel,
    href: record.gameIdRef ? `/game/${record.gameIdRef}` : null,
  }
}

function earliestUpcoming(times) {
  const now = Date.now()
  const upcoming = times
    .map(parseGameTime)
    .filter((date) => date && date.getTime() > now)
    .sort((a, b) => a.getTime() - b.getTime())
  return upcoming[0] || null
}

async function fetchUpcomingPublishedProps() {
  if (!supabase) return []
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('PlayerPropCache')
    .select(PROP_SELECT)
    .in('sport', PUBLISHED_SPORTS)
    .eq('isStale', false)
    .gte('expiresAt', now)
    .gt('gameTime', now)
    .order('edge', { ascending: false })
    .limit(200)

  if (error) {
    console.error('homepage-hook: failed to load upcoming props', error)
    return []
  }
  return data || []
}

async function fetchLastNightPublished() {
  if (!supabase) return []
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - 2)

  const { data, error } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('status', 'completed')
    .in('sport', PUBLISHED_SPORTS)
    .gte('completedAt', cutoff.toISOString())
    .order('completedAt', { ascending: false })
    .limit(40)

  if (error) {
    console.error('homepage-hook: failed to load last-night published', error)
    return []
  }
  return filterPublishedPicks(data || []).slice(0, TODAYS_BOARD_CAP)
}

async function fetchYesterdayPublishedRecords() {
  if (!supabase) return []
  const { start, end } = getEtCalendarDayRange(-1)
  const { data, error } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('status', 'completed')
    .in('sport', PUBLISHED_SPORTS)
    .gte('completedAt', start.toISOString())
    .lt('completedAt', end.toISOString())
    .order('completedAt', { ascending: false })
    .limit(200)

  if (error) {
    console.error('homepage-hook: failed to load yesterday published', error)
    return []
  }
  return data || []
}

async function fetchNextSlateTime(propTimes) {
  const fromProps = earliestUpcoming(propTimes)
  if (fromProps) return fromProps
  if (!supabase) return null

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('Game')
    .select('date, sport, status')
    .in('sport', PUBLISHED_SPORTS)
    .gte('date', now)
    .order('date', { ascending: true })
    .limit(20)

  if (error || !data) return null
  return earliestUpcoming(data.map((game) => game.date))
}

async function loadHomepageBoard() {
  try {
    const [props, lastNightRecords] = await Promise.all([
      fetchUpcomingPublishedProps(),
      fetchLastNightPublished(),
    ])

    const selected = selectTodaysBoardRows({
      publishedEligible: props,
      editorsFill: props,
    })

    const nextSlate = await fetchNextSlateTime(props.map((prop) => prop.gameTime))

    return {
      rows: selected.map(mapBoardRow),
      nextSlateAt: formatSlateLock(nextSlate),
      lastNight: lastNightRecords.map(mapLastNightRow),
    }
  } catch (error) {
    console.error('homepage-hook: board failed', error)
    return emptyBoard()
  }
}

async function loadHomepageProofStats() {
  // Do not catch here: unstable_cache would persist an empty "sample 0"
  // card for the revalidate window after a transient query error.
  const [stats, yesterdayRecords] = await Promise.all([
    getPublishedPicksStats({ throwOnError: true }),
    fetchYesterdayPublishedRecords(),
  ])
  return {
    stats,
    yesterday: summarizeYesterdayPublished(yesterdayRecords),
  }
}

const HOMEPAGE_CACHE_SECONDS = 60

export const getHomepageBoard = unstable_cache(
  loadHomepageBoard,
  ['homepage-board'],
  { revalidate: HOMEPAGE_CACHE_SECONDS },
)

export const getHomepageProofStats = unstable_cache(
  loadHomepageProofStats,
  ['homepage-proof-stats'],
  { revalidate: HOMEPAGE_CACHE_SECONDS },
)
