// Performance analyzer - Learn from validation data to improve predictions

// ✅ FIXED: Import single Prisma instance instead of creating new one
import { prisma } from './db.js'

/**
 * Analyze performance and generate insights
 * @returns {Promise<object>} Performance insights
 */
export async function analyzePerformance() {
  try {
    // Get all completed validations
    const validations = await prisma.propValidation.findMany({
      where: { status: 'completed' }
    })
    
    if (validations.length === 0) {
      return { insights: [], adjustments: {} }
    }
    
    const insights = []
    const adjustments = {}
    
    // 1. Analyze by prop type
    const byPropType = {}
    validations.forEach(v => {
      if (!byPropType[v.propType]) {
        byPropType[v.propType] = { correct: 0, total: 0, avgEdge: 0, edges: [] }
      }
      byPropType[v.propType].total++
      if (v.result === 'correct') byPropType[v.propType].correct++
      byPropType[v.propType].edges.push(v.edge)
    })
    
    // Calculate accuracy and adjustments for each prop type
    Object.keys(byPropType).forEach(propType => {
      const stat = byPropType[propType]
      const accuracy = stat.correct / stat.total
      const avgEdge = stat.edges.reduce((a, b) => a + b, 0) / stat.edges.length
      
      stat.accuracy = accuracy
      stat.avgEdge = avgEdge
      
      // Determine if this prop type is performing well
      if (accuracy >= 0.55 && stat.total >= 5) {
        insights.push({
          type: 'success',
          category: 'prop_type',
          subject: propType,
          message: `${propType.replace(/_/g, ' ')} is performing well (${(accuracy * 100).toFixed(1)}% accuracy)`,
          recommendation: 'Prioritize this prop type in future selections',
          boost: 1.2 // 20% confidence boost
        })
        adjustments[propType] = { confidenceMultiplier: 1.2, reason: 'High accuracy' }
      } else if (accuracy < 0.45 && stat.total >= 5) {
        insights.push({
          type: 'warning',
          category: 'prop_type',
          subject: propType,
          message: `${propType.replace(/_/g, ' ')} is underperforming (${(accuracy * 100).toFixed(1)}% accuracy)`,
          recommendation: 'Reduce weight or avoid this prop type',
          boost: 0.8 // 20% confidence penalty
        })
        adjustments[propType] = { confidenceMultiplier: 0.8, reason: 'Low accuracy' }
      }
    })
    
    // 2. Analyze by player (for players with 3+ predictions)
    const byPlayer = {}
    validations.forEach(v => {
      if (!byPlayer[v.playerName]) {
        byPlayer[v.playerName] = { correct: 0, total: 0 }
      }
      byPlayer[v.playerName].total++
      if (v.result === 'correct') byPlayer[v.playerName].correct++
    })
    
    Object.keys(byPlayer).forEach(playerName => {
      const stat = byPlayer[playerName]
      if (stat.total >= 3) {
        const accuracy = stat.correct / stat.total
        
        if (accuracy >= 0.67) {
          insights.push({
            type: 'success',
            category: 'player',
            subject: playerName,
            message: `Predictions for ${playerName} are very accurate (${stat.correct}/${stat.total})`,
            recommendation: 'Trust props involving this player',
            boost: 1.15
          })
        } else if (accuracy <= 0.33) {
          insights.push({
            type: 'warning',
            category: 'player',
            subject: playerName,
            message: `Predictions for ${playerName} are struggling (${stat.correct}/${stat.total})`,
            recommendation: 'Be cautious with this player',
            boost: 0.85
          })
        }
      }
    })
    
    // 3. Analyze by source
    const bySource = {}
    validations.forEach(v => {
      const source = v.source || 'system_generated'
      if (!bySource[source]) {
        bySource[source] = { correct: 0, total: 0 }
      }
      bySource[source].total++
      if (v.result === 'correct') bySource[source].correct++
    })
    
    Object.keys(bySource).forEach(source => {
      const stat = bySource[source]
      const accuracy = stat.correct / stat.total
      
      insights.push({
        type: 'info',
        category: 'source',
        subject: source,
        message: `${source.replace(/_/g, ' ')}: ${(accuracy * 100).toFixed(1)}% accuracy (${stat.correct}/${stat.total})`,
        recommendation: accuracy >= 0.52 ? 'Good performance' : 'Needs improvement'
      })
    })
    
    // 4. Analyze betting strategy effectiveness
    const byStrategy = {
      conservative: validations.filter(v => v.probability >= 0.55),
      balanced: validations.filter(v => v.probability >= 0.48 && v.probability < 0.55),
      value: validations.filter(v => v.edge >= 0.15),
      aggressive: validations.filter(v => v.edge >= 0.25)
    }
    
    Object.keys(byStrategy).forEach(strategy => {
      const props = byStrategy[strategy]
      if (props.length >= 5) {
        const correct = props.filter(p => p.result === 'correct').length
        const accuracy = correct / props.length
        
        insights.push({
          type: 'info',
          category: 'strategy',
          subject: strategy,
          message: `${strategy.charAt(0).toUpperCase() + strategy.slice(1)} strategy: ${(accuracy * 100).toFixed(1)}% accuracy`,
          recommendation: accuracy >= 0.52 ? 'Effective strategy' : 'Consider adjusting'
        })
      }
    })
    
    // 5. Overall system health
    const overallAccuracy = validations.filter(v => v.result === 'correct').length / validations.length
    const breakEvenRate = 0.524 // -110 odds break-even
    
    if (overallAccuracy >= breakEvenRate) {
      insights.push({
        type: 'success',
        category: 'overall',
        subject: 'System Performance',
        message: `Overall accuracy of ${(overallAccuracy * 100).toFixed(1)}% exceeds break-even rate (52.4%)`,
        recommendation: 'System is profitable! Continue current approach.'
      })
    } else {
      insights.push({
        type: 'warning',
        category: 'overall',
        subject: 'System Performance',
        message: `Overall accuracy of ${(overallAccuracy * 100).toFixed(1)}% is below break-even (52.4%)`,
        recommendation: 'Need to improve prop selection. Focus on high-win-rate prop types.'
      })
    }
    
    return {
      insights,
      adjustments,
      propTypeStats: byPropType,
      playerStats: byPlayer,
      sourceStats: bySource,
      overallAccuracy
    }
    
  } catch (error) {
    console.error('Error analyzing performance:', error)
    return { insights: [], adjustments: {} }
  }
}

/**
 * Get adjustment multiplier for a prop based on historical performance
 * @param {object} prop - The prop to adjust
 * @param {object} adjustments - Performance-based adjustments
 * @returns {number} Confidence multiplier
 */
export function getPerformanceAdjustment(prop, adjustments) {
  let multiplier = 1.0
  
  // Check prop type adjustment
  if (adjustments[prop.type]) {
    multiplier *= adjustments[prop.type].confidenceMultiplier
  }
  
  // Additional adjustments can be added here (player-specific, etc.)
  
  return multiplier
}

/**
 * Filter props based on performance insights
 * @param {Array} props - Props to filter
 * @param {object} insights - Performance insights
 * @param {string} mode - Filter mode ('strict', 'balanced', 'permissive')
 * @returns {Array} Filtered props
 */
export function filterPropsByPerformance(props, insights, mode = 'balanced') {
  if (insights.length === 0) return props
  
  // Get warning prop types (underperforming)
  const warningPropTypes = insights
    .filter(i => i.type === 'warning' && i.category === 'prop_type')
    .map(i => i.subject)
  
  // Get warning players
  const warningPlayers = insights
    .filter(i => i.type === 'warning' && i.category === 'player')
    .map(i => i.subject)
  
  if (mode === 'strict') {
    // Exclude all underperforming props
    return props.filter(p => 
      !warningPropTypes.includes(p.type) && 
      !warningPlayers.includes(p.playerName)
    )
  } else if (mode === 'balanced') {
    // Reduce confidence for underperforming props, but don't exclude
    return props.map(p => {
      if (warningPropTypes.includes(p.type) || warningPlayers.includes(p.playerName)) {
        return {
          ...p,
          confidence: p.confidence === 'high' ? 'medium' : 
                      p.confidence === 'medium' ? 'low' : 'very_low',
          note: 'Historical underperformance'
        }
      }
      return p
    })
  } else {
    // Permissive - just add notes
    return props.map(p => {
      if (warningPropTypes.includes(p.type) || warningPlayers.includes(p.playerName)) {
        return { ...p, note: 'Caution: Historical underperformance' }
      }
      return p
    })
  }
}





