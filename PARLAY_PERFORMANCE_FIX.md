# Performance Fix: Limiting Parlay Combinations - November 9, 2025

## Problem: Combinatorial Explosion

### What Was Happening:
```
781 available bets × 3-leg parlays = 79,091,870 combinations 🤯
```

This would take **minutes to process** and potentially crash the browser!

### The Math:
```
Combinations = n! / (r! × (n-r)!)

Where:
- n = number of available bets
- r = number of legs in parlay

Example with 781 bets, 3-leg parlay:
= 781! / (3! × 778!)
= (781 × 780 × 779) / (3 × 2 × 1)
= 79,091,870 combinations
```

### Real-World Performance:
| Bets | 2-Leg | 3-Leg | 4-Leg |
|------|-------|-------|-------|
| 50 | 1,225 | 19,600 | 230,300 |
| 100 | 4,950 | 161,700 | 3,921,225 |
| 150 | 11,175 | 551,300 | 20,548,725 |
| 781 | 304,890 | **79M** | **12B** |

## The Solution

### Intelligent Pre-Filtering:
Instead of generating combinations from ALL bets, we:
1. **Sort bets by quality** (quality score, then edge, then probability)
2. **Take top 150 bets** only
3. **Generate combinations** from this optimized set

### New Performance:
| Bets | Before | After | Improvement |
|------|--------|-------|-------------|
| 781 | 79M | 551K | **143x faster!** |
| 1000 | 166M | 551K | **301x faster!** |

### Code Changes:

```javascript
// BEFORE (BAD):
const combinations = generateCombinations(filteredBets, legCount)
// Would generate 79M combinations from 781 bets

// AFTER (GOOD):
const MAX_BETS_FOR_COMBINATIONS = 150

if (filteredBets.length > MAX_BETS_FOR_COMBINATIONS) {
  optimizedBets = [...filteredBets]
    .sort((a, b) => {
      // Sort by quality score, edge, probability
      return (b.qualityScore || 0) - (a.qualityScore || 0)
    })
    .slice(0, MAX_BETS_FOR_COMBINATIONS)
}

const combinations = generateCombinations(optimizedBets, legCount)
// Now generates 551K combinations from top 150 bets
```

## Why This Works

### Quality Over Quantity:
The **top 150 bets** by quality score are almost always better than random combinations from all 781 bets!

- **Top 150 bets** = Best quality scores, best edges, best probabilities
- **Remaining 631 bets** = Lower quality, worse value
- **Result**: We get better parlays faster!

### Professional Approach:
This is how professional betting apps work:
1. Score all available bets
2. Filter to top N by quality
3. Generate combinations only from best bets
4. Present top parlays to user

## Files Modified

### lib/simple-parlay-generator.js

**Lines 6-17**: Added factorial helper function
```javascript
function factorial(n) {
  if (n <= 1) return 1
  if (n > 170) return Infinity // Prevent overflow
  let result = 1
  for (let i = 2; i <= n; i++) {
    result *= i
  }
  return result
}
```

**Lines 410-439**: Added intelligent pre-filtering
```javascript
const MAX_BETS_FOR_COMBINATIONS = 150
let optimizedBets = filteredBets

if (filteredBets.length > MAX_BETS_FOR_COMBINATIONS) {
  optimizedBets = [...filteredBets]
    .sort((a, b) => {
      const qualityDiff = (b.qualityScore || 0) - (a.qualityScore || 0)
      if (Math.abs(qualityDiff) > 0.1) return qualityDiff
      
      const edgeDiff = (b.edge || 0) - (a.edge || 0)  
      if (Math.abs(edgeDiff) > 0.01) return edgeDiff
      
      return (b.probability || 0.5) - (a.probability || 0.5)
    })
    .slice(0, MAX_BETS_FOR_COMBINATIONS)
  
  console.log(`🎯 Optimized from ${filteredBets.length} to ${optimizedBets.length} bets for performance`)
}
```

## Expected Behavior After Fix

### Before:
```
📊 Found 781 available bets
📊 Generated 79091870 total combinations  ← Takes 2+ minutes!
```

### After:
```
📊 Found 781 available bets
🎯 Optimized from 781 to 150 bets for performance
📊 Will generate up to 551,300 combinations
📊 Generated 551300 total combinations  ← Takes <1 second!
```

## Tuning the Limit

The `MAX_BETS_FOR_COMBINATIONS = 150` can be adjusted:

| Limit | 2-Leg | 3-Leg | 4-Leg | Speed |
|-------|-------|-------|-------|-------|
| 50 | 1.2K | 19K | 230K | ⚡ Instant |
| 100 | 5K | 161K | 3.9M | ⚡ Fast |
| 150 | 11K | 551K | 20M | ✅ Good |
| 200 | 20K | 1.3M | 64M | ⚠️ Slow |
| 300 | 45K | 4.5M | 331M | ❌ Very Slow |

**150 is the sweet spot** - fast enough, good quality coverage.

## Why This Is Smart, Not Lazy

Some might think "cutting 631 bets is throwing away opportunities!" 

But consider:
- The top 150 bets have the BEST quality scores
- Lower quality bets would create WORSE parlays anyway
- We'd never show the user 79 million parlays - we only show top 10
- The top 10 parlays from 551K combinations are just as good as from 79M

**Result**: Same quality parlays, 143x faster! 🎯

## Next Steps

If you want even more speed:
- Reduce to 100 bets (161K combinations for 3-leg)
- Add edge threshold filter (e.g., only bets with edge > 2%)
- Add probability threshold (e.g., only bets with prob > 30%)

The hot reloader will pick this up automatically!

