// Validation system for tracking projection accuracy over time
import { prisma } from './db.js'
import { calculateQualityScore } from './quality-score.js'

/**
 * Record a player prop prediction for validation
 * @param {object} prop - The player prop object
 * @param {string} source - Source of the prediction ("user_saved", "parlay_leg", "system_generated")
 * @param {string} parlayId - Optional parlay ID if from a saved parlay
 * @returns {Promise<object>} The created validation record
 */
export async function recordPropPrediction(prop, source = 'system_generated', parlayId = null) {
  try {
    // Skip validation if prop is missing required fields
    if (!prisma) {
      console.warn('⚠️ Prisma not available');
      return null;
    }
    
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
    
    // Generate a unique propId
    const propId = prop.id || `prop-${prop.playerName.replace(/\s+/g, '-')}-${prop.type}-${prop.gameId}-${Date.now()}`
    
    // Calculate quality score
    const qualityScore = calculateQualityScore({
      probability: prop.probability || 0.5,
      edge: prop.edge || 0,
      confidence: prop.confidence || 'medium'
    })
    
    // Create or update validation record (upsert to handle duplicates)
    const validation = await prisma.propValidation.upsert({
      where: { propId: propId },
      update: {
        // Update if exists (newer odds/projection)
        threshold: prop.threshold || 0,
        prediction: prop.pick || 'over',
        projectedValue: prop.projection || prop.projectedValue || 0,
        confidence: prop.confidence || 'low',
        edge: prop.edge || 0,
        odds: prop.odds || null,
        probability: prop.probability || null,
        qualityScore: qualityScore,
        source: source,
        parlayId: parlayId
      },
      create: {
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
        sport: prop.sport || 'mlb'
      }
    });
    
    return validation;
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
    const validation = await prisma.propValidation.findFirst({
      where: { propId }
    });
    
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
    const updated = await prisma.propValidation.update({
      where: { id: validation.id },
      data: {
        actualValue,
        result,
        status: 'completed',
        completedAt: new Date()
      }
    });
    
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
    // Build the query filter
    const filter = {
      status: 'completed'
    };
    
    if (options.propType) filter.propType = options.propType;
    if (options.playerId) filter.playerId = options.playerId;
    if (options.gameId) filter.gameId = options.gameId;
    if (options.confidence) filter.confidence = options.confidence;
    
    if (options.startDate || options.endDate) {
      filter.timestamp = {};
      if (options.startDate) filter.timestamp.gte = new Date(options.startDate);
      if (options.endDate) filter.timestamp.lte = new Date(options.endDate);
    }
    
    // Get all completed validations matching the filter
    const validations = await prisma.propValidation.findMany({
      where: filter
    });
    
    // Calculate statistics
    const total = validations.length;
    const correct = validations.filter(v => v.result === 'correct').length;
    const incorrect = validations.filter(v => v.result === 'incorrect').length;
    const pushes = validations.filter(v => v.result === 'push').length;
    
    // Calculate accuracy (excluding pushes)
    const accuracy = total > 0 ? correct / (correct + incorrect) : 0;
    
    // Calculate average edge
    const avgEdge = validations.reduce((sum, v) => sum + v.edge, 0) / total;
    
    // Calculate ROI (assuming -110 odds for simplicity)
    const roi = ((correct * 0.91) - incorrect) / (correct + incorrect);
    
    // Group by prop type
    const byPropType = {};
    validations.forEach(v => {
      // Create key with sport prefix
      const key = v.sport ? `${v.sport.toUpperCase()} - ${v.propType}` : v.propType;
      if (!byPropType[key]) {
        byPropType[key] = { total: 0, correct: 0, incorrect: 0, pushes: 0, sport: v.sport };
      }
      byPropType[key].total++;
      if (v.result === 'correct') byPropType[key].correct++;
      else if (v.result === 'incorrect') byPropType[key].incorrect++;
      else byPropType[key].pushes++;
    });
    
    // Calculate accuracy by prop type
    Object.keys(byPropType).forEach(type => {
      const typeStat = byPropType[type];
      typeStat.accuracy = typeStat.correct / (typeStat.correct + typeStat.incorrect);
      typeStat.roi = ((typeStat.correct * 0.91) - typeStat.incorrect) / (typeStat.correct + typeStat.incorrect);
    });
    
    return {
      total,
      correct,
      incorrect,
      pushes,
      accuracy,
      avgEdge,
      roi,
      byPropType
    };
  } catch (error) {
    console.error('Error getting validation stats:', error);
    return {
      total: 0,
      correct: 0,
      incorrect: 0,
      pushes: 0,
      accuracy: 0,
      avgEdge: 0,
      roi: 0,
      byPropType: {}
    };
  }
}

/**
 * Get detailed validation records
 * @param {object} options - Filter options
 * @returns {Promise<Array>} Validation records
 */
export async function getValidationRecords(options = {}) {
  try {
    // Build the query filter
    const filter = {};
    
    if (options.status) filter.status = options.status;
    if (options.propType) filter.propType = options.propType;
    if (options.playerId) filter.playerId = options.playerId;
    if (options.gameId) filter.gameId = options.gameId;
    if (options.result) filter.result = options.result;
    
    if (options.startDate || options.endDate) {
      filter.timestamp = {};
      if (options.startDate) filter.timestamp.gte = new Date(options.startDate);
      if (options.endDate) filter.timestamp.lte = new Date(options.endDate);
    }
    
    // Get validations matching the filter
    const validations = await prisma.propValidation.findMany({
      where: filter,
      orderBy: { timestamp: 'desc' },
      take: options.limit || 100
    });
    
    return validations;
  } catch (error) {
    console.error('Error getting validation records:', error);
    return [];
  }
}

/**
 * Calculate accuracy by edge percentage
 * @returns {Promise<object>} Accuracy by edge
 */
export async function getAccuracyByEdge() {
  try {
    const validations = await prisma.propValidation.findMany({
      where: { status: 'completed' }
    });
    
    // Group by edge range
    const edgeRanges = {
      '0-1%': { correct: 0, total: 0 },
      '1-2%': { correct: 0, total: 0 },
      '2-3%': { correct: 0, total: 0 },
      '3-4%': { correct: 0, total: 0 },
      '4-5%': { correct: 0, total: 0 },
      '5%+': { correct: 0, total: 0 }
    };
    
    validations.forEach(v => {
      const edge = Math.abs(v.edge);
      let range = '5%+';
      
      if (edge < 0.01) range = '0-1%';
      else if (edge < 0.02) range = '1-2%';
      else if (edge < 0.03) range = '2-3%';
      else if (edge < 0.04) range = '3-4%';
      else if (edge < 0.05) range = '4-5%';
      
      edgeRanges[range].total++;
      if (v.result === 'correct') edgeRanges[range].correct++;
    });
    
    // Calculate accuracy for each range
    Object.keys(edgeRanges).forEach(range => {
      const rangeStat = edgeRanges[range];
      rangeStat.accuracy = rangeStat.total > 0 ? rangeStat.correct / rangeStat.total : 0;
    });
    
    return edgeRanges;
  } catch (error) {
    console.error('Error calculating accuracy by edge:', error);
    return {};
  }
}

/**
 * Get the most accurate prop types
 * @param {number} limit - Maximum number of prop types to return
 * @returns {Promise<Array>} Most accurate prop types
 */
export async function getMostAccuratePropTypes(limit = 5) {
  try {
    const stats = await getValidationStats();
    
    // Convert byPropType to array and sort by accuracy
    const propTypes = Object.keys(stats.byPropType).map(type => ({
      type,
      ...stats.byPropType[type]
    }));
    
    // Sort by accuracy (descending) and filter to props with at least 10 samples
    const sortedPropTypes = propTypes
      .filter(p => p.total >= 10)
      .sort((a, b) => b.accuracy - a.accuracy);
    
    return sortedPropTypes.slice(0, limit);
  } catch (error) {
    console.error('Error getting most accurate prop types:', error);
    return [];
  }
}

/**
 * Get the most profitable prop types
 * @param {number} limit - Maximum number of prop types to return
 * @returns {Promise<Array>} Most profitable prop types
 */
export async function getMostProfitablePropTypes(limit = 5) {
  try {
    const stats = await getValidationStats();
    
    // Convert byPropType to array and sort by ROI
    const propTypes = Object.keys(stats.byPropType).map(type => ({
      type,
      ...stats.byPropType[type]
    }));
    
    // Sort by ROI (descending) and filter to props with at least 10 samples
    const sortedPropTypes = propTypes
      .filter(p => p.total >= 10)
      .sort((a, b) => b.roi - a.roi);
    
    return sortedPropTypes.slice(0, limit);
  } catch (error) {
    console.error('Error getting most profitable prop types:', error);
    return [];
  }
}




