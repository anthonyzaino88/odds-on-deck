import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { getThresholds } from '../lib/prop-thresholds.js';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

console.log('\n🔍 Validating Sport-Specific Thresholds Against Real Data\n');
console.log('='.repeat(70));

async function validateThresholds() {
  const sports = ['nfl', 'nhl', 'mlb'];
  
  for (const sport of sports) {
    console.log(`\n\n📊 ${sport.toUpperCase()} Analysis`);
    console.log('-'.repeat(70));
    
    const thresholds = getThresholds(sport);
    
    // Fetch all teams for this sport with performance data
    const { data: teams, error } = await supabase
      .from('Team')
      .select('abbr, avgPointsLast10, avgPointsAllowedLast10, last10Record, homeRecord, awayRecord')
      .eq('sport', sport)
      .not('avgPointsLast10', 'is', null)
      .order('avgPointsLast10', { ascending: false });
    
    if (error || !teams || teams.length === 0) {
      console.log(`⚠️  No data available for ${sport.toUpperCase()}`);
      continue;
    }
    
    // Calculate statistics
    const offensiveScores = teams.map(t => t.avgPointsLast10).filter(s => s > 0);
    const defensiveScores = teams.map(t => t.avgPointsAllowedLast10).filter(s => s > 0);
    
    const avgOffense = average(offensiveScores);
    const maxOffense = Math.max(...offensiveScores);
    const minOffense = Math.min(...offensiveScores);
    const medianOffense = median(offensiveScores);
    
    const avgDefense = average(defensiveScores);
    const maxDefense = Math.max(...defensiveScores);
    const minDefense = Math.min(...defensiveScores);
    
    // Calculate percentiles
    const p75Offense = percentile(offensiveScores, 75);
    const p25Offense = percentile(offensiveScores, 25);
    const p75Defense = percentile(defensiveScores, 75);
    const p25Defense = percentile(defensiveScores, 25);
    
    console.log(`\n📈 OFFENSIVE SCORING (${thresholds.displayUnit})`);
    console.log(`   Range: ${minOffense.toFixed(1)} - ${maxOffense.toFixed(1)}`);
    console.log(`   Average: ${avgOffense.toFixed(1)}`);
    console.log(`   Median: ${medianOffense.toFixed(1)}`);
    console.log(`   75th Percentile: ${p75Offense.toFixed(1)}`);
    console.log(`   25th Percentile: ${p25Offense.toFixed(1)}`);
    console.log('');
    console.log(`   OUR THRESHOLDS:`);
    console.log(`   🔥 Hot Offense: ${thresholds.hotOffense} ${thresholds.displayUnit}`);
    console.log(`   📊 Average: ${thresholds.averageOffense} ${thresholds.displayUnit}`);
    console.log(`   ❄️  Cold Offense: ${thresholds.coldOffense} ${thresholds.displayUnit}`);
    
    // Validation
    const hotOffensePercentile = (offensiveScores.filter(s => s >= thresholds.hotOffense).length / offensiveScores.length) * 100;
    const coldOffensePercentile = (offensiveScores.filter(s => s <= thresholds.coldOffense).length / offensiveScores.length) * 100;
    
    console.log('');
    console.log(`   ✅ ${hotOffensePercentile.toFixed(0)}% of teams qualify as "Hot" (Target: 20-30%)`);
    console.log(`   ✅ ${coldOffensePercentile.toFixed(0)}% of teams qualify as "Cold" (Target: 20-30%)`);
    
    if (hotOffensePercentile < 15 || hotOffensePercentile > 35) {
      console.log(`   ⚠️  WARNING: Hot threshold may be too ${hotOffensePercentile < 20 ? 'HIGH' : 'LOW'}`);
      console.log(`      Recommended: ${p75Offense.toFixed(1)} (75th percentile)`);
    }
    
    console.log(`\n🛡️  DEFENSIVE SCORING (${thresholds.displayUnit} Allowed)`);
    console.log(`   Range: ${minDefense.toFixed(1)} - ${maxDefense.toFixed(1)}`);
    console.log(`   Average: ${avgDefense.toFixed(1)}`);
    console.log('');
    console.log(`   OUR THRESHOLDS:`);
    console.log(`   ❌ Weak Defense: ${thresholds.weakDefense} ${thresholds.displayUnit}`);
    console.log(`   📊 Average: ${thresholds.averageDefense} ${thresholds.displayUnit}`);
    console.log(`   🛡️  Strong Defense: ${thresholds.strongDefense} ${thresholds.displayUnit}`);
    
    const weakDefensePercentile = (defensiveScores.filter(s => s >= thresholds.weakDefense).length / defensiveScores.length) * 100;
    const strongDefensePercentile = (defensiveScores.filter(s => s <= thresholds.strongDefense).length / defensiveScores.length) * 100;
    
    console.log('');
    console.log(`   ✅ ${weakDefensePercentile.toFixed(0)}% of teams have "Weak" defense (Target: 20-30%)`);
    console.log(`   ✅ ${strongDefensePercentile.toFixed(0)}% of teams have "Strong" defense (Target: 20-30%)`);
    
    // Show top offenses vs our threshold
    console.log(`\n🔥 TOP OFFENSES (vs threshold of ${thresholds.hotOffense}):`);
    const hotOffenses = teams.filter(t => t.avgPointsLast10 >= thresholds.hotOffense);
    hotOffenses.slice(0, 10).forEach((team, i) => {
      console.log(`   ${i + 1}. ${team.abbr}: ${team.avgPointsLast10.toFixed(1)} ${thresholds.displayUnit}`);
    });
    
    if (hotOffenses.length === 0) {
      console.log(`   ⚠️  WARNING: NO teams meet hot threshold! Too restrictive!`);
      console.log(`      Recommended threshold: ${p75Offense.toFixed(1)}`);
    }
    
    console.log(`\n❄️  COLD OFFENSES (vs threshold of ${thresholds.coldOffense}):`);
    const coldOffenses = teams.filter(t => t.avgPointsLast10 <= thresholds.coldOffense);
    coldOffenses.slice(-10).forEach((team, i) => {
      console.log(`   ${i + 1}. ${team.abbr}: ${team.avgPointsLast10.toFixed(1)} ${thresholds.displayUnit}`);
    });
    
    // Show weak defenses (good for props!)
    console.log(`\n❌ WEAK DEFENSES - Good for Props! (vs threshold of ${thresholds.weakDefense}):`);
    const weakDefenses = teams
      .filter(t => t.avgPointsAllowedLast10 >= thresholds.weakDefense)
      .sort((a, b) => b.avgPointsAllowedLast10 - a.avgPointsAllowedLast10);
    
    weakDefenses.slice(0, 10).forEach((team, i) => {
      console.log(`   ${i + 1}. ${team.abbr}: ${team.avgPointsAllowedLast10.toFixed(1)} ${thresholds.displayUnit} allowed`);
    });
    
    if (weakDefenses.length === 0) {
      console.log(`   ⚠️  WARNING: NO teams have weak defense! Threshold too high!`);
      console.log(`      Recommended threshold: ${p75Defense.toFixed(1)}`);
    }
    
    // Comparison to actual league average
    console.log(`\n📊 LEAGUE REALITY CHECK:`);
    console.log(`   Actual Average Offense: ${avgOffense.toFixed(1)} ${thresholds.displayUnit}`);
    console.log(`   Our Average Threshold: ${thresholds.averageOffense} ${thresholds.displayUnit}`);
    const offenseDiff = ((avgOffense - thresholds.averageOffense) / thresholds.averageOffense * 100);
    console.log(`   Difference: ${offenseDiff > 0 ? '+' : ''}${offenseDiff.toFixed(1)}%`);
    
    if (Math.abs(offenseDiff) > 15) {
      console.log(`   ⚠️  WARNING: Our threshold differs significantly from reality!`);
      console.log(`      Consider updating to: ${avgOffense.toFixed(1)}`);
    } else {
      console.log(`   ✅ Threshold is realistic`);
    }
  }
  
  console.log('\n\n' + '='.repeat(70));
  console.log('\n✅ Threshold Validation Complete\n');
}

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 
    ? (sorted[mid - 1] + sorted[mid]) / 2 
    : sorted[mid];
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

validateThresholds();

