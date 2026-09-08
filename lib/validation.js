// Validation system for tracking projection accuracy over time
// MIGRATED TO SUPABASE - Uses admin client for write operations
import { supabaseAdmin as supabase } from './supabase-admin.js'
import { calculateQualityScore } from './quality-score.js'
import { unitsFromResult, impliedProbabilityFromOdds, detectOddsFormat, toAmericanOdds } from './odds-units.js'
import { getBookCount, attachNumBooks } from './juice-traps.js'
import {
  PUBLISHED_STATS_PREFILTER,
  PUBLISHED_STATS_SELECT,
  summarizePublishedPicks,
  summarizeSidesTotals,
} from './published-picks.js'
import {
  GAME_LINE_SOURCE,
  SIDES_TOTALS_COHORT_TAG,
  gameLineLabel,
  gameLinePropId,
  gradeGameLineFromScores,
  isFinalGameStatus,
} from './game-lines.js'

// Helper to generate unique IDs (Vercel-compatible)
function generateId() {
  // Use crypto.randomUUID() which works in both Node.js and Edge runtime
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  }
  // Fallback for older environments
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Record a player prop prediction for validation
 * @param {object} prop - The player prop object
 * @param {string} source - Source of the prediction ("user_saved", "parlay_leg", "system_generated")
 * @param {string} parlayId - Optional parlay ID if from a saved parlay
 * @returns {Promise<object>} The created validation record
 */
export async function recordPropPrediction(prop, source = 'system_generated', parlayId = null) {
  try {
    if (!prop) {
      console.warn('⚠️ No prop provided');
      return null;
    }
    
    if (!prop.playerName) {
      console.warn('⚠️ Missing playerName:', prop);
      return null;
    }
    
    if (!prop.gameId) {
      console.warn('⚠️ Missing gameId:', prop.playerName);
      return null;
    }
    
    // CRITICAL VALIDATION: Verify the game exists and has correct sport
    console.log(`🔍 Validating game ID for ${prop.playerName} (sport: ${prop.sport})...`)
    const { data: game, error: gameError } = await supabase
      .from('Game')
      .select(`
        id, 
        sport, 
        espnGameId,
        home:Team!Game_homeId_fkey(name, abbr),
        away:Team!Game_awayId_fkey(name, abbr)
      `)
      .eq('id', prop.gameId)
      .maybeSingle()
    
    if (gameError) {
      console.error(`❌ Error looking up game ${prop.gameId}:`, gameError)
      return null
    }
    
    if (!game) {
      console.error(`❌ Game ${prop.gameId} not found in database - skipping prop for ${prop.playerName}`)
      console.error(`   This prop may have been saved with an incorrect gameId`)
      return null
    }
    
    // Verify sport matches
    if (prop.sport && game.sport && prop.sport !== game.sport) {
      console.error(`❌ Sport mismatch for ${prop.playerName}:`)
      console.error(`   Prop sport: ${prop.sport}`)
      console.error(`   Game sport: ${game.sport}`)
      console.error(`   GameId: ${prop.gameId}`)
      console.error(`   Game: ${game.away?.name || 'Unknown'} @ ${game.home?.name || 'Unknown'}`)
      return null
    }
    
    console.log(`✅ Game validated: ${game.away?.name || 'Unknown'} @ ${game.home?.name || 'Unknown'} (${game.sport})`)
    
    // Generate a unique propId - check both 'propId' and 'id' fields
    const propId = prop.propId || prop.id || `prop-${prop.playerName.replace(/\s+/g, '-')}-${prop.type}-${prop.gameId}${parlayId ? '-' + parlayId : '-' + Date.now()}`
    
    // Calculate quality score
    const qualityScore = calculateQualityScore({
      probability: prop.probability || 0.5,
      edge: prop.edge || 0,
      confidence: prop.confidence || 'medium'
    })
    
    // Check if validation already exists
    const { data: existing } = await supabase
      .from('PropValidation')
      .select('*')
      .eq('propId', propId)
      .maybeSingle()
    
    const validationData = attachNumBooks({
      propId: propId,
      gameIdRef: prop.gameId,
      playerName: prop.playerName,
      propType: prop.type || 'unknown',
      threshold: prop.threshold || 0,
      prediction: prop.pick || 'over',
      projectedValue: prop.projection || prop.projectedValue || 0,
      confidence: prop.confidence || 'low',
      edge: prop.edge || 0,
      odds: prop.odds || null,
      probability: prop.probability || null,
      qualityScore: qualityScore,
      source: source,
      parlayId: parlayId,
      status: 'pending',
      sport: prop.sport || 'mlb',
      timestamp: new Date().toISOString()
    }, prop)
    
    let result
    if (existing) {
      // Update existing record. Only write numBooks when we actually have one —
      // never overwrite a stored count with null / a guessed value.
      const updatePayload = {
          threshold: validationData.threshold,
          prediction: validationData.prediction,
          projectedValue: validationData.projectedValue,
          confidence: validationData.confidence,
          edge: validationData.edge,
          odds: validationData.odds,
          probability: validationData.probability,
          qualityScore: validationData.qualityScore,
          source: validationData.source,
          parlayId: validationData.parlayId
      }
      const knownBooks = getBookCount(prop)
      if (knownBooks != null) updatePayload.numBooks = knownBooks

      const { data, error } = await supabase
        .from('PropValidation')
        .update(updatePayload)
        .eq('propId', propId)
        .select()
        .single()
      
      if (error) throw error
      result = data
    } else {
      // Create new record
      validationData.id = generateId()
      const { data, error } = await supabase
        .from('PropValidation')
        .insert(validationData)
        .select()
        .single()
      
      if (error) throw error
      result = data
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error recording prop prediction:', error);
    console.error('Prop data:', JSON.stringify(prop, null, 2));
    return null;
  }
}

/**
 * Update a validation record with the actual result
 * @param {string} propId - The prop ID
 * @param {number} actualValue - The actual statistical value
 * @returns {Promise<object>} The updated validation record
 */
export async function updatePropResult(propId, actualValue) {
  try {
    // Find the validation record
    const { data: validation, error: findError } = await supabase
      .from('PropValidation')
      .select('*')
      .eq('propId', propId)
      .maybeSingle()
    
    if (findError) throw findError
    if (!validation) {
      console.warn(`No validation record found for prop ${propId}`);
      return null;
    }
    
    // Determine if the prediction was correct
    let result = 'incorrect';
    if (
      (validation.prediction === 'over' && actualValue > validation.threshold) ||
      (validation.prediction === 'under' && actualValue < validation.threshold)
    ) {
      result = 'correct';
    } else if (actualValue === validation.threshold) {
      result = 'push';
    }
    
    // Update the validation record
    const { data: updated, error: updateError } = await supabase
      .from('PropValidation')
      .update({
        actualValue,
        result,
        status: 'completed',
        completedAt: new Date().toISOString()
      })
      .eq('id', validation.id)
      .select()
      .single()
    
    if (updateError) throw updateError
    return updated;
  } catch (error) {
    console.error('Error updating prop result:', error);
    return null;
  }
}

/**
 * Paginated fetch of completed PropValidation rows.
 * @param {object} options
 */
async function fetchCompletedValidations(options = {}) {
    let allValidations = []
    let page = 0
    const pageSize = 1000
    let hasMore = true
    
    while (hasMore) {
      let query = supabase
        .from('PropValidation')
        .select('*')
        .eq('status', 'completed')
      
      if (options.propType) {
        query = query.eq('propType', options.propType)
      }
      if (options.sport) {
        query = query.eq('sport', options.sport)
      }
      if (options.confidence) {
        query = query.eq('confidence', options.confidence)
      }
      if (options.days) {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - options.days)
        query = query.gte('completedAt', cutoff.toISOString())
      }
      if (options.source) {
        query = query.eq('source', options.source)
      }
      if (options.sourceGroup === 'user') {
        query = query.in('source', ['user_saved', 'parlay_leg'])
      } else if (options.sourceGroup === 'system') {
        query = query.eq('source', 'system_generated')
      }
      
      // Stable ordering is REQUIRED for reliable range pagination. Without an
      // explicit ORDER BY, Postgres can return rows in different orders across
      // pages, causing a short page to end the loop early and undercount totals.
      query = query.order('id', { ascending: true })
      
      const start = page * pageSize
      const end = start + pageSize - 1
      query = query.range(start, end)
      
      const { data: pageData, error } = await query
      
      if (error) throw error
      
      if (!pageData || pageData.length === 0) {
        hasMore = false
      } else {
        allValidations = allValidations.concat(pageData)
        if (pageData.length < pageSize) {
          hasMore = false
        }
        page++
      }
    }

  return allValidations
}

/**
 * Completed PropValidation rows that can possibly enter the Published card.
 * SQL applies the locked sport / edge / quality floors so we do not pull the
 * full graded archive (and every column) just to throw most rows away in JS.
 * Juice traps and the American odds band still run in summarizePublishedPicks().
 * @param {object} options
 * @param {number} [options.days]
 */
async function fetchPublishedStatsRecords(options = {}) {
  let allValidations = []
  let page = 0
  const pageSize = 1000
  let hasMore = true

  while (hasMore) {
    let query = supabase
      .from('PropValidation')
      .select(PUBLISHED_STATS_SELECT)
      .eq('status', 'completed')
      .in('sport', PUBLISHED_STATS_PREFILTER.sports)
      .gt('edge', PUBLISHED_STATS_PREFILTER.edgeGreaterThan)
      .gte('qualityScore', PUBLISHED_STATS_PREFILTER.minQuality)
      .not('source', 'eq', GAME_LINE_SOURCE)
      .not('propType', 'in', '(moneyline,total,totals,h2h,ml)')
      .order('id', { ascending: true })

    if (options.days) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - options.days)
      query = query.gte('completedAt', cutoff.toISOString())
    }

    const start = page * pageSize
    const end = start + pageSize - 1
    query = query.range(start, end)

    const { data: pageData, error } = await query

    if (error) throw error

    if (!pageData || pageData.length === 0) {
      hasMore = false
    } else {
      allValidations = allValidations.concat(pageData)
      if (pageData.length < pageSize) {
        hasMore = false
      }
      page++
    }
  }

  return allValidations
}

/**
 * ROI-first stats for the locked Published picks cohort (MLB + NFL).
 * Time window uses completedAt; source filters are not applied — this is the brand card.
 * @param {object} options
 * @param {number} [options.days]
 */
export async function getPublishedPicksStats(options = {}) {
  try {
    const validations = await fetchPublishedStatsRecords({
      days: options.days,
    })
    return summarizePublishedPicks(validations)
  } catch (error) {
    console.error('Error getting published picks stats:', error)
    if (options.throwOnError) throw error
    return summarizePublishedPicks([])
  }
}

/**
 * Get validation statistics
 * @param {object} options - Filter options
 * @param {string} options.sport - Filter by sport
 * @param {string} options.propType - Filter by prop type
 * @param {string} options.confidence - Filter by confidence level
 * @param {number} options.days - Only include records completed within this many days
 * @param {number} options.minSample - Minimum sample size for prop type breakdown (default: 0)
 * @param {string} options.source - Filter by source ("user_saved", "parlay_leg", "system_generated")
 * @param {string} options.sourceGroup - Filter by source group ("user" = user_saved+parlay_leg, "system" = system_generated)
 * @returns {Promise<object>} Validation statistics
 */
export async function getValidationStats(options = {}) {
  try {
    const validations = await fetchCompletedValidations(options)
    
    const total = validations?.length || 0
    const correct = validations?.filter(v => v.result === 'correct').length || 0
    const incorrect = validations?.filter(v => v.result === 'incorrect').length || 0
    const pushes = validations?.filter(v => v.result === 'push').length || 0
    const withResults = correct + incorrect
    
    const accuracy = withResults > 0 ? correct / withResults : 0
    
    const validationsWithEdge = validations?.filter(v => v.edge != null && !isNaN(v.edge)) || []
    const avgEdge = validationsWithEdge.length > 0 
      ? validationsWithEdge.reduce((sum, v) => sum + (v.edge || 0), 0) / validationsWithEdge.length 
      : 0
    
    let totalUnits = 0
    let betsWithOdds = 0
    let betsWithoutOdds = 0
    validations?.forEach(v => {
      if (v.result === 'push') return
      totalUnits += unitsFromResult(v.odds, v.result)
      if (detectOddsFormat(v.odds)) betsWithOdds++
      else betsWithoutOdds++
    })
    const roi = withResults > 0 ? totalUnits / withResults : 0
    const units = totalUnits
    
    const byPropType = {}
    const minSample = options.minSample || 0
    validations?.forEach(v => {
      const key = v.sport ? `${v.sport.toUpperCase()} - ${v.propType}` : v.propType
      if (!byPropType[key]) {
        byPropType[key] = { total: 0, correct: 0, incorrect: 0, pushes: 0, sport: v.sport, units: 0 }
      }
      byPropType[key].total++
      if (v.result === 'correct') {
        byPropType[key].correct++
        byPropType[key].units += unitsFromResult(v.odds, 'correct')
      } else if (v.result === 'incorrect') {
        byPropType[key].incorrect++
        byPropType[key].units += unitsFromResult(v.odds, 'incorrect')
      } else if (v.result === 'push') {
        byPropType[key].pushes++
      }
    })
    
    Object.keys(byPropType).forEach(type => {
      const typeStat = byPropType[type]
      const typeWithResults = typeStat.correct + typeStat.incorrect
      typeStat.accuracy = typeWithResults > 0 ? typeStat.correct / typeWithResults : 0
      typeStat.roi = typeWithResults > 0 ? typeStat.units / typeWithResults : 0
      
      const typeValidations = validations.filter(v => {
        const k = v.sport ? `${v.sport.toUpperCase()} - ${v.propType}` : v.propType
        return k === type && impliedProbabilityFromOdds(v.odds) != null
      })
      typeStat.avgImplied = typeValidations.length > 0
        ? typeValidations.reduce((sum, v) => sum + impliedProbabilityFromOdds(v.odds), 0) / typeValidations.length
        : null
    })
    
    // Filter out prop types below minimum sample size
    if (minSample > 0) {
      Object.keys(byPropType).forEach(type => {
        if (byPropType[type].total < minSample) {
          delete byPropType[type]
        }
      })
    }
    
    return {
      total,
      correct,
      incorrect,
      pushes,
      accuracy,
      avgEdge,
      roi,
      units,
      byPropType
    }
  } catch (error) {
    console.error('Error getting validation stats:', error)
    return {
      total: 0,
      correct: 0,
      incorrect: 0,
      pushes: 0,
      accuracy: 0,
      avgEdge: 0,
      roi: 0,
      units: 0,
      byPropType: {}
    }
  }
}

/**
 * Get detailed validation records
 * @param {object} options - Filter options
 * @returns {Promise<Array>} Validation records
 */
export async function getValidationRecords(options = {}) {
  try {
    // If a specific limit is requested, use it directly
    if (options.limit) {
      let query = supabase
        .from('PropValidation')
        .select('*')
      
      if (options.status) {
        query = query.eq('status', options.status)
      }
      if (options.propType) {
        query = query.eq('propType', options.propType)
      }
      if (options.sport) {
        query = query.eq('sport', options.sport)
      }
      if (options.result) {
        query = query.eq('result', options.result)
      }
      
      query = query.order('timestamp', { ascending: false }).limit(options.limit)
      
      const { data: validations, error } = await query
      if (error) throw error
      return validations || []
    }
    
    // Otherwise, fetch ALL using pagination (Supabase has 1000 row limit)
    let allValidations = []
    let page = 0
    const pageSize = 1000
    let hasMore = true
    
    while (hasMore) {
      let query = supabase
        .from('PropValidation')
        .select('*')
      
      if (options.status) {
        query = query.eq('status', options.status)
      }
      if (options.propType) {
        query = query.eq('propType', options.propType)
      }
      if (options.sport) {
        query = query.eq('sport', options.sport)
      }
      if (options.result) {
        query = query.eq('result', options.result)
      }
      
      // Secondary order by unique id keeps range pagination stable when many
      // rows share the same timestamp.
      query = query.order('timestamp', { ascending: false }).order('id', { ascending: true })
      
      const start = page * pageSize
      const end = start + pageSize - 1
      query = query.range(start, end)
      
      const { data: pageData, error } = await query
      
      if (error) throw error
      
      if (!pageData || pageData.length === 0) {
        hasMore = false
      } else {
        allValidations = allValidations.concat(pageData)
        if (pageData.length < pageSize) {
          hasMore = false
        }
        page++
      }
    }
    
    return allValidations
  } catch (error) {
    console.error('Error getting validation records:', error)
    return []
  }
}

/**
 * Get validation counts by status and sport using efficient server-side queries
 * @returns {Promise<object>} Counts by status and sport
 */
export async function getValidationCounts() {
  try {
    const statuses = ['pending', 'completed', 'needs_review', 'manual_closed']
    const sports = ['nfl', 'nhl', 'mlb']
    const counts = {}

    // Parallel count queries for each status
    const statusPromises = statuses.map(async (s) => {
      const { count } = await supabase
        .from('PropValidation')
        .select('*', { count: 'exact', head: true })
        .eq('status', s)
      counts[s] = count || 0
    })

    // Parallel count queries for pending by sport
    const pendingBySport = {}
    const sportPromises = sports.map(async (sp) => {
      const { count } = await supabase
        .from('PropValidation')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('sport', sp)
      pendingBySport[sp] = count || 0
    })

    // Source counts
    const sources = ['user_saved', 'parlay_leg', 'system_generated']
    const sourceCounts = {}
    const sourcePromises = sources.map(async (src) => {
      const { count } = await supabase
        .from('PropValidation')
        .select('*', { count: 'exact', head: true })
        .eq('source', src)
      sourceCounts[src] = count || 0
    })

    // Total
    const totalPromise = supabase
      .from('PropValidation')
      .select('*', { count: 'exact', head: true })

    const [, , , totalResult] = await Promise.all([
      Promise.all(statusPromises),
      Promise.all(sportPromises),
      Promise.all(sourcePromises),
      totalPromise
    ])

    counts.total = totalResult.count || 0

    return { counts, pendingBySport, sourceCounts }
  } catch (error) {
    console.error('Error getting validation counts:', error)
    return {
      counts: { pending: 0, completed: 0, needs_review: 0, manual_closed: 0, total: 0 },
      pendingBySport: { nfl: 0, nhl: 0, mlb: 0 },
      sourceCounts: { user_saved: 0, parlay_leg: 0, system_generated: 0 }
    }
  }
}

/**
 * Calculate accuracy by edge percentage
 * @returns {Promise<object>} Accuracy by edge
 */
export async function getAccuracyByEdge() {
  try {
    const { data: validations, error } = await supabase
      .from('PropValidation')
      .select('*')
      .eq('status', 'completed')
    
    if (error) throw error
    
    // Group by edge range
    const edgeRanges = {
      '0-1%': { correct: 0, total: 0 },
      '1-2%': { correct: 0, total: 0 },
      '2-3%': { correct: 0, total: 0 },
      '3-4%': { correct: 0, total: 0 },
      '4-5%': { correct: 0, total: 0 },
      '5%+': { correct: 0, total: 0 }
    }
    
    validations?.forEach(v => {
      const edge = Math.abs(v.edge || 0)
      let range = '5%+'
      
      if (edge < 0.01) range = '0-1%'
      else if (edge < 0.02) range = '1-2%'
      else if (edge < 0.03) range = '2-3%'
      else if (edge < 0.04) range = '3-4%'
      else if (edge < 0.05) range = '4-5%'
      
      edgeRanges[range].total++
      if (v.result === 'correct') edgeRanges[range].correct++
    })
    
    // Calculate accuracy for each range
    Object.keys(edgeRanges).forEach(range => {
      const rangeStat = edgeRanges[range]
      rangeStat.accuracy = rangeStat.total > 0 ? rangeStat.correct / rangeStat.total : 0
    })
    
    return edgeRanges
  } catch (error) {
    console.error('Error calculating accuracy by edge:', error)
    return {}
  }
}

/**
 * Get the most accurate prop types
 * @param {number} limit - Maximum number of prop types to return
 * @returns {Promise<Array>} Most accurate prop types
 */
export async function getMostAccuratePropTypes(limit = 5) {
  try {
    const stats = await getValidationStats()
    
    // Convert byPropType to array and sort by accuracy
    const propTypes = Object.keys(stats.byPropType).map(type => ({
      type,
      ...stats.byPropType[type]
    }))
    
    // Sort by accuracy (descending) and filter to props with at least 10 samples
    const sortedPropTypes = propTypes
      .filter(p => p.total >= 10)
      .sort((a, b) => b.accuracy - a.accuracy)
    
    return sortedPropTypes.slice(0, limit)
  } catch (error) {
    console.error('Error getting most accurate prop types:', error)
    return []
  }
}

function storedAmericanOdds(odds) {
  const american = toAmericanOdds(odds)
  if (american == null || !Number.isFinite(american)) return null
  return Math.round(american)
}

function gameLineType(line) {
  const raw = String(line?.type || line?.propType || '').toLowerCase()
  if (raw === 'total' || raw === 'totals') return 'total'
  return 'moneyline'
}

/**
 * Save a qualifying ML / game-total pick onto the sides & totals track.
 * Distinct source so Published props ROI never absorbs the row.
 * Reuses PropValidation — no new odds fetch.
 */
export async function recordGameLinePrediction(line) {
  try {
    if (!line?.gameId) return null
    const propId = gameLinePropId(line)
    const propType = gameLineType(line)
    const qualityScore = calculateQualityScore({
      probability: line.probability || 0.5,
      edge: line.edge || 0,
      confidence: line.confidence || 'medium',
    })

    const { data: existing } = await supabase
      .from('PropValidation')
      .select('*')
      .eq('propId', propId)
      .maybeSingle()

    if (existing?.status === 'completed') return existing

    const payload = attachNumBooks({
      propId,
      gameIdRef: line.gameId,
      playerName: gameLineLabel(line),
      propType,
      threshold: propType === 'total' ? (Number(line.threshold) || 0) : 0,
      prediction: String(line.pick || line.prediction || '').toLowerCase() || (propType === 'total' ? 'over' : String(line.pick || '')),
      projectedValue: line.probability || 0,
      confidence: line.confidence || 'medium',
      edge: line.edge || 0,
      odds: storedAmericanOdds(line.odds),
      probability: line.probability || null,
      qualityScore,
      source: GAME_LINE_SOURCE,
      parlayId: null,
      status: 'pending',
      sport: line.sport || 'mlb',
      timestamp: new Date().toISOString(),
      notes: SIDES_TOTALS_COHORT_TAG,
    }, line)

    if (propType === 'moneyline') {
      payload.prediction = String(line.pick || line.team || '').toUpperCase()
    }

    if (existing) {
      const { data, error } = await supabase
        .from('PropValidation')
        .update({
          threshold: payload.threshold,
          prediction: payload.prediction,
          projectedValue: payload.projectedValue,
          confidence: payload.confidence,
          edge: payload.edge,
          odds: payload.odds,
          probability: payload.probability,
          qualityScore: payload.qualityScore,
          source: GAME_LINE_SOURCE,
          notes: SIDES_TOTALS_COHORT_TAG,
        })
        .eq('propId', propId)
        .select()
        .single()
      if (error) throw error
      return data
    }

    payload.id = generateId()
    const { data, error } = await supabase
      .from('PropValidation')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('Error recording game line:', error)
    return null
  }
}

export async function persistGameLines(lines) {
  const rows = Array.isArray(lines) ? lines : []
  const saved = []
  for (const line of rows) {
    const row = await recordGameLinePrediction(line)
    if (row) saved.push(row)
  }
  try {
    await gradePendingGameLines()
  } catch (error) {
    console.error('Error grading pending sides & totals:', error)
  }
  return saved
}

/**
 * Grade pending game-line rows from Game scores already in the DB.
 * No Odds API call.
 */
export async function gradePendingGameLines() {
  const { data: pending, error } = await supabase
    .from('PropValidation')
    .select('*')
    .eq('source', GAME_LINE_SOURCE)
    .eq('status', 'pending')
    .in('propType', ['moneyline', 'total'])
    .limit(200)

  if (error) throw error
  if (!pending || pending.length === 0) return []

  const gameIds = [...new Set(pending.map((row) => row.gameIdRef).filter(Boolean))]
  if (gameIds.length === 0) return []

  const { data: games } = await supabase
    .from('Game')
    .select(`
      id, status, homeScore, awayScore,
      home:Team!Game_homeId_fkey(abbr),
      away:Team!Game_awayId_fkey(abbr)
    `)
    .in('id', gameIds)

  const gamesMap = {}
  for (const game of games || []) gamesMap[game.id] = game

  const graded = []
  for (const row of pending) {
    const game = gamesMap[row.gameIdRef]
    if (!game || !isFinalGameStatus(game.status)) continue
    const outcome = gradeGameLineFromScores(row, game)
    if (!outcome) continue

    const { data, error: updateError } = await supabase
      .from('PropValidation')
      .update({
        actualValue: outcome.actualValue,
        result: outcome.result,
        status: 'completed',
        completedAt: new Date().toISOString(),
        notes: `${SIDES_TOTALS_COHORT_TAG} | graded from final score`,
      })
      .eq('id', row.id)
      .select()
      .single()

    if (updateError) {
      console.error('Error grading game line', row.id, updateError)
      continue
    }
    graded.push(data)
  }
  return graded
}

async function fetchSidesTotalsRecords(options = {}) {
  let query = supabase
    .from('PropValidation')
    .select('*')
    .eq('status', 'completed')
    .eq('source', GAME_LINE_SOURCE)
    .in('sport', PUBLISHED_STATS_PREFILTER.sports)
    .gt('edge', 0)
    .order('id', { ascending: true })
    .limit(2000)

  if (options.days) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - options.days)
    query = query.gte('completedAt', cutoff.toISOString())
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Separate sides & totals record. Not folded into Published props ROI.
 * Honest zeros when the sample is still empty.
 */
export async function getSidesTotalsStats(options = {}) {
  try {
    const records = await fetchSidesTotalsRecords(options)
    return summarizeSidesTotals(records)
  } catch (error) {
    console.error('Error getting sides & totals stats:', error)
    if (options.throwOnError) throw error
    return summarizeSidesTotals([])
  }
}

/**
 * Get the most profitable prop types
 * @param {number} limit - Maximum number of prop types to return
 * @returns {Promise<Array>} Most profitable prop types
 */
export async function getMostProfitablePropTypes(limit = 5) {
  try {
    const stats = await getValidationStats()
    
    // Convert byPropType to array and sort by ROI
    const propTypes = Object.keys(stats.byPropType).map(type => ({
      type,
      ...stats.byPropType[type]
    }))
    
    // Sort by ROI (descending) and filter to props with at least 10 samples
    const sortedPropTypes = propTypes
      .filter(p => p.total >= 10)
      .sort((a, b) => b.roi - a.roi)
    
    return sortedPropTypes.slice(0, limit)
  } catch (error) {
    console.error('Error getting most profitable prop types:', error)
    return []
  }
}
