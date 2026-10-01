/**
 * Requeue / close PropValidation helpers.
 * --source (or SOURCE=) is required so a bare run cannot touch every
 * needs_review row. Filters are applied on the query before .limit().
 */

export function takeFlag(argv, flag) {
  const i = argv.indexOf(flag)
  if (i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--')) return argv[i + 1]
  return null
}

export function parseDate(input) {
  if (!input) return null
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? null : d
}

export function parseRequeueArgs(argv = [], env = {}) {
  return {
    action: (takeFlag(argv, '--action') || env.ACTION || 'requeue').toLowerCase(),
    statuses: (takeFlag(argv, '--statuses') || env.STATUSES || 'needs_review')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    sport: takeFlag(argv, '--sport') || env.SPORT || null,
    source: takeFlag(argv, '--source') || env.SOURCE || null,
    afterDate: parseDate(env.AFTER_DATE),
    beforeDate: parseDate(env.BEFORE_DATE),
    limit: parseInt(takeFlag(argv, '--limit') || env.LIMIT || '200', 10),
    dryRun: argv.includes('--dry-run'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

export function requireRequeueSource(source) {
  const value = String(source || '').trim()
  if (!value) {
    throw new Error('--source (or SOURCE=) is required so a bare run cannot requeue every needs_review row')
  }
  return value
}

/**
 * Apply sport/source/date filters before limit so later matching rows
 * are not starved by an unfiltered 200-row page.
 */
export function applyRequeueQueryFilters(query, {
  statuses,
  sport,
  source,
  afterDate,
  beforeDate,
  limit = 200,
} = {}) {
  let next = query.in('status', statuses)
  if (sport) next = next.eq('sport', sport)
  if (source) next = next.eq('source', source)
  if (afterDate) next = next.gte('timestamp', afterDate.toISOString())
  if (beforeDate) next = next.lte('timestamp', beforeDate.toISOString())
  return next.order('timestamp', { ascending: true }).limit(limit)
}

export function describeRequeueWrite(action, validation, { now = new Date() } = {}) {
  const stamp = now.toISOString()
  const prefix = validation.notes ? `${validation.notes} | ` : ''
  if (action === 'requeue') {
    return { status: 'pending', notes: `${prefix}requeued ${stamp}` }
  }
  if (action === 'close_missing') {
    return { status: 'manual_closed', notes: `${prefix}closed_missing ${stamp}` }
  }
  if (action === 'close_final_no_stats') {
    return { status: 'manual_closed', notes: `${prefix}manual_closed_final_no_stats ${stamp}` }
  }
  return null
}
