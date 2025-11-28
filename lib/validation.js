// Validation system for tracking projection accuracy over time
// MIGRATED TO SUPABASE - No Prisma dependency
import { supabase } from './supabase.js'
import { calculateQualityScore } from './quality-score.js'

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
    const propId = prop.propId || prop.id || `prop-${prop.playerName.replace(/\s+/g, '-')}-${prop.type}-${prop.gameId}-${Date.now()}`
    
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
    
    const validationData = {
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
    }
    
    let result
    if (existing) {
      // Update existing record
      const { data, error } = await supabase
        .from('PropValidation')
        .update({
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
        })
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
 * Get validation statistics
 * @param {object} options - Filter options
 * @returns {Promise<object>} Validation statistics
 */
export async function getValidationStats(options = {}) {
  try {
    // Supabase has a hard 1000 row limit, so we need to paginate
    let allValidations = []
    let page = 0
    const pageSize = 1000
    let hasMore = true
    
    while (hasMore) {
      // Build query for this page
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
      
      // Paginate using range (0-999, 1000-1999, etc.)
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
          hasMore = false  // Last page (partial)
        }
        page++
      }
    }
    
    const validations = allValidations
    
    // Calculate statistics
    const total = validations?.length || 0
    const correct = validations?.filter(v => v.result === 'correct').length || 0
    const incorrect = validations?.filter(v => v.result === 'incorrect').length || 0
    const pushes = validations?.filter(v => v.result === 'push').length || 0
    const withResults = correct + incorrect // Validations with actual results (excluding pushes)
    
    // Calculate accuracy (excluding pushes and null results)
    const accuracy = withResults > 0 ? correct / withResults : 0
    
    // Calculate average edge (only for validations with edge values)
    const validationsWithEdge = validations?.filter(v => v.edge != null && !isNaN(v.edge)) || []
    const avgEdge = validationsWithEdge.length > 0 
      ? validationsWithEdge.reduce((sum, v) => sum + (v.edge || 0), 0) / validationsWithEdge.length 
      : 0
    
    // Calculate ROI (assuming -110 odds for simplicity)
    // ROI = (wins * 0.91 - losses) / total bets
    const roi = withResults > 0 ? ((correct * 0.91) - incorrect) / withResults : 0
    
    // Group by prop type
    const byPropType = {}
    validations?.forEach(v => {
      // Create key with sport prefix
      const key = v.sport ? `${v.sport.toUpperCase()} - ${v.propType}` : v.propType
      if (!byPropType[key]) {
        byPropType[key] = { total: 0, correct: 0, incorrect: 0, pushes: 0, sport: v.sport }
      }
      byPropType[key].total++
      if (v.result === 'correct') byPropType[key].correct++
      else if (v.result === 'incorrect') byPropType[key].incorrect++
      else if (v.result === 'push') byPropType[key].pushes++
    })
    
    // Calculate accuracy and ROI by prop type
    Object.keys(byPropType).forEach(type => {
      const typeStat = byPropType[type]
      const typeWithResults = typeStat.correct + typeStat.incorrect
      typeStat.accuracy = typeWithResults > 0 ? typeStat.correct / typeWithResults : 0
      typeStat.roi = typeWithResults > 0 
        ? ((typeStat.correct * 0.91) - typeStat.incorrect) / typeWithResults 
        : 0
    })
    
    return {
      total,
      correct,
      incorrect,
      pushes,
      accuracy,
      avgEdge,
      roi,
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
      
      query = query.order('timestamp', { ascending: false })
      
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
