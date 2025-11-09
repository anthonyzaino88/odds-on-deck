/**
 * Player Props Enrichment - Add team context for smarter filtering
 * 
 * This module enriches player props with team performance data to help users
 * identify props with favorable game contexts (hot offenses, weak defenses, etc.)
 */

import { supabase } from './supabase.js';
import { 
  getThresholds, 
  isHotOffense, 
  isWeakDefense,
  isHighScoringGame,
  calculateTeamContextScore 
} from './prop-thresholds.js';

/**
 * Enrich props with team context data
 * @param {Array} props - Array of player props
 * @returns {Array} Props with added teamContext field
 */
export async function enrichPropsWithTeamContext(props) {
  if (!props || props.length === 0) {
    return props;
  }

  try {
    // Get unique gameIds
    const gameIds = [...new Set(props.map(p => p.gameId).filter(Boolean))];
    
    if (gameIds.length === 0) {
      console.warn('⚠️ No gameIds found in props');
      return props;
    }

    console.log(`🔍 Enriching ${props.length} props from ${gameIds.length} games with team context...`);
    
    // Debug: Log sport breakdown
    const sportBreakdown = props.reduce((acc, p) => {
      acc[p.sport] = (acc[p.sport] || 0) + 1;
      return acc;
    }, {});
    console.log(`   Sports: ${Object.entries(sportBreakdown).map(([s, c]) => `${s}=${c}`).join(', ')}`);

    // Fetch game + team data in one query
    const { data: gamesData, error } = await supabase
      .from('Game')
      .select(`
        id,
        sport,
        homeId,
        awayId,
        home:Team!Game_homeId_fkey(
          abbr,
          avgPointsLast10,
          avgPointsAllowedLast10,
          last10Record,
          homeRecord,
          awayRecord
        ),
        away:Team!Game_awayId_fkey(
          abbr,
          avgPointsLast10,
          avgPointsAllowedLast10,
          last10Record,
          homeRecord,
          awayRecord
        )
      `)
      .in('id', gameIds);

    if (error) {
      console.error('❌ Error fetching game context:', error);
      return props; // Return props unchanged if error
    }

    if (!gamesData || gamesData.length === 0) {
      console.warn('⚠️ No game data found');
      return props;
    }

    // Create lookup map
    const gameContextMap = createGameContextMap(gamesData);
    
    console.log(`✅ Fetched context for ${Object.keys(gameContextMap).length} games`);

    // Enrich each prop
    const enrichedProps = props.map(prop => {
      const gameContext = gameContextMap[prop.gameId];
      
      if (!gameContext) {
        // No context available - return prop unchanged
        return prop;
      }

      // Calculate team context
      const teamContext = calculateTeamContext(prop, gameContext);
      
      return {
        ...prop,
        teamContext
      };
    });

    const enrichedCount = enrichedProps.filter(p => p.teamContext).length;
    const missingCount = props.length - enrichedCount;
    console.log(`✅ Enriched ${enrichedCount}/${props.length} props with team context`);
    
    if (missingCount > 0) {
      // Log sport breakdown of missing context
      const missingBySport = enrichedProps
        .filter(p => !p.teamContext)
        .reduce((acc, p) => {
          acc[p.sport] = (acc[p.sport] || 0) + 1;
          return acc;
        }, {});
      console.log(`   Missing context: ${Object.entries(missingBySport).map(([s, c]) => `${s}=${c}`).join(', ')}`);
    }

    return enrichedProps;

  } catch (error) {
    console.error('❌ Error in enrichPropsWithTeamContext:', error);
    return props; // Return props unchanged if error
  }
}

/**
 * Create a lookup map of game contexts
 * @param {Array} gamesData - Raw game data from Supabase
 * @returns {Object} Map of gameId -> context
 */
function createGameContextMap(gamesData) {
  const map = {};

  for (const game of gamesData) {
    if (!game.home || !game.away) continue;

    // Calculate simple win probabilities from team records
    const homeWinProb = calculateSimpleWinProbability(
      game.home.last10Record,
      game.home.homeRecord,
      true // isHome
    );
    const awayWinProb = calculateSimpleWinProbability(
      game.away.last10Record,
      game.away.awayRecord,
      false // isHome
    );

    // Calculate expected total from offensive power
    const expectedTotal = (game.home.avgPointsLast10 || 0) + (game.away.avgPointsLast10 || 0);

    map[game.id] = {
      gameId: game.id,
      sport: game.sport,
      homeTeam: {
        abbr: game.home.abbr,
        offensivePower: game.home.avgPointsLast10 || 0,
        defensivePower: game.home.avgPointsAllowedLast10 || 0,
        last10Record: game.home.last10Record,
        homeRecord: game.home.homeRecord,
        awayRecord: game.home.awayRecord,
        winProbability: homeWinProb
      },
      awayTeam: {
        abbr: game.away.abbr,
        offensivePower: game.away.avgPointsLast10 || 0,
        defensivePower: game.away.avgPointsAllowedLast10 || 0,
        last10Record: game.away.last10Record,
        homeRecord: game.away.homeRecord,
        awayRecord: game.away.awayRecord,
        winProbability: awayWinProb
      },
      expectedTotal
    };
  }

  return map;
}

/**
 * Calculate simple win probability from team records
 * @param {string} last10Record - e.g., "7-3"
 * @param {string} venueRecord - home or away record
 * @param {boolean} isHome - whether team is at home
 * @returns {number} Win probability (0.0-1.0)
 */
function calculateSimpleWinProbability(last10Record, venueRecord, isHome) {
  // Start with 50%
  let prob = 0.5;

  // Factor in recent form (last 10 games)
  if (last10Record) {
    const parts = last10Record.split('-');
    if (parts.length >= 2) {
      const wins = parseInt(parts[0]) || 0;
      const losses = parseInt(parts[1]) || 0;
      const total = wins + losses;
      if (total > 0) {
        const recentWinPct = wins / total;
        prob = (prob * 0.4) + (recentWinPct * 0.6); // Weight recent form heavily
      }
    }
  }

  // Factor in venue performance
  if (venueRecord) {
    const parts = venueRecord.split('-');
    if (parts.length >= 2) {
      const wins = parseInt(parts[0]) || 0;
      const losses = parseInt(parts[1]) || 0;
      const total = wins + losses;
      if (total > 0) {
        const venueWinPct = wins / total;
        prob = (prob * 0.7) + (venueWinPct * 0.3); // Blend in venue performance
      }
    }
  }

  // Home field advantage
  if (isHome) {
    prob = Math.min(0.95, prob + 0.05); // 5% boost for home, cap at 95%
  }

  return Math.max(0.05, Math.min(0.95, prob)); // Keep between 5% and 95%
}

/**
 * Calculate team context for a specific prop
 * @param {Object} prop - Player prop
 * @param {Object} gameContext - Game context data
 * @returns {Object} Team context with calculated metrics
 */
function calculateTeamContext(prop, gameContext) {
  const { sport, homeTeam, awayTeam, expectedTotal } = gameContext;
  
  // Determine which team the player is on
  const playerTeam = prop.team;
  
  // Handle missing or invalid team data gracefully
  // If team is missing/null, we'll still provide context using both teams' average
  let isHome, team, opponent;
  
  if (!playerTeam || playerTeam === 'null' || playerTeam === 'undefined') {
    // Team data missing - use average of both teams
    isHome = null; // Unknown
    team = homeTeam; // Use home team data as default
    opponent = awayTeam;
  } else {
    // Valid team data - match to home or away
    isHome = homeTeam.abbr === playerTeam;
    
    if (isHome) {
      team = homeTeam;
      opponent = awayTeam;
    } else if (awayTeam.abbr === playerTeam) {
      team = awayTeam;
      opponent = homeTeam;
    } else {
      // Team doesn't match either - skip enrichment
      return null;
    }
  }

  // Get sport-specific thresholds
  const thresholds = getThresholds(sport);

  // Calculate metrics
  const offensiveRating = calculateOffensiveRating(team.offensivePower, sport);
  const defensiveMatchupRating = calculateDefensiveMatchupRating(opponent.defensivePower, sport);
  const recentFormRating = calculateFormRating(team.last10Record);
  const venueRating = calculateVenueRating(isHome, team);

  // Calculate overall context score
  const contextScore = calculateTeamContextScore({
    offensivePower: team.offensivePower,
    defensiveMatchup: opponent.defensivePower,
    winProbability: team.winProbability,
    recentForm: recentFormRating / 100,
    venueAdvantage: venueRating / 100,
    sport
  });

  return {
    // Team identification
    team: team.abbr,
    isHome,
    opponent: opponent.abbr,
    sport,

    // Performance metrics
    offensivePower: team.offensivePower,
    offensiveRating,
    isHotOffense: isHotOffense(team.offensivePower, sport),

    // Defensive matchup
    opponentDefense: opponent.defensivePower,
    defensiveMatchupRating,
    isWeakDefense: isWeakDefense(opponent.defensivePower, sport),

    // Win probability
    winProbability: team.winProbability,
    isDominant: team.winProbability >= thresholds.dominantTeam,
    isFavored: team.winProbability >= thresholds.favoredTeam,

    // Game environment
    expectedTotal,
    isHighScoring: isHighScoringGame(expectedTotal, sport),

    // Form and venue
    recentForm: team.last10Record,
    recentFormRating,
    venueRating,
    venueRecord: isHome === null ? team.last10Record : (isHome ? team.homeRecord : team.awayRecord),

    // Overall quality
    contextScore,
    
    // Display helpers
    displayUnit: thresholds.displayUnit,
    formattedOffense: `${team.offensivePower.toFixed(1)} ${thresholds.displayUnit}`,
    formattedDefense: `${opponent.defensivePower.toFixed(1)} ${thresholds.displayUnit}`,
    formattedTotal: expectedTotal ? `${expectedTotal.toFixed(1)}` : 'N/A'
  };
}

/**
 * Calculate offensive rating (0-100)
 */
function calculateOffensiveRating(ppg, sport) {
  const thresholds = getThresholds(sport);
  
  if (ppg >= thresholds.hotOffense) {
    const excess = ppg - thresholds.hotOffense;
    const range = thresholds.hotOffense * 0.3;
    return Math.min(100, 80 + (excess / range) * 20);
  } else if (ppg >= thresholds.averageOffense) {
    const range = thresholds.hotOffense - thresholds.averageOffense;
    const position = (ppg - thresholds.averageOffense) / range;
    return 60 + (position * 20);
  } else if (ppg >= thresholds.coldOffense) {
    const range = thresholds.averageOffense - thresholds.coldOffense;
    const position = (ppg - thresholds.coldOffense) / range;
    return 40 + (position * 20);
  } else {
    return Math.max(0, (ppg / thresholds.coldOffense) * 40);
  }
}

/**
 * Calculate defensive matchup rating (0-100, higher = better for props)
 */
function calculateDefensiveMatchupRating(pa, sport) {
  const thresholds = getThresholds(sport);
  
  // Higher points allowed = better for props
  if (pa >= thresholds.weakDefense) {
    const excess = pa - thresholds.weakDefense;
    const range = thresholds.weakDefense * 0.3;
    return Math.min(100, 80 + (excess / range) * 20);
  } else if (pa >= thresholds.averageDefense) {
    const range = thresholds.weakDefense - thresholds.averageDefense;
    const position = (pa - thresholds.averageDefense) / range;
    return 60 + (position * 20);
  } else if (pa >= thresholds.strongDefense) {
    const range = thresholds.averageDefense - thresholds.strongDefense;
    const position = (pa - thresholds.strongDefense) / range;
    return 40 + (position * 20);
  } else {
    return Math.max(0, (pa / thresholds.strongDefense) * 40);
  }
}

/**
 * Calculate form rating from record string (e.g., "7-3")
 */
function calculateFormRating(recordStr) {
  if (!recordStr) return 50;

  const parts = recordStr.split('-');
  if (parts.length < 2) return 50;

  const wins = parseInt(parts[0]) || 0;
  const losses = parseInt(parts[1]) || 0;
  const total = wins + losses;

  if (total === 0) return 50;

  const winPct = wins / total;
  return Math.round(winPct * 100);
}

/**
 * Calculate venue rating (home advantage)
 */
function calculateVenueRating(isHome, team) {
  if (!isHome) {
    // Away team - use away record
    const awayRating = calculateFormRating(team.awayRecord);
    return awayRating || 50;
  }

  // Home team - use home record with bonus
  const homeRating = calculateFormRating(team.homeRecord);
  const bonus = 5; // Home field advantage bonus
  return Math.min(100, (homeRating || 50) + bonus);
}

export default {
  enrichPropsWithTeamContext
};

